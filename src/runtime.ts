import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import { atomicWriteFile } from './atomic-file.js';
import { AuditLogger, type AuditFinishStatus } from './audit.js';
import {
  checkConfig,
  initializeState,
  readRuntimeLock,
  runtimeIdentityMatches,
  writeConfig,
  type LoomConfig,
  type RuntimeIdentity,
} from './config.js';
import { LoomDashboardServer } from './dashboard.js';
import { SHUTDOWN_ABSOLUTE_DEADLINE_MS } from './limits.js';
import { LoomMcpHttpServer } from './mcp.js';
import { assertNoSymlinkComponents, resolveUserPath } from './paths.js';
import { ProcessManager } from './process-manager.js';
import {
  BrowserNotReadyError,
  BrowserToolError,
  type BrowserBackend,
  type BrowserEvaluationResult,
  type BrowserScreenshotResult,
  type BrowserSnapshotResult,
  type BrowserStatusResult,
  type BrowserTab,
} from './browser.js';
import { ManagedChromiumBackend } from './browser/backend.js';
import { readChromiumInstallManifest } from './browser/setup.js';
import {
  NamedTunnelManager,
  QuickTunnelManager,
  cloudflaredReleaseFor,
  installCloudflaredRelease,
  verifyCloudflaredExecutable,
} from './cloudflare.js';
import { AuthStore } from './oauth.js';
import { BrowserToolService, createBrowserToolDispatcher } from './tools/browser.js';
import { FileToolService, createFileToolDispatcher } from './tools/files.js';
import { MemoryStoreService, createMemoryToolDispatcher } from './tools/memory.js';
import { SkillCatalogService, createSkillToolDispatcher, type SkillRoot } from './tools/skills.js';
import { TerminalToolService, createTerminalToolDispatcher } from './tools/terminal.js';
import type { LoomToolDispatcher } from './tools/register.js';
import { inspectProcess, observableIdentityMatches } from './watchdog.js';

export const FULL_ACCESS_WARNING = 'FULL COMPUTER ACCESS ENABLED — sharing the owner password or authorizing an untrusted client is equivalent to giving away this macOS account.';

export class RuntimeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeError';
  }
}

export class RuntimeEndpointError extends RuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeEndpointError';
  }
}

export class RuntimeStateError extends RuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeStateError';
  }
}

export class RuntimeStoppedError extends RuntimeError {
  constructor(message = 'Runtime was stopped during startup.') {
    super(message);
    this.name = 'RuntimeStoppedError';
  }
}

export class RuntimeShutdownDeadlineError extends RuntimeError {
  constructor(operation: string) {
    super(`Runtime shutdown exceeded its absolute deadline during ${operation}.`);
    this.name = 'RuntimeShutdownDeadlineError';
  }
}

export interface RuntimeMcpReadinessServer {
  readonly origin: string;
  readonly mcpUrl: string;
  bindPublicEndpoint(resource: string): Promise<void>;
}

export type RuntimeTunnelMode = 'quick' | 'named';

export interface RuntimeCurrentState {
  schemaVersion: 1;
  phase: 'not-ready' | 'ready';
  localOrigin: string;
  localMcpUrl: string;
  publicOrigin: string | null;
  publicMcpUrl: string | null;
  resource: string | null;
  tunnelMode: RuntimeTunnelMode | null;
  connectorReady: boolean;
  productionEligible: boolean;
  updatedAt: string;
}

export interface RuntimeReadinessOptions {
  stateRoot: string;
  mcp: RuntimeMcpReadinessServer;
  now?: () => Date;
}

const runtimeCurrentStateSchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.enum(['not-ready', 'ready']),
  localOrigin: z.url(),
  localMcpUrl: z.url(),
  publicOrigin: z.url().nullable(),
  publicMcpUrl: z.url().nullable(),
  resource: z.url().nullable(),
  tunnelMode: z.enum(['quick', 'named']).nullable(),
  connectorReady: z.boolean(),
  productionEligible: z.boolean(),
  updatedAt: z.iso.datetime(),
}).strict();

function currentUserId(): number {
  if (process.getuid === undefined) {
    throw new RuntimeStateError('Runtime ownership checks require POSIX.');
  }
  return process.getuid();
}

function freezeState(state: RuntimeCurrentState): RuntimeCurrentState {
  return Object.freeze({ ...state });
}

export function validateLocalMcpEndpoint(
  originValue: string,
  endpointValue: string,
): { localOrigin: string; localMcpUrl: string } {
  let origin: URL;
  let endpoint: URL;
  try {
    origin = new URL(originValue);
    endpoint = new URL(endpointValue);
  } catch (error) {
    throw new RuntimeEndpointError('Local MCP listener returned an invalid URL.', {
      cause: error instanceof Error ? error : undefined,
    });
  }

  const loopback = origin.hostname === '127.0.0.1'
    || origin.hostname === 'localhost'
    || origin.hostname === '[::1]';
  if (origin.protocol !== 'http:'
    || !loopback
    || origin.port === ''
    || origin.pathname !== '/'
    || origin.search !== ''
    || origin.hash !== ''
    || origin.username !== ''
    || origin.password !== ''
    || originValue !== origin.origin) {
    throw new RuntimeEndpointError(
      'MCP listener must be a bare loopback HTTP origin with an explicit port.',
    );
  }

  const expectedEndpoint = `${origin.origin}/mcp`;
  if (endpoint.protocol !== 'http:'
    || endpoint.origin !== origin.origin
    || endpoint.pathname !== '/mcp'
    || endpoint.search !== ''
    || endpoint.hash !== ''
    || endpoint.username !== ''
    || endpoint.password !== ''
    || endpointValue !== expectedEndpoint) {
    throw new RuntimeEndpointError('Local MCP URL must be exactly the listener origin plus /mcp.');
  }

  return {
    localOrigin: origin.origin,
    localMcpUrl: expectedEndpoint,
  };
}

