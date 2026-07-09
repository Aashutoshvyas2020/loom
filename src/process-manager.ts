import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  SHUTDOWN_ABSOLUTE_DEADLINE_MS,
  SHUTDOWN_SOFT_GRACE_MS,
  WATCHDOG_HEARTBEAT_INTERVAL_MS,
  WATCHDOG_MISSED_HEARTBEAT_LIMIT,
  WATCHDOG_PROCESS_SCAN_FALLBACK_MS,
} from './limits.js';
import { BoundedOutput, type OutputRead, type OutputState } from './output.js';
import { resolveUserPath } from './paths.js';
import {
  inspectProcess,
  listProcessGroupMembers,
  observableIdentityMatches,
  type ProcessObservation,
} from './watchdog.js';

export class ProcessManagerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProcessManagerError';
  }
}

export interface ProcessManagerOptions {
  statePath: string;
  outputBytes?: number;
  startupTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  missedHeartbeatLimit?: number;
  processScanFallbackMs?: number;
  softGraceMs?: number;
  absoluteDeadlineMs?: number;
}

export interface StartProcessOptions {
  executable: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ManagedProcessMetadata {
  wrapperPid: number;
  targetPid: number;
  pgid: number;
  launchId: string;
  wrapperExecutablePath: string;
  wrapperStartTime: number;
  targetExecutablePath: string;
  statePath: string;
}

export interface ManagedProcessResult {
  state: Exclude<OutputState, 'running'>;
  exitCode: number | null;
  signal: string | null;
}

interface ReadyMessage {
  type: 'ready';
  targetPid: number;
  pgid: number;
}

interface ExitMessage {
  type: 'exit';
  exitCode: number | null;
  signal: string | null;
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

interface OrphanedMessage {
  type: 'orphaned';
  reason: string;
}

type WrapperMessage = ReadyMessage | ExitMessage | ErrorMessage | OrphanedMessage;

type SignalProcessGroup = (pgid: number, signal: NodeJS.Signals) => void;

interface RequiredManagerOptions {
  statePath: string;
  outputBytes: number;
  startupTimeoutMs: number;
  heartbeatIntervalMs: number;
  missedHeartbeatLimit: number;
  processScanFallbackMs: number;
  softGraceMs: number;
  absoluteDeadlineMs: number;
  signalProcessGroup: SignalProcessGroup;
}

const DEFAULT_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 20;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function signalOwnedGroup(
  metadata: ManagedProcessMetadata,
  signal: NodeJS.Signals,
  deadline: number,
  signalProcessGroup: SignalProcessGroup,
): Promise<void> {
  while (true) {
    try {
      signalProcessGroup(metadata.pgid, signal);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        return;
      }
      if (code !== 'EPERM') {
        throw error;
      }

      const members = await validateOwnedGroup(metadata);
      if (members.length === 0) {
        return;
      }
      if (performance.now() >= deadline) {
        throw new ProcessManagerError(
          `Unable to signal owned process group ${metadata.pgid} with ${signal} before the shutdown deadline.`,
          { cause: error instanceof Error ? error : undefined },
        );
      }
      await sleep(Math.min(POLL_INTERVAL_MS, deadline - performance.now()));
    }
  }
}

async function validateOwnedGroup(
  metadata: ManagedProcessMetadata,
): Promise<ReturnType<typeof listProcessGroupMembers> extends Promise<infer T> ? T : never> {
  const wrapper = await inspectProcess(metadata.wrapperPid);
  const expectedWrapper = {
    pid: metadata.wrapperPid,
    startTime: metadata.wrapperStartTime,
    executablePath: metadata.wrapperExecutablePath,
  };

  if (wrapper !== null && !observableIdentityMatches(expectedWrapper, wrapper)) {
    throw new ProcessManagerError(`Wrapper PID ${metadata.wrapperPid} no longer matches its recorded identity.`);
  }

  const members = await listProcessGroupMembers(metadata.pgid);
  if (wrapper === null && members.some((member) => member.pid === metadata.pgid)) {
    throw new ProcessManagerError(`Process group ${metadata.pgid} has a new leader; ownership is uncertain.`);
  }
  return members;
}

async function terminateOwnedGroup(
  metadata: ManagedProcessMetadata,
  softGraceMs: number,
  absoluteDeadlineMs: number,
  signalProcessGroup: SignalProcessGroup,
): Promise<void> {
  let members = await validateOwnedGroup(metadata);
  if (members.length === 0) {
    return;
  }

  const startedAt = performance.now();
  const hardKillAt = startedAt + softGraceMs;
  const deadline = startedAt + absoluteDeadlineMs;
  await signalOwnedGroup(metadata, 'SIGTERM', deadline, signalProcessGroup);
  let hardKillSent = false;

  while (performance.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    members = await validateOwnedGroup(metadata);
    if (members.length === 0) {
      return;
    }
    if (!hardKillSent && performance.now() >= hardKillAt) {
      await signalOwnedGroup(metadata, 'SIGKILL', deadline, signalProcessGroup);
      hardKillSent = true;
    }
  }

  await signalOwnedGroup(metadata, 'SIGKILL', deadline, signalProcessGroup);
  await sleep(POLL_INTERVAL_MS);
  members = await validateOwnedGroup(metadata);
  if (members.length > 0) {
    throw new ProcessManagerError(
      `Process group ${metadata.pgid} still has members after the absolute shutdown deadline: ${members.map((member) => member.pid).join(', ')}`,
    );
  }
}

function environmentWithOverrides(overrides: Record<string, string> | undefined): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (key.includes('=') || key.includes('\0') || value.includes('\0')) {
      throw new ProcessManagerError(`Invalid environment override key: ${key}`);
    }
    environment[key] = value;
  }
  return environment;
}

