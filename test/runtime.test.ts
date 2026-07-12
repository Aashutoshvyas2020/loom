import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initializeState } from '../src/config.js';
import { LoomMcpHttpServer } from '../src/mcp.js';
import { AuthStore } from '../src/oauth.js';
import {
  FULL_ACCESS_WARNING,
  RuntimeEndpointError,
  RuntimeReadiness,
  canonicalPublicEndpoint,
  formatRuntimeStatusBlock,
  validateLocalMcpEndpoint,
} from '../src/runtime.js';

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), 'loom-runtime-readiness-')));
}

class FakeMcpServer {
  readonly origin: string;
  readonly mcpUrl: string;
  readonly bindings: string[] = [];

  constructor(origin: string, mcpUrl = `${origin}/mcp`) {
    this.origin = origin;
    this.mcpUrl = mcpUrl;
  }

  async bindPublicEndpoint(resource: string): Promise<void> {
    this.bindings.push(resource);
  }
}

test('runtime readiness validates exact loopback and public MCP endpoints', () => {
  assert.deepEqual(
    validateLocalMcpEndpoint('http://127.0.0.1:43123', 'http://127.0.0.1:43123/mcp'),
    {
      localOrigin: 'http://127.0.0.1:43123',
      localMcpUrl: 'http://127.0.0.1:43123/mcp',
    },
  );
  assert.deepEqual(canonicalPublicEndpoint('https://loom.example.com'), {
    publicOrigin: 'https://loom.example.com',
    publicMcpUrl: 'https://loom.example.com/mcp',
  });

  assert.throws(
    () => validateLocalMcpEndpoint('http://0.0.0.0:43123', 'http://0.0.0.0:43123/mcp'),
    RuntimeEndpointError,
  );
  assert.throws(
    () => validateLocalMcpEndpoint('http://127.0.0.1:43123', 'http://127.0.0.1:43123/other'),
    RuntimeEndpointError,
  );
  for (const invalid of [
    'http://loom.example.com',
    'https://loom.example.com:8443',
    'https://user:pass@loom.example.com',
    'https://loom.example.com/path',
    'https://loom.example.com?query=1',
    'https://loom.example.com/#fragment',
  ]) {
    assert.throws(() => canonicalPublicEndpoint(invalid), RuntimeEndpointError);
  }
});

