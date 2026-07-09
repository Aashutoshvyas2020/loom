import { realpath, stat } from 'node:fs/promises';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { AuditLogger, type AuditFinishStatus, type AuditReceipt } from '../audit.js';
import {
  DEFAULT_TERMINAL_POLL_BYTES,
  MAX_TERMINAL_COMMAND_BYTES,
  MAX_TERMINAL_ENVIRONMENT_ENTRIES,
  MAX_TERMINAL_ENVIRONMENT_KEY_BYTES,
  MAX_TERMINAL_ENVIRONMENT_VALUE_BYTES,
  MAX_TERMINAL_POLL_BYTES,
  MAX_TERMINAL_RETAINED_JOBS,
  MAX_TERMINAL_TIMEOUT_MS,
  MAX_TERMINAL_TOTAL_ENVIRONMENT_BYTES,
  MAX_TERMINAL_WAIT_MS,
  TERMINAL_POLL_INTERVAL_MS,
} from '../limits.js';
import { ManagedProcess, ProcessManager } from '../process-manager.js';
import { resolveUserPath } from '../paths.js';
import type { OutputRead } from '../output.js';
import type { LoomToolDispatcher, LoomToolName } from './register.js';

const SHELL_EXECUTABLE = '/bin/sh';
const JOB_ID_PATTERN = /^job_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class TerminalToolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TerminalToolError';
  }
}

export class TerminalJobNotFoundError extends TerminalToolError {
  constructor(jobId: string) {
    super(`Unknown terminal job: ${jobId}`);
    this.name = 'TerminalJobNotFoundError';
  }
}

export class TerminalCapacityError extends TerminalToolError {
  constructor(maximum: number) {
    super(`Terminal job limit ${maximum} reached; every retained job is still running.`);
    this.name = 'TerminalCapacityError';
  }
}

export interface TerminalStartInput {
  command: string;
  cwd?: string;
  environment?: Record<string, string>;
  timeoutMs?: number;
}

export interface TerminalPollInput {
  jobId: string;
  cursor?: number;
  maxBytes?: number;
  waitMs?: number;
}

export interface TerminalCancelInput {
  jobId: string;
}

export interface TerminalToolServiceOptions {
  processManager: ProcessManager;
  audit: AuditLogger;
  maxRetainedJobs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface TerminalJob {
  process: ManagedProcess;
  completion: Promise<void>;
  createdSequence: number;
  finishedSequence?: number;
  startedAt: string;
}

type TerminalPublicStatus = 'running' | 'exited' | 'cancelled' | 'timed-out';

function validateSafeInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TerminalToolError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function validateCommand(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value) > MAX_TERMINAL_COMMAND_BYTES
    || value.includes('\u0000')) {
    throw new TerminalToolError(
      `command must be nonempty NUL-free UTF-8 text no larger than ${MAX_TERMINAL_COMMAND_BYTES} bytes.`,
    );
  }
  return value;
}

function validateEnvironment(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TerminalToolError('environment must be an object of string overrides.');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_TERMINAL_ENVIRONMENT_ENTRIES) {
    throw new TerminalToolError(`environment exceeds ${MAX_TERMINAL_ENVIRONMENT_ENTRIES} entries.`);
  }

  let totalBytes = 0;
  const output: Record<string, string> = {};
  for (const [key, entryValue] of entries) {
    if (!ENVIRONMENT_KEY_PATTERN.test(key)
      || Buffer.byteLength(key) > MAX_TERMINAL_ENVIRONMENT_KEY_BYTES) {
      throw new TerminalToolError(`Invalid environment variable name: ${JSON.stringify(key)}.`);
    }
    if (typeof entryValue !== 'string'
      || entryValue.includes('\u0000')
      || Buffer.byteLength(entryValue) > MAX_TERMINAL_ENVIRONMENT_VALUE_BYTES) {
      throw new TerminalToolError(`Invalid environment value for ${key}.`);
    }
    totalBytes += Buffer.byteLength(key) + Buffer.byteLength(entryValue);
    if (totalBytes > MAX_TERMINAL_TOTAL_ENVIRONMENT_BYTES) {
      throw new TerminalToolError(
        `environment exceeds ${MAX_TERMINAL_TOTAL_ENVIRONMENT_BYTES} total bytes.`,
      );
    }
    output[key] = entryValue;
  }
  return output;
}

function validateJobId(value: unknown): string {
  if (typeof value !== 'string' || !JOB_ID_PATTERN.test(value)) {
    throw new TerminalToolError('jobId is malformed.');
  }
  return value;
}