function sendIpc(child: ChildProcess, message: object): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!child.connected) {
      reject(new ProcessManagerError('Child wrapper IPC channel is not connected.'));
      return;
    }
    child.send(message, (error) => {
      if (error === null) {
        resolve();
      } else {
        reject(new ProcessManagerError(`Unable to send child-wrapper message: ${error.message}`, { cause: error }));
      }
    });
  });
}

export class ManagedProcess {
  readonly output: BoundedOutput;
  readonly metadata: ManagedProcessMetadata;

  private readonly wrapper: ChildProcess;
  private readonly options: RequiredManagerOptions;
  private readonly onFinished: (job: ManagedProcess) => void;
  private readonly completion: Promise<ManagedProcessResult>;
  private resolveCompletion!: (result: ManagedProcessResult) => void;
  private rejectCompletion!: (error: Error) => void;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private timeoutTimer: NodeJS.Timeout | undefined;
  private finalizing = false;
  private finished = false;

  constructor(
    wrapper: ChildProcess,
    metadata: ManagedProcessMetadata,
    output: BoundedOutput,
    options: RequiredManagerOptions,
    timeoutMs: number | undefined,
    onFinished: (job: ManagedProcess) => void,
  ) {
    this.wrapper = wrapper;
    this.metadata = metadata;
    this.output = output;
    this.options = options;
    this.onFinished = onFinished;
    this.completion = new Promise((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });

    this.heartbeatTimer = setInterval(() => {
      if (this.wrapper.connected) {
        this.wrapper.send({ type: 'heartbeat' }, () => undefined);
      }
    }, options.heartbeatIntervalMs);

    if (timeoutMs !== undefined) {
      this.timeoutTimer = setTimeout(() => {
        void this.finish('timed-out', null, 'SIGTERM');
      }, timeoutMs);
    }
  }

  poll(cursor: number, maximumBytes?: number): OutputRead {
    return maximumBytes === undefined
      ? this.output.read(cursor)
      : this.output.read(cursor, maximumBytes);
  }

  wait(): Promise<ManagedProcessResult> {
    return this.completion;
  }

  cancel(): Promise<ManagedProcessResult> {
    void this.finish('cancelled', null, 'SIGTERM');
    return this.completion;
  }

  handleTargetExit(exitCode: number | null, signal: string | null): void {
    void this.finish('completed', exitCode, signal);
  }

  handleWrapperExit(exitCode: number | null, signal: NodeJS.Signals | null): void {
    if (this.finalizing || this.finished) {
      return;
    }
    setImmediate(() => {
      if (!this.finalizing && !this.finished) {
        void this.finish('completed', exitCode, signal);
      }
    });
  }

  handleWrapperError(error: Error): void {
    if (this.finalizing || this.finished) {
      return;
    }
    this.finalizing = true;
    this.clearTimers();
    this.rejectCompletion(new ProcessManagerError(`Child wrapper failed: ${error.message}`, { cause: error }));
    this.onFinished(this);
  }