test('runtime readiness persists NOT_READY then binds canonical public resource and writes private ready state', async () => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const mcp = new FakeMcpServer('http://127.0.0.1:43123');
  const readiness = new RuntimeReadiness({
    stateRoot,
    mcp,
    now: () => new Date('2026-07-08T23:30:00.000Z'),
  });

  const pending = await readiness.persistNotReady();
  assert.equal(pending.phase, 'not-ready');
  assert.equal(pending.publicMcpUrl, null);
  assert.equal(mcp.bindings.length, 0);

  const ready = await readiness.bindPublicOrigin({
    publicOrigin: 'https://loom.example.com',
    tunnelMode: 'quick',
  });
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.publicMcpUrl, 'https://loom.example.com/mcp');
  assert.equal(ready.resource, 'https://loom.example.com/mcp');
  assert.equal(ready.productionEligible, false);
  assert.deepEqual(mcp.bindings, ['https://loom.example.com/mcp']);

  const runtimePath = path.join(stateRoot, 'runtime', 'current.json');
  assert.equal((await stat(runtimePath)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(runtimePath, 'utf8')), ready);

  const status = formatRuntimeStatusBlock(ready);
  assert.match(status, /MCP: ready/);
  assert.match(status, /Local MCP: http:\/\/127\.0\.0\.1:43123\/mcp/);
  assert.match(status, /Public MCP: https:\/\/loom\.example\.com\/mcp/);
  assert.match(status, /Tunnel: Quick/);
  assert.match(status, /Production: no/);
  assert.match(status, new RegExp(FULL_ACCESS_WARNING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('invalid public binding is rejected before MCP binding or runtime-state replacement', async () => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const mcp = new FakeMcpServer('http://127.0.0.1:43123');
  const readiness = new RuntimeReadiness({ stateRoot, mcp });
  const pending = await readiness.persistNotReady();
  const runtimePath = path.join(stateRoot, 'runtime', 'current.json');
  const before = await readFile(runtimePath);

  await assert.rejects(
    readiness.bindPublicOrigin({
      publicOrigin: 'http://insecure.example.com',
      tunnelMode: 'named',
    }),
    RuntimeEndpointError,
  );
  assert.equal(mcp.bindings.length, 0);
  assert.deepEqual(await readFile(runtimePath), before);
  assert.deepEqual(JSON.parse(before.toString('utf8')), pending);
});


test('real MCP route transitions from NOT_READY to endpoint-bound OAuth through runtime readiness', async (t) => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const opened = await AuthStore.open(stateRoot);
  const server = new LoomMcpHttpServer({
    authStore: opened.store,
    dispatcher: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  });
  await server.listen();
  t.after(() => server.close());

  const initializeRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'runtime-readiness-test', version: '1.0.0' },
    },
  };
  const before = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify(initializeRequest),
  });
  assert.equal(before.status, 503);
  assert.match(JSON.stringify(await before.json()), /NOT_READY/);

  const readiness = new RuntimeReadiness({ stateRoot, mcp: server });
  await readiness.persistNotReady();
  const ready = await readiness.bindPublicOrigin({
    publicOrigin: 'https://loom.example.com',
    tunnelMode: 'named',
  });
  assert.equal(ready.resource, 'https://loom.example.com/mcp');
  assert.equal(ready.productionEligible, true);

  const after = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify(initializeRequest),
  });
  assert.equal(after.status, 401);
  assert.match(
    after.headers.get('www-authenticate') ?? '',
    /resource_metadata="https:\/\/loom\.example\.com\/\.well-known\/oauth-protected-resource\/mcp"/,
  );

  const metadata = await fetch(
    `${server.origin}/.well-known/oauth-protected-resource/mcp`,
  );
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), {
    resource: 'https://loom.example.com/mcp',
    authorization_servers: ['https://loom.example.com'],
    scopes_supported: ['loom:tools'],
  });
});


test('runtime readiness validates the runtime-state target before public MCP binding', async () => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const mcp = new FakeMcpServer('http://127.0.0.1:43123');
  const readiness = new RuntimeReadiness({ stateRoot, mcp });
  await readiness.persistNotReady();
  const runtimePath = path.join(stateRoot, 'runtime', 'current.json');
  const before = await readFile(runtimePath);
  await chmod(path.join(stateRoot, 'runtime'), 0o755);

  await assert.rejects(
    readiness.bindPublicOrigin({
      publicOrigin: 'https://loom.example.com',
      tunnelMode: 'named',
    }),
    /private 0700 directory/,
  );
  assert.equal(mcp.bindings.length, 0);
  assert.deepEqual(await readFile(runtimePath), before);
});


test('runtime readiness rejects a symlinked current state before public MCP binding', async () => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const mcp = new FakeMcpServer('http://127.0.0.1:43123');
  const readiness = new RuntimeReadiness({ stateRoot, mcp });
  await readiness.persistNotReady();
  const runtimePath = path.join(stateRoot, 'runtime', 'current.json');
  const targetPath = path.join(stateRoot, 'runtime', 'attacker.json');
  await writeFile(targetPath, 'attacker target', { mode: 0o600 });
  await rm(runtimePath);
  await symlink(targetPath, runtimePath);

  await assert.rejects(
    readiness.bindPublicOrigin({
      publicOrigin: 'https://loom.example.com',
      tunnelMode: 'quick',
    }),
    /Symbolic-link path component/,
  );
  assert.equal(mcp.bindings.length, 0);
  assert.equal(await readFile(targetPath, 'utf8'), 'attacker target');
});

// T14 integrated foreground runtime coverage.
import { EventEmitter } from 'node:events';
import { access, mkdir } from 'node:fs/promises';

