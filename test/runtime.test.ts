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