export function canonicalPublicEndpoint(publicOriginValue: string): {
  publicOrigin: string;
  publicMcpUrl: string;
} {
  let origin: URL;
  try {
    origin = new URL(publicOriginValue);
  } catch (error) {
    throw new RuntimeEndpointError('Public endpoint must be a valid HTTPS origin.', {
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (origin.protocol !== 'https:'
    || origin.port !== ''
    || origin.pathname !== '/'
    || origin.search !== ''
    || origin.hash !== ''
    || origin.username !== ''
    || origin.password !== ''
    || publicOriginValue !== origin.origin) {
    throw new RuntimeEndpointError(
      'Public endpoint must be a bare HTTPS origin without credentials, port, path, query, or fragment.',
    );
  }

  return {
    publicOrigin: origin.origin,
    publicMcpUrl: `${origin.origin}/mcp`,
  };
}

async function validateRuntimeCurrentTarget(
  stateRoot: string,
  state: RuntimeCurrentState,
): Promise<RuntimeCurrentState> {
  const parsed = runtimeCurrentStateSchema.safeParse(state);
  if (!parsed.success) {
    throw new RuntimeStateError(`Invalid runtime state: ${z.prettifyError(parsed.error)}`);
  }

  const runtimeDirectory = path.join(stateRoot, 'runtime');
  const currentPath = path.join(runtimeDirectory, 'current.json');
  try {
    await assertNoSymlinkComponents(runtimeDirectory);
    await assertNoSymlinkComponents(currentPath);
    const stats = await lstat(runtimeDirectory);
    if (stats.isSymbolicLink()
      || !stats.isDirectory()
      || stats.uid !== currentUserId()
      || (stats.mode & 0o777) !== 0o700) {
      throw new RuntimeStateError(
        `Runtime directory must be a private 0700 directory: ${runtimeDirectory}`,
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof RuntimeStateError) throw error;
    throw new RuntimeStateError(`Unable to validate runtime state target: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function serializeRuntimeCurrent(state: RuntimeCurrentState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

async function writeRuntimeCurrent(
  stateRoot: string,
  state: RuntimeCurrentState,
): Promise<void> {
  const parsed = await validateRuntimeCurrentTarget(stateRoot, state);
  try {
    await atomicWriteFile(
      path.join(stateRoot, 'runtime', 'current.json'),
      serializeRuntimeCurrent(parsed),
    );
  } catch (error) {
    throw new RuntimeStateError(`Unable to write runtime state: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export class RuntimeReadiness {
  private readonly stateRoot: string;
  private readonly mcp: RuntimeMcpReadinessServer;
  private readonly now: () => Date;
  private current: RuntimeCurrentState | undefined;

  constructor(options: RuntimeReadinessOptions) {
    this.stateRoot = resolveUserPath(options.stateRoot);
    this.mcp = options.mcp;
    this.now = options.now ?? (() => new Date());
  }

  get status(): RuntimeCurrentState | undefined {
    return this.current === undefined ? undefined : freezeState(this.current);
  }

  async persistNotReady(): Promise<RuntimeCurrentState> {
    const local = validateLocalMcpEndpoint(this.mcp.origin, this.mcp.mcpUrl);
    const state = freezeState({
      schemaVersion: 1,
      phase: 'not-ready',
      ...local,
      publicOrigin: null,
      publicMcpUrl: null,
      resource: null,
      tunnelMode: null,
      connectorReady: false,
      productionEligible: false,
      updatedAt: this.now().toISOString(),
    });
    await writeRuntimeCurrent(this.stateRoot, state);
    this.current = state;
    return freezeState(state);
  }

  async bindPublicOrigin(input: {
    publicOrigin: string;
    tunnelMode: RuntimeTunnelMode;
  }): Promise<RuntimeCurrentState> {
    const local = validateLocalMcpEndpoint(this.mcp.origin, this.mcp.mcpUrl);
    const publicEndpoint = canonicalPublicEndpoint(input.publicOrigin);
    const state = freezeState({
      schemaVersion: 1,
      phase: 'ready',
      ...local,
      ...publicEndpoint,
      resource: publicEndpoint.publicMcpUrl,
      tunnelMode: input.tunnelMode,
      connectorReady: true,
      productionEligible: input.tunnelMode === 'named',
      updatedAt: this.now().toISOString(),
    });
    await validateRuntimeCurrentTarget(this.stateRoot, state);
    await this.mcp.bindPublicEndpoint(publicEndpoint.publicMcpUrl);
    await writeRuntimeCurrent(this.stateRoot, state);
    this.current = state;
    return freezeState(state);
  }

  async removeOwnedState(): Promise<void> {
    const currentPath = path.join(this.stateRoot, 'runtime', 'current.json');
    const expected = this.current;
    if (expected === undefined) {
      try {
        await lstat(currentPath);
      } catch (error) {
        if (nestedErrorCode(error) === 'ENOENT') return;
        throw new RuntimeStateError(`Unable to inspect runtime current state: ${String(error)}`, {
          cause: error instanceof Error ? error : undefined,
        });
      }
      throw new RuntimeStateError(
        'Runtime current state exists without an owned readiness snapshot; refusing removal.',
      );
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await assertNoSymlinkComponents(currentPath);
      handle = await open(currentPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()
        || before.uid !== BigInt(currentUserId())
        || (Number(before.mode) & 0o777) !== 0o600) {
        throw new RuntimeStateError(
          'Runtime current state is not the expected private current-user regular file.',
        );
      }
      const contents = await handle.readFile({ encoding: 'utf8' });
      const after = await handle.stat({ bigint: true });
      const pathname = await lstat(currentPath, { bigint: true });
      const stable = before.dev === after.dev
        && before.ino === after.ino
        && before.size === after.size
        && before.mtimeNs === after.mtimeNs
        && before.ctimeNs === after.ctimeNs
        && pathname.dev === before.dev
        && pathname.ino === before.ino
        && pathname.size === before.size
        && pathname.mtimeNs === before.mtimeNs
        && pathname.ctimeNs === before.ctimeNs;
      if (!stable || contents !== serializeRuntimeCurrent(expected)) {
        throw new RuntimeStateError(
          'Runtime current state changed after Loom wrote it; refusing removal.',
        );
      }
    } catch (error) {
      if (error instanceof RuntimeStateError) throw error;
      if (nestedErrorCode(error) === 'ENOENT') {
        throw new RuntimeStateError(
          'Runtime current state changed after Loom wrote it; refusing removal.',
          { cause: error instanceof Error ? error : undefined },
        );
      }
      throw new RuntimeStateError(`Unable to verify runtime current state: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    } finally {
      await handle?.close().catch(() => undefined);
    }

    await rm(currentPath);
    this.current = undefined;
  }
}

export function formatRuntimeStatusBlock(state: RuntimeCurrentState): string {
  const tunnel = state.tunnelMode === 'quick'
    ? 'Quick'
    : state.tunnelMode === 'named'
      ? 'Named'
      : 'not connected';
  const production = state.productionEligible ? 'eligible' : 'no';
  return [
    `MCP: ${state.phase === 'ready' ? 'ready' : 'not ready'}`,
    `Local MCP: ${state.localMcpUrl}`,
    `Public MCP: ${state.publicMcpUrl ?? 'pending'}`,
    `Tunnel: ${tunnel}`,
    `Connector: ${state.connectorReady ? 'ready' : 'not ready'}`,
    `Production: ${production}`,
    FULL_ACCESS_WARNING,
  ].join('\n');
}


export interface RuntimeBrowserLifecycle {
  start(): Promise<{ available: boolean; running: boolean; version: string | null }>;
  shutdown(): Promise<void>;
}

export interface RuntimeTunnelLifecycle {
  readonly mode: RuntimeTunnelMode;
  start(): Promise<{ mode: RuntimeTunnelMode; publicOrigin: string }>;
  stop(): Promise<void>;
}

export interface RuntimeSignalSource {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export interface ForegroundRuntimeStatus {
  phase: 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
  localMcpUrl: string | null;
  publicMcpUrl: string | null;
  dashboardUrl: string | null;
  tunnelMode: RuntimeTunnelMode | null;
  connectorReady: boolean;
  productionEligible: boolean;
  browser: 'pending' | 'running' | 'unavailable' | 'stopped';
  browserVersion: string | null;
  skills: 'pending' | 'ready' | 'stopped';
  skillCount: number;
  memory: 'pending' | 'ready' | 'stopped';
  memoryCount: number;
  audit: 'healthy' | 'degraded' | 'closed';
  stopReason: string | null;
}

export interface RuntimeLockOptions {
  stateRoot: string;
  now?: () => Date;
}

function nestedErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export class RuntimeLock {
  readonly stateRoot: string;
  private readonly now: () => Date;
  private identity: RuntimeIdentity | undefined;

  constructor(options: RuntimeLockOptions) {
    this.stateRoot = resolveUserPath(options.stateRoot);
    this.now = options.now ?? (() => new Date());
  }

  get currentIdentity(): RuntimeIdentity | undefined {
    return this.identity === undefined ? undefined : { ...this.identity };
  }

  async acquire(): Promise<RuntimeIdentity> {
    if (this.identity !== undefined) return { ...this.identity };
    const canonicalStateRoot = await realpath(this.stateRoot);
    const runtimeDirectory = path.join(canonicalStateRoot, 'runtime');
    const lockPath = path.join(runtimeDirectory, 'loom.lock');
    await assertNoSymlinkComponents(lockPath);

    try {
      const prior = await readRuntimeLock(canonicalStateRoot);
      const observed = await inspectProcess(prior.pid);
      if (observed !== null && observableIdentityMatches(prior, observed)) {
        throw new RuntimeStateError(`Loom is already running with PID ${prior.pid}.`);
      }
      const rechecked = await readRuntimeLock(canonicalStateRoot);
      if (!runtimeIdentityMatches(prior, rechecked)) {
        throw new RuntimeStateError('Runtime lock changed while stale ownership was being verified.');
      }
      await assertNoSymlinkComponents(lockPath);
      await rm(lockPath);
    } catch (error) {
      if (error instanceof RuntimeStateError) throw error;
      if (nestedErrorCode(error) !== 'ENOENT') {
        throw new RuntimeStateError(`Unable to validate prior runtime lock: ${String(error)}`, {
          cause: error instanceof Error ? error : undefined,
        });
      }
    }

    const observed = await inspectProcess(process.pid);
    if (observed === null) {
      throw new RuntimeStateError('Unable to observe the current Loom runtime process.');
    }
    const identity: RuntimeIdentity = {
      pid: observed.pid,
      startTime: observed.startTime,
      executablePath: observed.executablePath,
      launchId: randomUUID(),
      statePath: canonicalStateRoot,
    };

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(`${JSON.stringify(identity, null, 2)}\n`);
      await handle.sync();
    } catch (error) {
      if (nestedErrorCode(error) === 'EEXIST') {
        throw new RuntimeStateError('Another Loom runtime acquired the lock concurrently.');
      }
      throw new RuntimeStateError(`Unable to acquire runtime lock: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    } finally {
      await handle?.close().catch(() => undefined);
    }
    this.identity = identity;
    void this.now();
    return { ...identity };
  }

  async release(): Promise<void> {
    const identity = this.identity;
    if (identity === undefined) return;
    const runtimeDirectory = path.join(identity.statePath, 'runtime');
    const lockPath = path.join(runtimeDirectory, 'loom.lock');
    const currentPath = path.join(runtimeDirectory, 'current.json');
    let persisted: RuntimeIdentity;
    try {
      persisted = await readRuntimeLock(identity.statePath);
    } catch (error) {
      if (nestedErrorCode(error) === 'ENOENT') {
        this.identity = undefined;
        return;
      }
      throw new RuntimeStateError(`Unable to verify runtime lock before removal: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
    if (!runtimeIdentityMatches(identity, persisted)) {
      throw new RuntimeStateError('Runtime lock ownership changed; refusing to remove it.');
    }
    const observed = await inspectProcess(identity.pid);
    if (observed === null || !observableIdentityMatches(identity, observed)) {
      throw new RuntimeStateError(
        'Runtime process identity changed; refusing to remove runtime ownership files.',
      );
    }
    await assertNoSymlinkComponents(currentPath);
    await assertNoSymlinkComponents(lockPath);
    await rm(currentPath, { force: true });
    await rm(lockPath);
    this.identity = undefined;
  }
}

export interface ForegroundLoomRuntimeOptions {
  stateRoot: string;
  runtimeLock: RuntimeLock;
  audit: AuditLogger;
  processManager: ProcessManager;
  terminal: TerminalToolService;
  mcp: LoomMcpHttpServer;
  dashboard: LoomDashboardServer;
  skills: SkillCatalogService;
  memory: MemoryStoreService;
  browser: RuntimeBrowserLifecycle;
  tunnel: RuntimeTunnelLifecycle;
  statusWriter(text: string): void;
  openDashboard(url: string): Promise<void>;
  shutdownDeadlineMs?: number;
  now?: () => Date;
}

function cloneForegroundStatus(status: ForegroundRuntimeStatus): ForegroundRuntimeStatus {
  return { ...status };
}

export function formatForegroundRuntimeStatus(status: ForegroundRuntimeStatus): string {
  return [
    `MCP: ${status.phase === 'ready' ? 'ready' : status.phase}`,
    `Browser: ${status.browser}${status.browserVersion === null ? '' : ` (${status.browserVersion})`}`,
    `Skills: ${status.skills}${status.skills === 'ready' ? ` (${status.skillCount})` : ''}`,
    `Memory: ${status.memory}${status.memory === 'ready' ? ` (${status.memoryCount})` : ''}`,
    `Tunnel: ${status.tunnelMode === 'quick' ? 'Quick' : status.tunnelMode === 'named' ? 'Named' : 'pending'}`,
    `Connector: ${status.connectorReady ? 'ready' : 'not ready'}`,
    `Audit: ${status.audit}`,
    `Local MCP: ${status.localMcpUrl ?? 'pending'}`,
    `Public MCP: ${status.publicMcpUrl ?? 'pending'}`,
    `Dashboard: ${status.dashboardUrl ?? 'pending'}`,
    `Production: ${status.productionEligible ? 'eligible' : 'no'}`,
    FULL_ACCESS_WARNING,
  ].join('\n');
}

export class ForegroundLoomRuntime {
  private readonly options: ForegroundLoomRuntimeOptions;
  private readonly readiness: RuntimeReadiness;
  private readonly shutdownDeadlineMs: number;
  private readonly now: () => Date;
  private currentStatus: ForegroundRuntimeStatus = {
    phase: 'idle',
    localMcpUrl: null,
    publicMcpUrl: null,
    dashboardUrl: null,
    tunnelMode: null,
    connectorReady: false,
    productionEligible: false,
    browser: 'pending',
    browserVersion: null,
    skills: 'pending',
    skillCount: 0,
    memory: 'pending',
    memoryCount: 0,
    audit: 'healthy',
    stopReason: null,
  };
  private startPromise: Promise<ForegroundRuntimeStatus> | undefined;
  private stopPromise: Promise<void> | undefined;
  private startedMcp = false;
  private startedDashboard = false;
  private attemptedBrowser = false;
  private attemptedTunnel = false;
  private statusPrinted = false;
  private lifecycleVersion = 0;
  private resolveStopped!: () => void;
  private readonly stoppedPromise = new Promise<void>((resolve) => {
    this.resolveStopped = resolve;
  });

  constructor(options: ForegroundLoomRuntimeOptions) {
    this.options = options;
    this.readiness = new RuntimeReadiness({
      stateRoot: options.stateRoot,
      mcp: options.mcp,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    this.shutdownDeadlineMs = options.shutdownDeadlineMs ?? SHUTDOWN_ABSOLUTE_DEADLINE_MS;
    if (!Number.isSafeInteger(this.shutdownDeadlineMs) || this.shutdownDeadlineMs <= 0) {
      throw new RuntimeError('shutdownDeadlineMs must be a positive safe integer.');
    }
    this.now = options.now ?? (() => new Date());
  }

  get status(): ForegroundRuntimeStatus {
    return cloneForegroundStatus(this.currentStatus);
  }

  start(): Promise<ForegroundRuntimeStatus> {
    if (this.currentStatus.phase === 'ready') return Promise.resolve(this.status);
    if (this.startPromise !== undefined) return this.startPromise;
    if (this.currentStatus.phase !== 'idle') {
      return Promise.reject(new RuntimeError(`Runtime cannot start from phase ${this.currentStatus.phase}.`));
    }
    const lifecycleVersion = this.lifecycleVersion;
    this.startPromise = this.startInternal(lifecycleVersion).finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  stop(reason = 'requested'): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    if (this.currentStatus.phase === 'stopped') return Promise.resolve();
    this.lifecycleVersion += 1;
    this.stopPromise = this.stopInternal(reason).finally(() => {
      this.stopPromise = undefined;
    });
    return this.stopPromise;
  }

  waitUntilStopped(): Promise<void> {
    return this.stoppedPromise;
  }

  private assertStartActive(lifecycleVersion: number): void {
    if (lifecycleVersion !== this.lifecycleVersion) throw new RuntimeStoppedError();
  }

  private async startInternal(lifecycleVersion: number): Promise<ForegroundRuntimeStatus> {
    this.currentStatus.phase = 'starting';
    try {
      await this.options.runtimeLock.acquire();
      this.assertStartActive(lifecycleVersion);
      await this.options.mcp.listen();
      this.startedMcp = true;
      this.assertStartActive(lifecycleVersion);
      const notReady = await this.readiness.persistNotReady();
      this.assertStartActive(lifecycleVersion);
      this.currentStatus.localMcpUrl = notReady.localMcpUrl;

      await this.options.dashboard.listen();
      this.startedDashboard = true;
      this.assertStartActive(lifecycleVersion);
      this.currentStatus.dashboardUrl = this.options.dashboard.origin;

      await this.options.skills.rescan();
      this.assertStartActive(lifecycleVersion);
      const skillSnapshot = this.options.skills.getSnapshot();
      this.currentStatus.skills = 'ready';
      this.currentStatus.skillCount = skillSnapshot.skills.length;

      await this.options.memory.rescan();
      this.assertStartActive(lifecycleVersion);
      const memorySnapshot = this.options.memory.getSnapshot();
      this.currentStatus.memory = 'ready';
      this.currentStatus.memoryCount = memorySnapshot.memories.length;

      this.attemptedBrowser = true;
      const browser = await this.options.browser.start();
      this.assertStartActive(lifecycleVersion);
      this.currentStatus.browser = browser.available && browser.running ? 'running' : 'unavailable';
      this.currentStatus.browserVersion = browser.version;

      this.attemptedTunnel = true;
      const tunnel = await this.options.tunnel.start();
      this.assertStartActive(lifecycleVersion);
      const ready = await this.readiness.bindPublicOrigin({
        publicOrigin: tunnel.publicOrigin,
        tunnelMode: tunnel.mode,
      });
      this.assertStartActive(lifecycleVersion);
      this.currentStatus.phase = 'ready';
      this.currentStatus.publicMcpUrl = ready.publicMcpUrl;
      this.currentStatus.tunnelMode = ready.tunnelMode;
      this.currentStatus.connectorReady = ready.connectorReady;
      this.currentStatus.productionEligible = ready.productionEligible;
      this.currentStatus.audit = this.options.audit.degraded ? 'degraded' : 'healthy';

      if (!this.statusPrinted) {
        this.options.statusWriter(formatForegroundRuntimeStatus(this.currentStatus));
        this.statusPrinted = true;
      }
      await this.options.openDashboard(this.options.dashboard.createBootstrapUrl()).catch(() => undefined);
      this.assertStartActive(lifecycleVersion);
      return this.status;
    } catch (error) {
      if (!(error instanceof RuntimeStoppedError)) this.currentStatus.phase = 'failed';
      await this.stop(error instanceof RuntimeStoppedError ? 'startup-stopped' : 'startup-failure')
        .catch(() => undefined);
      throw error;
    }
  }

  private async stopInternal(reason: string): Promise<void> {
    if (this.currentStatus.phase === 'stopped') return;
    this.currentStatus.phase = 'stopping';
    this.currentStatus.stopReason = reason;
    this.options.terminal.stopAcceptingNewJobs();
    const failures: unknown[] = [];
    const deadline = performance.now() + this.shutdownDeadlineMs;
    const run = async (name: string, operation: () => Promise<void>): Promise<void> => {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        failures.push(new RuntimeShutdownDeadlineError(name));
        void operation().catch(() => undefined);
        return;
      }
      let timer: NodeJS.Timeout | undefined;
      const operationPromise = operation();
      void operationPromise.catch(() => undefined);
      try {
        await Promise.race([
          operationPromise,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new RuntimeShutdownDeadlineError(name)),
              remaining,
            );
            timer.unref?.();
          }),
        ]);
      } catch (error) {
        failures.push(error);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    };

    await run('terminal shutdown', () => this.options.terminal.shutdown());
    if (this.attemptedBrowser) await run('browser shutdown', () => this.options.browser.shutdown());
    this.currentStatus.browser = 'stopped';
    if (this.attemptedTunnel) await run('tunnel shutdown', () => this.options.tunnel.stop());
    if (this.startedMcp) await run('MCP shutdown', () => this.options.mcp.close());
    if (this.startedDashboard) await run('dashboard shutdown', () => this.options.dashboard.close());
    await run('process supervisor shutdown', () => this.options.processManager.shutdownAll());
    await run('audit close', () => this.options.audit.close());
    this.currentStatus.audit = 'closed';
    if (failures.length === 0 && this.options.processManager.activeCount === 0) {
      await run('runtime current state removal', () => this.readiness.removeOwnedState());
      if (failures.length === 0) {
        await run('runtime lock removal', () => this.options.runtimeLock.release());
      }
    } else if (failures.length === 0) {
      failures.push(new RuntimeStateError(
        'Process supervisor still owns jobs; preserving runtime ownership files.',
      ));
    }

    this.currentStatus.phase = failures.length === 0 ? 'stopped' : 'failed';
    this.currentStatus.connectorReady = false;
    this.currentStatus.productionEligible = false;
    this.currentStatus.skills = 'stopped';
    this.currentStatus.memory = 'stopped';
    this.resolveStopped();
    if (failures.length > 0) {
      const details = failures.map((failure) => (
        failure instanceof Error ? failure.message : String(failure)
      )).join('; ');
      throw new AggregateError(failures, `Runtime shutdown failed: ${details}`);
    }
  }
}

export async function runRuntimeForeground(
  runtime: ForegroundLoomRuntime,
  signalSource: RuntimeSignalSource = process,
): Promise<void> {
  let signalStop: Promise<void> | undefined;
  const requestStop = (): void => {
    signalStop ??= runtime.stop('signal');
    void signalStop.catch(() => undefined);
  };
  signalSource.on('SIGINT', requestStop);
  signalSource.on('SIGTERM', requestStop);
  try {
    try {
      await runtime.start();
    } catch (error) {
      if (signalStop === undefined || !(error instanceof RuntimeStoppedError)) throw error;
    }
    await runtime.waitUntilStopped();
    await signalStop;
  } finally {
    signalSource.off('SIGINT', requestStop);
    signalSource.off('SIGTERM', requestStop);
  }
}


class UnavailableBrowserBackend implements BrowserBackend, RuntimeBrowserLifecycle {
  async start(): Promise<{ available: boolean; running: boolean; version: string | null }> {
    return { available: false, running: false, version: null };
  }

  async status(): Promise<BrowserStatusResult> {
    return { running: false, tabs: 0, version: null };
  }

  async tabs(): Promise<BrowserTab[]> { return []; }
  async open(): Promise<BrowserTab> { throw new BrowserNotReadyError('Pinned Chromium is not installed. Run: loom setup browser'); }
  async navigate(): Promise<BrowserTab> { throw new BrowserNotReadyError('Pinned Chromium is not installed.'); }
  async snapshot(): Promise<BrowserSnapshotResult> { throw new BrowserNotReadyError('Pinned Chromium is not installed.'); }
  async click(): Promise<{ tabId: string; url: string }> { throw new BrowserNotReadyError('Pinned Chromium is not installed.'); }
  async type(): Promise<{ tabId: string; url: string }> { throw new BrowserNotReadyError('Pinned Chromium is not installed.'); }
  async evaluate(): Promise<BrowserEvaluationResult> { throw new BrowserNotReadyError('Pinned Chromium is not installed.'); }
  async screenshot(): Promise<BrowserScreenshotResult> { throw new BrowserNotReadyError('Pinned Chromium is not installed.'); }
  async close(): Promise<{ tabId: string }> { throw new BrowserNotReadyError('Pinned Chromium is not installed.'); }
  async grantPermissions(): Promise<{ origin: string; permissions: string[] }> { throw new BrowserNotReadyError('Pinned Chromium is not installed.'); }
  async clearPermissions(input: { origin?: string }): Promise<{ origin?: string }> { return input; }
  async setGeolocation(): Promise<{ origin: string; latitude: number; longitude: number; accuracy?: number }> { throw new BrowserNotReadyError('Pinned Chromium is not installed.'); }
  async shutdown(): Promise<void> {}
}

class ManagedBrowserLifecycle implements RuntimeBrowserLifecycle {
  private readonly backend: ManagedChromiumBackend;
  private readonly version: string;

  constructor(backend: ManagedChromiumBackend, version: string) {
    this.backend = backend;
    this.version = version;
  }

  async start(): Promise<{ available: boolean; running: boolean; version: string | null }> {
    try {
      await this.backend.open({ url: 'about:blank' });
      const status = await this.backend.status();
      return {
        available: true,
        running: status.running,
        version: status.version ?? this.version,
      };
    } catch (error) {
      if (!(error instanceof BrowserToolError)) throw error;
      await this.backend.shutdown().catch(() => undefined);
      return { available: false, running: false, version: null };
    }
  }

  async restart(): Promise<void> {
    await this.backend.shutdown();
    await this.backend.open({ url: 'about:blank' });
  }

  async shutdown(): Promise<void> {
    await this.backend.shutdown();
  }
}

class DeferredCloudflareTunnel implements RuntimeTunnelLifecycle {
  readonly mode: RuntimeTunnelMode;
  private readonly config: LoomConfig['tunnel'];
  private readonly stateRoot: string;
  private readonly processManager: ProcessManager;
  private readonly audit: AuditLogger;
  private readonly localOrigin: () => string;
  private manager: QuickTunnelManager | NamedTunnelManager | undefined;

  constructor(options: {
    config: LoomConfig['tunnel'];
    stateRoot: string;
    processManager: ProcessManager;
    audit: AuditLogger;
    localOrigin: () => string;
  }) {
    this.config = options.config;
    this.mode = options.config.type;
    this.stateRoot = options.stateRoot;
    this.processManager = options.processManager;
    this.audit = options.audit;
    this.localOrigin = options.localOrigin;
  }

  async start(): Promise<{ mode: RuntimeTunnelMode; publicOrigin: string }> {
    if (this.manager !== undefined) {
      const status = this.manager.status;
      if (status.publicOrigin !== null) return { mode: this.mode, publicOrigin: status.publicOrigin };
      throw new RuntimeError('Cloudflare tunnel manager exists without a ready public origin.');
    }
    const release = cloudflaredReleaseFor(process.arch);
    const installationDirectory = path.join(this.stateRoot, 'cloudflared');
    const executablePath = path.join(installationDirectory, 'cloudflared');
    let verified;
    try {
      verified = await verifyCloudflaredExecutable({
        executablePath,
        expectedSha256: release.executableSha256,
        expectedVersion: release.version,
        processManager: this.processManager,
      });
    } catch {
      verified = await installCloudflaredRelease({
        installationDirectory,
        release,
        processManager: this.processManager,
      });
    }

    if (this.config.type === 'quick') {
      const manager = new QuickTunnelManager({
        audit: this.audit,
        processManager: this.processManager,
        executablePath: verified.executablePath,
        expectedSha256: verified.sha256,
        expectedVersion: verified.version,
        localOrigin: this.localOrigin(),
        cwd: this.stateRoot,
      });
      this.manager = manager;
      const ready = await manager.start();
      return { mode: 'quick', publicOrigin: ready.publicOrigin };
    }

    const manager = new NamedTunnelManager({
      audit: this.audit,
      processManager: this.processManager,
      executablePath: verified.executablePath,
      expectedSha256: verified.sha256,
      expectedVersion: verified.version,
      localOrigin: this.localOrigin(),
      tunnelName: this.config.name,
      hostname: this.config.hostname,
      credentialsFile: this.config.credentialsFile,
      cwd: this.stateRoot,
    });
    this.manager = manager;
    const ready = await manager.start();
    return { mode: 'named', publicOrigin: ready.publicOrigin };
  }

  async stop(): Promise<void> {
    const manager = this.manager;
    if (manager === undefined) return;
    await manager.stop();
    this.manager = undefined;
  }
}

function standardSkillRoots(config: LoomConfig): SkillRoot[] {
  const candidates: SkillRoot[] = [
    { namespace: 'claude', path: path.join(homedir(), '.claude', 'skills') },
    { namespace: 'codex', path: path.join(homedir(), '.codex', 'skills') },
    { namespace: 'agents', path: path.join(homedir(), '.agents', 'skills') },
    { namespace: 'gemini', path: path.join(homedir(), '.gemini', 'skills') },
    ...config.extraRoots.map((root, index) => ({
      namespace: `extra-${index + 1}`,
      path: resolveUserPath(root),
    })),
  ];
  const seen = new Set<string>();
  return candidates.filter((root) => {
    const resolved = resolveUserPath(root.path);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

function dashboardConfigPayload(input: unknown): { tunnel: unknown; extraRoots: unknown } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new RuntimeError('Dashboard configuration payload must be an object.');
  }
  const record = input as Record<string, unknown>;
  return { tunnel: record.tunnel, extraRoots: record.extraRoots };
}

async function openMacOsTarget(
  processManager: ProcessManager,
  stateRoot: string,
  target: string,
): Promise<void> {
  const job = await processManager.start({
    executable: '/usr/bin/open',
    args: [target],
    cwd: stateRoot,
    timeoutMs: 10_000,
  });
  const result = await job.wait();
  if (result.state !== 'completed' || result.exitCode !== 0) {
    throw new RuntimeError('Unable to open the local Loom target.');
  }
}

async function auditedAction(
  audit: AuditLogger,
  operation: string,
  action: () => Promise<void>,
): Promise<void> {
  const receipt = await audit.recordMutationStart(operation, {});
  let status: AuditFinishStatus = 'error';
  try {
    await action();
    status = 'ok';
  } finally {
    await audit.recordFinish(receipt, status);
  }
}

async function createDefaultBrowser(options: {
  stateRoot: string;
  processManager: ProcessManager;
  audit: AuditLogger;
}): Promise<{ backend: BrowserBackend; lifecycle: RuntimeBrowserLifecycle; restart(): Promise<void> }> {
  const installationDirectory = path.join(options.stateRoot, 'browser');
  try {
    const manifest = await readChromiumInstallManifest(installationDirectory);
    const backend = new ManagedChromiumBackend({
      processManager: options.processManager,
      audit: options.audit,
      executablePath: manifest.executablePath,
      expectedSha256: manifest.executableSha256,
      profileDirectory: path.join(options.stateRoot, 'browser-profile'),
      runtimeDirectory: path.join(options.stateRoot, 'runtime'),
      downloadsDirectory: path.join(options.stateRoot, 'downloads'),
      screenshotsDirectory: path.join(options.stateRoot, 'downloads', 'screenshots'),
    });
    const lifecycle = new ManagedBrowserLifecycle(backend, manifest.chromiumVersion);
    return { backend, lifecycle, restart: () => lifecycle.restart() };
  } catch (error) {
    if (nestedErrorCode(error) !== 'ENOENT'
      && !(error instanceof BrowserToolError)
      && !(error instanceof SyntaxError)) {
      throw error;
    }
    const backend = new UnavailableBrowserBackend();
    return { backend, lifecycle: backend, restart: async () => undefined };
  }
}

export interface CreateDefaultRuntimeOptions {
  stateRoot?: string;
  statusWriter?: (text: string) => void;
  openDashboard?: (url: string) => Promise<void>;
  browserOverride?: { backend: BrowserBackend; lifecycle: RuntimeBrowserLifecycle; restart(): Promise<void> };
  tunnelOverride?: RuntimeTunnelLifecycle;
  skillRootsOverride?: SkillRoot[];
}

export interface CreatedDefaultRuntime {
  runtime: ForegroundLoomRuntime;
  ownerPassword: string | null;
  stateRoot: string;
}

export async function createDefaultForegroundRuntime(
  options: CreateDefaultRuntimeOptions = {},
): Promise<CreatedDefaultRuntime> {
  const stateRoot = resolveUserPath(options.stateRoot ?? '~/.loom');
  await initializeState(stateRoot);
  const config = await checkConfig(stateRoot);
  const runtimeLock = new RuntimeLock({ stateRoot });
  await runtimeLock.acquire();

  let audit: AuditLogger | undefined;
  let processManager: ProcessManager | undefined;
  try {
    audit = await AuditLogger.create({ auditDirectory: path.join(stateRoot, 'audit') });
    processManager = new ProcessManager({ statePath: stateRoot });
    const opened = await AuthStore.open(stateRoot);
    const terminal = new TerminalToolService({ processManager, audit });
    const skills = new SkillCatalogService({
      roots: options.skillRootsOverride ?? standardSkillRoots(config),
      audit,
    });
    const memory = new MemoryStoreService({
      memoryDirectory: path.join(stateRoot, 'memory'),
      audit,
    });
    const files = new FileToolService({ audit });
    const browser = options.browserOverride ?? await createDefaultBrowser({
      stateRoot,
      processManager,
      audit,
    });
    const browserTools = new BrowserToolService({ backend: browser.backend, audit });
    const unreachable: LoomToolDispatcher = async (name) => {
      throw new RuntimeError(`No dispatcher handled ${name}.`);
    };
    const dispatcher = createTerminalToolDispatcher(
      terminal,
      createFileToolDispatcher(
        files,
        createSkillToolDispatcher(
          skills,
          createMemoryToolDispatcher(
            memory,
            createBrowserToolDispatcher(browserTools, unreachable),
          ),
        ),
      ),
    );
    const mcp = new LoomMcpHttpServer({ authStore: opened.store, dispatcher });
    const tunnel = options.tunnelOverride ?? new DeferredCloudflareTunnel({
      config: config.tunnel,
      stateRoot,
      processManager,
      audit,
      localOrigin: () => mcp.origin,
    });

    let runtime: ForegroundLoomRuntime | undefined;
    const dashboard = new LoomDashboardServer({
      status: () => runtime?.status ?? { phase: 'starting' },
      actions: {
        rescanCatalog: async () => {
          await skills.rescan();
          await memory.rescan();
        },
        restartBrowser: async () => auditedAction(audit!, 'dashboard.browser.restart', browser.restart),
        revealAuditFolder: async () => auditedAction(
          audit!,
          'dashboard.audit.reveal',
          () => openMacOsTarget(processManager!, stateRoot, path.join(stateRoot, 'audit')),
        ),
        updateConfig: async (input) => auditedAction(audit!, 'dashboard.config.update', async () => {
          const payload = dashboardConfigPayload(input);
          await writeConfig(stateRoot, {
            version: 1,
            tunnel: payload.tunnel,
            extraRoots: payload.extraRoots,
          });
        }),
        revokeAllOAuth: async () => auditedAction(audit!, 'dashboard.oauth.revoke_all', async () => {
          await opened.store.revokeAllOAuth();
        }),
        stopLoom: async () => { await runtime?.stop('dashboard'); },
      },
    });

    runtime = new ForegroundLoomRuntime({
      stateRoot,
      runtimeLock,
      audit,
      processManager,
      terminal,
      mcp,
      dashboard,
      skills,
      memory,
      browser: browser.lifecycle,
      tunnel,
      statusWriter: options.statusWriter ?? ((text) => process.stdout.write(`${text}\n`)),
      openDashboard: options.openDashboard
        ?? ((url) => openMacOsTarget(processManager!, stateRoot, url)),
    });
    return { runtime, ownerPassword: opened.ownerPassword, stateRoot };
  } catch (error) {
    await processManager?.shutdownAll().catch(() => undefined);
    await audit?.close().catch(() => undefined);
    await runtimeLock.release().catch(() => undefined);
    throw error;
  }
}