import { AuditLogger } from '../src/audit.js';
import type {
  BrowserBackend,
  BrowserEvaluationResult,
  BrowserScreenshotResult,
  BrowserSnapshotResult,
  BrowserStatusResult,
  BrowserTab,
} from '../src/browser.js';
import { LoomDashboardServer } from '../src/dashboard.js';
import { ProcessManager } from '../src/process-manager.js';
import {
  ForegroundLoomRuntime,
  createDefaultForegroundRuntime,
  RuntimeLock,
  RuntimeStoppedError,
  runRuntimeForeground,
  type RuntimeBrowserLifecycle,
  type RuntimeTunnelLifecycle,
} from '../src/runtime.js';
import { BrowserToolService, createBrowserToolDispatcher } from '../src/tools/browser.js';
import { FileToolService, createFileToolDispatcher } from '../src/tools/files.js';
import { MemoryStoreService, createMemoryToolDispatcher } from '../src/tools/memory.js';
import { SkillCatalogService, createSkillToolDispatcher } from '../src/tools/skills.js';
import { TerminalToolService, createTerminalToolDispatcher } from '../src/tools/terminal.js';
import type { LoomToolDispatcher } from '../src/tools/register.js';
import { inspectProcess, listProcessGroupMembers } from '../src/watchdog.js';

class RuntimeTestBrowserBackend implements BrowserBackend, RuntimeBrowserLifecycle {
  readonly events: string[];
  private running = false;

  constructor(events: string[]) {
    this.events = events;
  }

  async start(): Promise<{ available: boolean; running: boolean; version: string | null }> {
    this.events.push('browser.start');
    this.running = true;
    return { available: true, running: true, version: 'test-browser' };
  }

  async status(): Promise<BrowserStatusResult> {
    return { running: this.running, tabs: 0, version: this.running ? 'test-browser' : null };
  }

  async tabs(): Promise<BrowserTab[]> { return []; }
  async open(): Promise<BrowserTab> { throw new Error('unused'); }
  async navigate(): Promise<BrowserTab> { throw new Error('unused'); }
  async snapshot(): Promise<BrowserSnapshotResult> { throw new Error('unused'); }
  async click(): Promise<{ tabId: string; url: string }> { throw new Error('unused'); }
  async type(): Promise<{ tabId: string; url: string }> { throw new Error('unused'); }
  async evaluate(): Promise<BrowserEvaluationResult> { throw new Error('unused'); }
  async screenshot(): Promise<BrowserScreenshotResult> { throw new Error('unused'); }
  async close(): Promise<{ tabId: string }> { throw new Error('unused'); }
  async grantPermissions(): Promise<{ origin: string; permissions: string[] }> { throw new Error('unused'); }
  async clearPermissions(): Promise<{ origin?: string }> { return {}; }
  async setGeolocation(): Promise<{ origin: string; latitude: number; longitude: number; accuracy?: number }> { throw new Error('unused'); }

  async shutdown(): Promise<void> {
    this.events.push('browser.stop');
    this.running = false;
  }
}

class RuntimeTestTunnel implements RuntimeTunnelLifecycle {
  readonly mode = 'quick' as const;
  readonly events: string[];
  readonly publicOrigin: string;
  private readonly failure: Error | undefined;

  constructor(events: string[], publicOrigin: string, failure?: Error) {
    this.events = events;
    this.publicOrigin = publicOrigin;
    this.failure = failure;
  }

  async start(): Promise<{ mode: 'quick'; publicOrigin: string }> {
    this.events.push('tunnel.start');
    if (this.failure !== undefined) throw this.failure;
    return { mode: 'quick', publicOrigin: this.publicOrigin };
  }

  async stop(): Promise<void> {
    this.events.push('tunnel.stop');
  }
}

class BlockingRuntimeTunnel implements RuntimeTunnelLifecycle {
  readonly mode = 'quick' as const;
  readonly entered: Promise<void>;
  private enter!: () => void;
  private release!: () => void;
  private readonly released: Promise<void>;

  constructor(private readonly events: string[]) {
    this.entered = new Promise((resolve) => { this.enter = resolve; });
    this.released = new Promise((resolve) => { this.release = resolve; });
  }