  private async finish(
    state: ManagedProcessResult['state'],
    exitCode: number | null,
    signal: string | null,
  ): Promise<void> {
    if (this.finalizing || this.finished) {
      return;
    }
    this.finalizing = true;
    this.clearTimers();

    try {
      await terminateOwnedGroup(
        this.metadata,
        this.options.softGraceMs,
        this.options.absoluteDeadlineMs,
        this.options.signalProcessGroup,
      );

      if (state === 'completed') {
        this.output.complete(exitCode, signal);
      } else if (state === 'cancelled') {
        this.output.cancel(signal);
      } else {
        this.output.timeout(signal);
      }

      this.finished = true;
      this.resolveCompletion({ state, exitCode, signal });
    } catch (error) {
      this.rejectCompletion(error instanceof Error ? error : new ProcessManagerError(String(error)));
    } finally {
      this.onFinished(this);
    }
  }

  private clearTimers(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
    }
    if (this.timeoutTimer !== undefined) {
      clearTimeout(this.timeoutTimer);
    }
  }
}

export class ProcessManager {
  private readonly options: RequiredManagerOptions;
  private readonly jobs = new Set<ManagedProcess>();

  constructor(
    options: ProcessManagerOptions,
    signalProcessGroup: SignalProcessGroup = (pgid, signal) => {
      process.kill(-pgid, signal);
    },
  ) {
    this.options = {
      statePath: options.statePath,
      outputBytes: options.outputBytes ?? DEFAULT_OUTPUT_BYTES,
      startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? WATCHDOG_HEARTBEAT_INTERVAL_MS,
      missedHeartbeatLimit: options.missedHeartbeatLimit ?? WATCHDOG_MISSED_HEARTBEAT_LIMIT,
      processScanFallbackMs: options.processScanFallbackMs ?? WATCHDOG_PROCESS_SCAN_FALLBACK_MS,
      softGraceMs: options.softGraceMs ?? SHUTDOWN_SOFT_GRACE_MS,
      absoluteDeadlineMs: options.absoluteDeadlineMs ?? SHUTDOWN_ABSOLUTE_DEADLINE_MS,
      signalProcessGroup,
    };
  }