async function canonicalDirectory(input: unknown): Promise<string> {
  if (input !== undefined && typeof input !== 'string') {
    throw new TerminalToolError('cwd must be an absolute or home-relative path.');
  }
  let resolved = '';
  try {
    resolved = resolveUserPath(input ?? process.cwd());
    const canonical = await realpath(resolved);
    const stats = await stat(canonical);
    if (!stats.isDirectory()) {
      throw new TerminalToolError(`Terminal cwd is not a directory: ${resolved}`);
    }
    return canonical;
  } catch (error) {
    if (error instanceof TerminalToolError) throw error;
    throw new TerminalToolError(`Unable to resolve terminal cwd ${resolved}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function publicStatus(state: OutputRead['state']): TerminalPublicStatus {
  return state === 'completed' ? 'exited' : state;
}

function auditFinishStatus(state: OutputRead['state']): AuditFinishStatus {
  if (state === 'cancelled') return 'cancelled';
  if (state === 'timed-out') return 'timed-out';
  return state === 'completed' ? 'ok' : 'error';
}

function pollResult(jobId: string, process: ManagedProcess, read: OutputRead): CallToolResult {
  const text = read.segments.map((segment) => segment.text).join('');
  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      jobId,
      status: publicStatus(read.state),
      requestedCursor: read.requestedCursor,
      availableFrom: read.availableFrom,
      nextCursor: read.nextCursor,
      outputBytes: Buffer.byteLength(text),
      totalBytes: read.totalBytes,
      gap: read.gap,
      truncated: read.truncated,
      exitCode: read.exitCode,
      signal: read.signal,
      pgid: process.metadata.pgid,
    },
  };
}

function lifecycleResult(
  jobId: string,
  process: ManagedProcess,
  status: TerminalPublicStatus,
  startedAt: string,
): CallToolResult {
  return {
    content: [{ type: 'text', text: `Terminal job ${jobId} is ${status}.` }],
    structuredContent: {
      jobId,
      status,
      startedAt,
      pgid: process.metadata.pgid,
    },
  };
}

async function finishAudit(
  audit: AuditLogger,
  receipt: AuditReceipt,
  status: AuditFinishStatus,
): Promise<void> {
  await audit.recordFinish(receipt, status);
}

export class TerminalToolService {
  private readonly processManager: ProcessManager;
  private readonly audit: AuditLogger;
  private readonly maxRetainedJobs: number;
  private readonly pollIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly jobs = new Map<string, TerminalJob>();
  private sequence = 0;
  private finishSequence = 0;
  private accepting = true;

  constructor(options: TerminalToolServiceOptions) {
    this.processManager = options.processManager;
    this.audit = options.audit;
    this.maxRetainedJobs = validateSafeInteger(
      options.maxRetainedJobs ?? MAX_TERMINAL_RETAINED_JOBS,
      'maxRetainedJobs',
      1,
      1024,
    );
    this.pollIntervalMs = validateSafeInteger(
      options.pollIntervalMs ?? TERMINAL_POLL_INTERVAL_MS,
      'pollIntervalMs',
      1,
      1_000,
    );
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
  }

  stopAcceptingNewJobs(): void {
    this.accepting = false;
  }

  async start(input: TerminalStartInput): Promise<CallToolResult> {
    if (!this.accepting) {
      throw new TerminalToolError('Terminal service is stopping and rejects new jobs.');
    }
    const command = validateCommand(input.command);
    const cwd = await canonicalDirectory(input.cwd);
    const environment = validateEnvironment(input.environment);
    const timeoutMs = input.timeoutMs === undefined
      ? undefined
      : validateSafeInteger(input.timeoutMs, 'timeoutMs', 1, MAX_TERMINAL_TIMEOUT_MS);
    await this.makeCapacity();

    const receipt = await this.audit.recordMutationStart('terminal.start', {
      hasCwd: input.cwd !== undefined,
      hasEnvironment: environment !== undefined,
      hasTimeout: timeoutMs !== undefined,
    });

    let process: ManagedProcess;
    try {
      process = await this.processManager.start({
        executable: SHELL_EXECUTABLE,
        args: ['-lc', command],
        cwd,
        ...(environment === undefined ? {} : { env: environment }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
    } catch (error) {
      await finishAudit(this.audit, receipt, 'error');
      throw new TerminalToolError(`Unable to start terminal job: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }

    const jobId = `job_${process.metadata.launchId}`;
    const startedAt = new Date(this.now()).toISOString();
    this.sequence += 1;
    const job: TerminalJob = {
      process,
      completion: Promise.resolve(),
      createdSequence: this.sequence,
      startedAt,
    };
    this.jobs.set(jobId, job);
    job.completion = this.observeCompletion(job, receipt);
    void job.completion.catch(() => undefined);
    const status = publicStatus(process.poll(0, 1).state);
    return lifecycleResult(jobId, process, status, startedAt);
  }

  async poll(input: TerminalPollInput): Promise<CallToolResult> {
    const jobId = validateJobId(input.jobId);
    const cursor = input.cursor === undefined
      ? 0
      : validateSafeInteger(input.cursor, 'cursor', 0, Number.MAX_SAFE_INTEGER);
    const maxBytes = input.maxBytes === undefined
      ? DEFAULT_TERMINAL_POLL_BYTES
      : validateSafeInteger(input.maxBytes, 'maxBytes', 1, MAX_TERMINAL_POLL_BYTES);
    const waitMs = input.waitMs === undefined
      ? 0
      : validateSafeInteger(input.waitMs, 'waitMs', 0, MAX_TERMINAL_WAIT_MS);
    const job = this.requireJob(jobId);

    let read = job.process.poll(cursor, maxBytes);
    if (waitMs > 0
      && read.state === 'running'
      && read.nextCursor <= Math.max(cursor, read.availableFrom)) {
      const deadline = this.now() + waitMs;
      while (read.state === 'running' && this.now() < deadline) {
        await this.sleep(Math.min(this.pollIntervalMs, Math.max(1, deadline - this.now())));
        read = job.process.poll(cursor, maxBytes);
        if (read.state !== 'running'
          || read.gap
          || read.nextCursor > Math.max(cursor, read.availableFrom)) {
          break;
        }
      }
    }
    if (read.state !== 'running') {
      try {
        await job.completion;
      } catch (error) {
        throw new TerminalToolError(`Terminal job ${jobId} failed during cleanup: ${String(error)}`, {
          cause: error instanceof Error ? error : undefined,
        });
      }
      read = job.process.poll(cursor, maxBytes);
    }
    return pollResult(jobId, job.process, read);
  }

  async cancel(input: TerminalCancelInput): Promise<CallToolResult> {
    const jobId = validateJobId(input.jobId);
    let receipt: AuditReceipt | undefined;
    try {
      receipt = await this.audit.recordMutationStart('terminal.cancel', { jobId });
    } catch {
      // Cancellation reduces capability and must remain available when audit storage fails.
    }
    try {
      const job = this.requireJob(jobId);
      const before = job.process.poll(0, 1);
      if (before.state === 'running') {
        await job.process.cancel();
      }
      await job.completion;
      const after = job.process.poll(0, 1);
      if (receipt !== undefined) {
        await finishAudit(this.audit, receipt, auditFinishStatus(after.state));
      }
      return lifecycleResult(jobId, job.process, publicStatus(after.state), job.startedAt);
    } catch (error) {
      if (receipt !== undefined) {
        await finishAudit(this.audit, receipt, 'error');
      }
      if (error instanceof TerminalToolError) throw error;
      throw new TerminalToolError(`Unable to cancel terminal job ${jobId}: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  async shutdown(): Promise<void> {
    this.stopAcceptingNewJobs();
    const results = await Promise.allSettled(
      [...this.jobs.values()].map(async (job) => {
        if (job.process.poll(0, 1).state === 'running') {
          await job.process.cancel();
        }
        await job.completion;
      }),
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more terminal jobs failed to shut down cleanly.');
    }
  }

  private requireJob(jobId: string): TerminalJob {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new TerminalJobNotFoundError(jobId);
    return job;
  }

  private async makeCapacity(): Promise<void> {
    while (this.jobs.size >= this.maxRetainedJobs) {
      const finished = [...this.jobs.entries()].filter(([, job]) => (
        job.process.poll(0, 1).state !== 'running'
      ));
      if (finished.length === 0) {
        throw new TerminalCapacityError(this.maxRetainedJobs);
      }
      await Promise.all(finished.map(([, job]) => job.completion));
      let evictId: string | undefined;
      let oldestSequence = Number.MAX_SAFE_INTEGER;
      for (const [jobId, job] of finished) {
        const sequence = job.finishedSequence ?? Number.MAX_SAFE_INTEGER;
        if (sequence < oldestSequence) {
          evictId = jobId;
          oldestSequence = sequence;
        }
      }
      if (evictId === undefined) throw new TerminalCapacityError(this.maxRetainedJobs);
      this.jobs.delete(evictId);
    }
  }

  private observeCompletion(job: TerminalJob, receipt: AuditReceipt): Promise<void> {
    return job.process.wait().then(
      async (result) => {
        this.finishSequence += 1;
        job.finishedSequence = this.finishSequence;
        await finishAudit(this.audit, receipt, auditFinishStatus(result.state));
      },
      async (error) => {
        this.finishSequence += 1;
        job.finishedSequence = this.finishSequence;
        await finishAudit(this.audit, receipt, 'error');
        throw error;
      },
    );
  }
}

export function createTerminalToolDispatcher(
  service: TerminalToolService,
  fallback: LoomToolDispatcher,
): LoomToolDispatcher {
  return async (name: LoomToolName, arguments_: Record<string, unknown>) => {
    if (name !== 'loom_terminal') return fallback(name, arguments_);
    const { action, ...input } = arguments_;
    switch (action) {
      case 'start':
        return service.start(input as unknown as TerminalStartInput);
      case 'poll':
        return service.poll(input as unknown as TerminalPollInput);
      case 'cancel':
        return service.cancel(input as unknown as TerminalCancelInput);
      default:
        throw new TerminalToolError(`Unsupported loom_terminal action: ${String(action)}`);
    }
  };
}