  async start(): Promise<{ mode: 'quick'; publicOrigin: string }> {
    this.events.push('tunnel.start');
    this.enter();
    await this.released;
    return { mode: 'quick', publicOrigin: 'https://blocked-runtime.trycloudflare.com' };
  }

  async stop(): Promise<void> {
    this.events.push('tunnel.stop');
    this.release();
  }
}

async function createIntegratedRuntime(
  options: {
    tunnelFailure?: Error;
    events?: string[];
    tunnel?: RuntimeTunnelLifecycle;
    shutdownDeadlineMs?: number;
  } = {},
) {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const audit = await AuditLogger.create({ auditDirectory: path.join(stateRoot, 'audit') });
  const processManager = new ProcessManager({
    statePath: stateRoot,
    outputBytes: 64 * 1024,
    heartbeatIntervalMs: 50,
    missedHeartbeatLimit: 3,
    processScanFallbackMs: 100,
    softGraceMs: 100,
    absoluteDeadlineMs: 2_000,
  });
  const terminal = new TerminalToolService({ processManager, audit });
  const skillsDirectory = path.join(stateRoot, 'test-skills');
  await mkdir(skillsDirectory, { mode: 0o700 });
  const skills = new SkillCatalogService({
    roots: [{ namespace: 'test', path: skillsDirectory }],
    audit,
  });
  const memory = new MemoryStoreService({
    memoryDirectory: path.join(stateRoot, 'memory'),
    audit,
  });
  const files = new FileToolService({ audit });
  const events = options.events ?? [];
  const browserBackend = new RuntimeTestBrowserBackend(events);
  const browserTools = new BrowserToolService({ backend: browserBackend, audit });
  const unreachable: LoomToolDispatcher = async (name) => {
    throw new Error(`Unreachable fallback for ${name}`);
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
  const opened = await AuthStore.open(stateRoot);
  const mcp = new LoomMcpHttpServer({ authStore: opened.store, dispatcher });
  let runtime: ForegroundLoomRuntime | undefined;
  const dashboard = new LoomDashboardServer({
    status: () => runtime?.status ?? { phase: 'starting' },
    actions: {
      rescanCatalog: async () => { await skills.rescan(); await memory.rescan(); },
      restartBrowser: async () => undefined,
      revealAuditFolder: async () => undefined,
      updateConfig: async () => undefined,
      rotateOwnerPassword: async () => ({ ownerPassword: 'unused-runtime-password' }),
      revokeAllOAuth: async () => undefined,
      stopLoom: async () => { await runtime?.stop('dashboard'); },
    },
  });
  const tunnel = options.tunnel ?? new RuntimeTestTunnel(
    events,
    'https://runtime-test.trycloudflare.com',
    options.tunnelFailure,
  );
  const statusWrites: string[] = [];
  const runtimeLock = new RuntimeLock({ stateRoot });
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
    browser: browserBackend,
    tunnel,
    statusWriter: (text: string) => { statusWrites.push(text); },
    openDashboard: async () => { events.push('dashboard.open'); },
    shutdownDeadlineMs: options.shutdownDeadlineMs ?? 5_000,
  });
  return {
    stateRoot,
    audit,
    processManager,
    terminal,
    mcp,
    dashboard,
    browserBackend,
    tunnel,
    runtimeLock,
    runtime,
    statusWrites,
    events,
  };
}