  async start(options: StartProcessOptions): Promise<ManagedProcess> {
    if (options.timeoutMs !== undefined
      && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new ProcessManagerError('timeoutMs must be a positive safe integer.');
    }

    const statePath = await realpath(resolveUserPath(this.options.statePath));
    const targetExecutablePath = await realpath(resolveUserPath(options.executable));
    const cwd = await realpath(resolveUserPath(options.cwd ?? process.cwd()));
    const parentIdentity = await inspectProcess(process.pid);
    if (parentIdentity === null) {
      throw new ProcessManagerError('Unable to inspect the Loom parent process identity.');
    }

    const output = new BoundedOutput(this.options.outputBytes);
    const wrapperPath = fileURLToPath(new URL('./child-wrapper.js', import.meta.url));
    const wrapper = spawn(process.execPath, [wrapperPath], {
      detached: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    wrapper.stdout?.on('data', (chunk: Buffer) => output.append('stdout', chunk));
    wrapper.stderr?.on('data', (chunk: Buffer) => output.append('stderr', chunk));

    const wrapperPid = wrapper.pid;
    if (wrapperPid === undefined) {
      wrapper.kill('SIGKILL');
      throw new ProcessManagerError('Child wrapper did not receive a PID.');
    }

    await new Promise<void>((resolve, reject) => {
      wrapper.once('spawn', resolve);
      wrapper.once('error', reject);
    }).catch((error) => {
      throw new ProcessManagerError(`Unable to spawn child wrapper: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    });

    const wrapperIdentity = await inspectProcess(wrapperPid);
    if (wrapperIdentity === null
      || wrapperIdentity.pgid !== wrapperPid
      || wrapperIdentity.executablePath !== await realpath(process.execPath)) {
      wrapper.kill('SIGKILL');
      throw new ProcessManagerError('Child wrapper did not start as the expected process-group leader.');
    }

    let managed: ManagedProcess | undefined;
    let pendingExit: ExitMessage | undefined;
    let pendingWrapperExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    let startupSettled = false;
    let readyResolve!: (message: ReadyMessage) => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<ReadyMessage>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const startupTimer = setTimeout(() => {
      if (startupSettled) return;
      startupSettled = true;
      readyReject(new ProcessManagerError('Child wrapper startup timed out.'));
    }, this.options.startupTimeoutMs);

    wrapper.on('message', (unknownMessage: unknown) => {
      const message = unknownMessage as WrapperMessage;
      if (message.type === 'ready' && !startupSettled) {
        startupSettled = true;
        clearTimeout(startupTimer);
        readyResolve(message);
        return;
      }
      if (message.type === 'error') {
        if (!startupSettled) {
          startupSettled = true;
          clearTimeout(startupTimer);
          readyReject(new ProcessManagerError(message.message));
        } else {
          managed?.handleWrapperError(new ProcessManagerError(message.message));
        }
        return;
      }
      if (message.type === 'exit') {
        if (managed === undefined) {
          pendingExit = message;
        } else {
          managed.handleTargetExit(message.exitCode, message.signal);
        }
      }
    });

    wrapper.on('error', (error) => {
      if (!startupSettled) {
        startupSettled = true;
        clearTimeout(startupTimer);
        readyReject(new ProcessManagerError(`Child wrapper error: ${error.message}`, { cause: error }));
      } else {
        managed?.handleWrapperError(error);
      }
    });
    wrapper.on('exit', (code, signal) => {
      if (!startupSettled) {
        startupSettled = true;
        clearTimeout(startupTimer);
        readyReject(new ProcessManagerError(
          `Child wrapper exited before readiness (code=${String(code)}, signal=${String(signal)}).`,
        ));
        return;
      }
      if (managed === undefined) {
        pendingWrapperExit = { code, signal };
      } else {
        managed.handleWrapperExit(code, signal);
      }
    });

    await sendIpc(wrapper, {
      type: 'start',
      executable: targetExecutablePath,
      args: options.args ?? [],
      cwd,
      env: environmentWithOverrides(options.env),
      parentIdentity: {
        pid: parentIdentity.pid,
        startTime: parentIdentity.startTime,
        executablePath: parentIdentity.executablePath,
      },
      heartbeatIntervalMs: this.options.heartbeatIntervalMs,
      missedHeartbeatLimit: this.options.missedHeartbeatLimit,
      processScanFallbackMs: this.options.processScanFallbackMs,
      softGraceMs: this.options.softGraceMs,
    });

    let readyMessage: ReadyMessage;
    try {
      readyMessage = await ready;
    } catch (error) {
      clearTimeout(startupTimer);
      const startupMetadata: ManagedProcessMetadata = {
        wrapperPid,
        targetPid: wrapperPid,
        pgid: wrapperPid,
        launchId: randomUUID(),
        wrapperExecutablePath: wrapperIdentity.executablePath,
        wrapperStartTime: wrapperIdentity.startTime,
        targetExecutablePath,
        statePath,
      };
      await terminateOwnedGroup(
        startupMetadata,
        this.options.softGraceMs,
        this.options.absoluteDeadlineMs,
        this.options.signalProcessGroup,
      ).catch(() => undefined);
      throw error;
    }

    if (readyMessage.pgid !== wrapperPid) {
      throw new ProcessManagerError(`Child wrapper reported unexpected PGID ${readyMessage.pgid}.`);
    }

    const metadata: ManagedProcessMetadata = {
      wrapperPid,
      targetPid: readyMessage.targetPid,
      pgid: readyMessage.pgid,
      launchId: randomUUID(),
      wrapperExecutablePath: wrapperIdentity.executablePath,
      wrapperStartTime: wrapperIdentity.startTime,
      targetExecutablePath,
      statePath,
    };

    managed = new ManagedProcess(
      wrapper,
      metadata,
      output,
      this.options,
      options.timeoutMs,
      (job) => this.jobs.delete(job),
    );
    this.jobs.add(managed);

    if (pendingExit !== undefined) {
      managed.handleTargetExit(pendingExit.exitCode, pendingExit.signal);
    }
    if (pendingWrapperExit !== undefined) {
      managed.handleWrapperExit(pendingWrapperExit.code, pendingWrapperExit.signal);
    }

    return managed;
  }

  get activeCount(): number {
    return this.jobs.size;
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.jobs].map((job) => job.cancel()));
  }
}