test('foreground runtime starts real local services, publishes once, and cleans in reverse order', async () => {
  const fixture = await createIntegratedRuntime();
  const started = await fixture.runtime.start();
  assert.equal(started.phase, 'ready');
  assert.equal(started.publicMcpUrl, 'https://runtime-test.trycloudflare.com/mcp');
  assert.equal(fixture.statusWrites.length, 1);
  assert.match(fixture.statusWrites[0]!, /Browser: running/);
  assert.match(fixture.statusWrites[0]!, /Skills: ready/);
  assert.match(fixture.statusWrites[0]!, /Memory: ready/);
  assert.match(fixture.statusWrites[0]!, /Audit: healthy/);
  assert.match(fixture.statusWrites[0]!, /Dashboard: http:\/\/127\.0\.0\.1:/);
  assert.match(fixture.statusWrites[0]!, /Production: no/);
  assert.match(fixture.statusWrites[0]!, new RegExp(FULL_ACCESS_WARNING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  await access(path.join(fixture.stateRoot, 'runtime', 'loom.lock'));
  await access(path.join(fixture.stateRoot, 'runtime', 'current.json'));
  const mcpBeforeStop = await fetch(fixture.mcp.mcpUrl, {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'runtime', version: '1' } } }),
  });
  assert.equal(mcpBeforeStop.status, 401);

  const terminalJob = await fixture.terminal.start({
    command: 'echo runtime-job-ready; sleep 30',
    cwd: fixture.stateRoot,
  });
  const jobId = terminalJob.structuredContent?.jobId as string;
  const polled = await fixture.terminal.poll({ jobId, waitMs: 500 });
  const pgid = polled.structuredContent?.pgid as number;
  assert.equal((await listProcessGroupMembers(pgid)).length > 0, true);

  const localMcpUrl = fixture.mcp.mcpUrl;
  const dashboardUrl = fixture.dashboard.origin;
  await fixture.runtime.stop('test');
  await fixture.runtime.stop('test-repeat');
  assert.equal((await listProcessGroupMembers(pgid)).length, 0);
  await assert.rejects(fetch(localMcpUrl), /fetch failed|ECONNREFUSED/i);
  await assert.rejects(fetch(dashboardUrl), /fetch failed|ECONNREFUSED/i);
  await assert.rejects(access(path.join(fixture.stateRoot, 'runtime', 'loom.lock')));
  await assert.rejects(access(path.join(fixture.stateRoot, 'runtime', 'current.json')));
  assert.equal(fixture.events.indexOf('browser.stop') < fixture.events.indexOf('tunnel.stop'), true);
  assert.equal(fixture.processManager.activeCount, 0);
});

test('runtime startup failure cleans every started component and never publishes public readiness', async () => {
  const events: string[] = [];
  const fixture = await createIntegratedRuntime({
    tunnelFailure: new Error('controlled tunnel failure'),
    events,
  });
  await assert.rejects(fixture.runtime.start(), /controlled tunnel failure/);
  assert.equal(fixture.statusWrites.length, 0);
  assert.equal(events.includes('browser.start'), true);
  assert.equal(events.includes('browser.stop'), true);
  assert.equal(events.includes('tunnel.start'), true);
  assert.equal(events.includes('tunnel.stop'), true);
  await assert.rejects(access(path.join(fixture.stateRoot, 'runtime', 'loom.lock')));
  await assert.rejects(access(path.join(fixture.stateRoot, 'runtime', 'current.json')));
  assert.equal(fixture.processManager.activeCount, 0);
});

test('foreground signal runner handles SIGTERM-style stop and removes runtime ownership', async () => {
  const fixture = await createIntegratedRuntime();
  const signals = new EventEmitter();
  const running = runRuntimeForeground(fixture.runtime, signals);
  while (fixture.statusWrites.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  signals.emit('SIGTERM');
  await running;
  await assert.rejects(access(path.join(fixture.stateRoot, 'runtime', 'loom.lock')));
  assert.equal(fixture.processManager.activeCount, 0);
});

test('signal during tunnel startup prevents public readiness and process recreation', async () => {
  const events: string[] = [];
  const tunnel = new BlockingRuntimeTunnel(events);
  const fixture = await createIntegratedRuntime({ events, tunnel });
  const signals = new EventEmitter();
  const running = runRuntimeForeground(fixture.runtime, signals);
  await tunnel.entered;
  signals.emit('SIGTERM');
  await running;
  assert.equal(fixture.statusWrites.length, 0);
  assert.equal(events.filter((entry) => entry === 'tunnel.start').length, 1);
  assert.equal(events.filter((entry) => entry === 'tunnel.stop').length, 1);
  assert.equal(fixture.runtime.status.phase, 'stopped');
  assert.equal(fixture.runtime.status.connectorReady, false);
  await assert.rejects(access(path.join(fixture.stateRoot, 'runtime', 'loom.lock')));
  await assert.rejects(access(path.join(fixture.stateRoot, 'runtime', 'current.json')));
});

test('direct stop during tunnel startup rejects the start promise with RuntimeStoppedError', async () => {
  const events: string[] = [];
  const tunnel = new BlockingRuntimeTunnel(events);
  const fixture = await createIntegratedRuntime({ events, tunnel });
  const starting = fixture.runtime.start();
  await tunnel.entered;
  await fixture.runtime.stop('test-stop-during-start');
  await assert.rejects(starting, RuntimeStoppedError);
  assert.equal(fixture.statusWrites.length, 0);
  assert.equal(fixture.processManager.activeCount, 0);
});

test('shutdown deadline is real and preserves runtime ownership when cleanup is uncertain', async () => {
  const fixture = await createIntegratedRuntime({ shutdownDeadlineMs: 50 });
  await fixture.runtime.start();
  const originalShutdown = fixture.terminal.shutdown.bind(fixture.terminal);
  let releaseBlocked!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseBlocked = resolve; });
  (fixture.terminal as unknown as { shutdown: () => Promise<void> }).shutdown = async () => blocked;
  const startedAt = Date.now();
  await assert.rejects(fixture.runtime.stop('deadline-test'), /absolute deadline/i);
  assert.equal(Date.now() - startedAt < 500, true);
  await access(path.join(fixture.stateRoot, 'runtime', 'loom.lock'));

  releaseBlocked();
  await originalShutdown();
  await fixture.browserBackend.shutdown().catch(() => undefined);
  await fixture.tunnel.stop().catch(() => undefined);
  await fixture.mcp.close().catch(() => undefined);
  await fixture.dashboard.close().catch(() => undefined);
  await fixture.processManager.shutdownAll();
  await fixture.audit.close().catch(() => undefined);
  await fixture.runtimeLock.release();
});

test('runtime lock rejects a live owner and refuses to remove a replaced lock', async () => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const first = new RuntimeLock({ stateRoot });
  const identity = await first.acquire();
  await assert.rejects(new RuntimeLock({ stateRoot }).acquire(), /already running/i);

  const lockPath = path.join(stateRoot, 'runtime', 'loom.lock');
  await writeFile(lockPath, `${JSON.stringify({ ...identity, launchId: 'replacement-launch' })}\n`, {
    mode: 0o600,
  });
  await assert.rejects(first.release(), /ownership changed/i);
  await access(lockPath);

  await writeFile(lockPath, `${JSON.stringify(identity)}\n`, { mode: 0o600 });
  await first.release();
  await first.release();
  await assert.rejects(access(lockPath));
});

test('runtime preserves ownership when current state is replaced after readiness', async () => {
  const fixture = await createIntegratedRuntime();
  await fixture.runtime.start();
  const currentPath = path.join(fixture.stateRoot, 'runtime', 'current.json');
  const lockPath = path.join(fixture.stateRoot, 'runtime', 'loom.lock');
  const replacement = '{"replacement":true}\n';
  await writeFile(currentPath, replacement, { mode: 0o600 });

  await assert.rejects(
    fixture.runtime.stop('current-state-replaced'),
    /current state changed after Loom wrote it/i,
  );
  assert.equal(await readFile(currentPath, 'utf8'), replacement);
  await access(lockPath);
  assert.equal(fixture.processManager.activeCount, 0);

  await rm(currentPath);
  await fixture.runtimeLock.release();
  await assert.rejects(access(lockPath));
});


test('default runtime factory assembles the production graph without network when explicit lifecycles are supplied', async () => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const skillRoot = path.join(stateRoot, 'factory-skills');
  await mkdir(skillRoot, { mode: 0o700 });
  const events: string[] = [];
  const browser = new RuntimeTestBrowserBackend(events);
  const tunnel = new RuntimeTestTunnel(events, 'https://factory-test.trycloudflare.com');
  const statusWrites: string[] = [];
  const openedDashboards: string[] = [];

  const created = await createDefaultForegroundRuntime({
    stateRoot,
    statusWriter: (text) => { statusWrites.push(text); },
    openDashboard: async (url) => { openedDashboards.push(url); },
    browserOverride: {
      backend: browser,
      lifecycle: browser,
      restart: async () => { events.push('browser.restart'); },
    },
    tunnelOverride: tunnel,
    skillRootsOverride: [{ namespace: 'factory', path: skillRoot }],
  });
  assert.ok(created.ownerPassword);
  await access(path.join(stateRoot, 'runtime', 'loom.lock'));

  const ready = await created.runtime.start();
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.publicMcpUrl, 'https://factory-test.trycloudflare.com/mcp');
  assert.equal(statusWrites.length, 1);
  assert.match(statusWrites[0]!, /Browser: running/);
  assert.equal(openedDashboards.length, 1);
  assert.match(openedDashboards[0]!, /^http:\/\/127\.0\.0\.1:\d+\/\?nonce=/);
  await created.runtime.stop('factory-test');
  await assert.rejects(access(path.join(stateRoot, 'runtime', 'loom.lock')));
  await assert.rejects(access(path.join(stateRoot, 'runtime', 'current.json')));

  const reopened = await AuthStore.open(stateRoot);
  assert.equal(reopened.ownerPassword, null);
  assert.equal(await reopened.store.verifyOwnerPassword(created.ownerPassword), true);
});


test('default runtime degrades browser tools when the pinned browser manifest is absent', async () => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const skillRoot = path.join(stateRoot, 'degraded-skills');
  await mkdir(skillRoot, { mode: 0o700 });
  const statusWrites: string[] = [];
  const tunnel = new RuntimeTestTunnel([], 'https://degraded-browser.trycloudflare.com');
  const created = await createDefaultForegroundRuntime({
    stateRoot,
    statusWriter: (text) => { statusWrites.push(text); },
    openDashboard: async () => undefined,
    tunnelOverride: tunnel,
    skillRootsOverride: [{ namespace: 'degraded', path: skillRoot }],
  });
  try {
    const ready = await created.runtime.start();
    assert.equal(ready.browser, 'unavailable');
    assert.match(statusWrites[0]!, /Browser: unavailable/);
  } finally {
    await created.runtime.stop('degraded-browser-test');
  }
});

test('default runtime degrades a corrupt pinned-browser manifest without disabling non-browser tools', async () => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const skillRoot = path.join(stateRoot, 'corrupt-browser-skills');
  await mkdir(skillRoot, { mode: 0o700 });
  await writeFile(path.join(stateRoot, 'browser', 'loom-browser.json'), '{not-json}\n', {
    mode: 0o600,
  });
  const statusWrites: string[] = [];
  const created = await createDefaultForegroundRuntime({
    stateRoot,
    statusWriter: (text) => { statusWrites.push(text); },
    openDashboard: async () => undefined,
    tunnelOverride: new RuntimeTestTunnel([], 'https://corrupt-browser.trycloudflare.com'),
    skillRootsOverride: [{ namespace: 'corrupt-browser', path: skillRoot }],
  });
  try {
    const ready = await created.runtime.start();
    assert.equal(ready.phase, 'ready');
    assert.equal(ready.browser, 'unavailable');
    assert.equal(ready.connectorReady, true);
    assert.match(statusWrites[0]!, /Browser: unavailable/);
  } finally {
    await created.runtime.stop('corrupt-browser-test');
  }
});

test('default runtime factory releases its lock when component construction fails', async () => {
  const stateRoot = await tempRoot();
  await initializeState(stateRoot);
  const duplicated = path.join(stateRoot, 'duplicate-skills');
  await mkdir(duplicated, { mode: 0o700 });
  await assert.rejects(createDefaultForegroundRuntime({
    stateRoot,
    tunnelOverride: new RuntimeTestTunnel([], 'https://unused.trycloudflare.com'),
    skillRootsOverride: [
      { namespace: 'duplicate', path: duplicated },
      { namespace: 'duplicate', path: duplicated },
    ],
  }));
  await assert.rejects(access(path.join(stateRoot, 'runtime', 'loom.lock')));
  await assert.rejects(access(path.join(stateRoot, 'runtime', 'current.json')));
});
