import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  stat,
  symlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { launchYolo, runCliCommand, setupBrowser } from '../src/cli.js';
import { initializeState, writeRuntimeLock } from '../src/config.js';
import { AuthStore } from '../src/oauth.js';
import type { ForegroundLoomRuntime } from '../src/runtime.js';
import { inspectProcess } from '../src/watchdog.js';

const cliPath = new URL('../src/cli.js', import.meta.url);
const packagePath = new URL('../../package.json', import.meta.url);

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath.pathname, ...args], {
    encoding: 'utf8',
  });
}

function runCliWithHome(home: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliPath.pathname, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

function runCliWithHomeWithoutTerminal(home: string, ...args: string[]) {
  const detachScript = `
import os
import sys
os.setsid()
os.execve(sys.argv[1], sys.argv[1:], os.environ)
`;
  return spawnSync(
    '/usr/bin/python3',
    ['-c', detachScript, process.execPath, cliPath.pathname, ...args],
    {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    },
  );
}

test('package metadata pins the supported runtime and dependencies', async () => {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as {
    engines: { node: string };
    dependencies: Record<string, string>;
  };

  assert.equal(pkg.engines.node, '>=22');
  assert.deepEqual(pkg.dependencies, {
    '@modelcontextprotocol/sdk': '1.29.0',
    express: '5.2.1',
    'playwright-core': '1.61.1',
    zod: '4.4.3',
  });
});

test('--version prints the package version', () => {
  const result = runCli('--version');

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), '0.1.0');
});

test('CLI executes when invoked through a package-bin symlink', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-cli-link-')));
  const linkedCli = path.join(root, 'loom');
  await symlink(cliPath.pathname, linkedCli);

  const result = spawnSync(process.execPath, [linkedCli, '--version'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), '0.1.0');
});

test('--help exposes the explicit YOLO launch command and support floor', () => {
  const result = runCli('--help');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /loom launch --yolo/);
  assert.match(result.stdout, /macOS 14\+/);
});

test('browser setup initializes the dedicated install directory and invokes the pinned installer', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-cli-home-')));
  const stateRoot = path.join(home, '.loom');
  let requestedDirectory = '';

  const manifest = await setupBrowser(stateRoot, async (options) => {
    requestedDirectory = options.installationDirectory;
    return {
      schemaVersion: 1,
      playwrightVersion: '1.61.1',
      chromiumRevision: '1228',
      chromiumVersion: '149.0.7827.55',
      architecture: process.arch === 'x64' ? 'x64' : 'arm64',
      archiveUrl: 'https://example.invalid/chromium.zip',
      archiveSha256: 'a'.repeat(64),
      executablePath: path.join(options.installationDirectory, 'Chromium'),
      executableSha256: 'b'.repeat(64),
      installedAt: '2026-07-08T12:00:00.000Z',
    };
  });

  assert.equal(requestedDirectory, path.join(stateRoot, 'browser'));
  assert.equal(manifest.chromiumRevision, '1228');
  assert.equal((await stat(path.join(stateRoot, 'browser'))).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(stateRoot, 'browser-profile'))).mode & 0o777, 0o700);
});


test('launchYolo writes the local warning and first owner password before foreground execution', async () => {
  const events: string[] = [];
  const terminalWrites: string[] = [];
  const statuses: string[] = [];
  const runtime = {} as ForegroundLoomRuntime;
  const terminalHandle = {} as FileHandle;
  const terminal = {
    inputHandle: terminalHandle,
    outputHandle: terminalHandle,
  };

  await launchYolo({
    validateSupport: () => { events.push('validate'); },
    openTerminal: async () => { events.push('terminal.open'); return terminal; },
    writeToTerminal: async (handle, text) => {
      assert.equal(handle, terminal);
      events.push('terminal.write');
      terminalWrites.push(text);
    },
    closeTerminal: async (handle) => {
      assert.equal(handle, terminal);
      events.push('terminal.close');
    },
    createRuntime: async ({ statusWriter }) => {
      events.push('runtime.create');
      statusWriter('READY STATUS');
      return { runtime, ownerPassword: 'owner-secret-test' };
    },
    runForeground: async (received) => {
      assert.equal(received, runtime);
      events.push('runtime.foreground');
    },
    statusWriter: (text) => { statuses.push(text); },
  });

  assert.deepEqual(events, [
    'validate',
    'terminal.open',
    'terminal.write',
    'runtime.create',
    'terminal.write',
    'terminal.close',
    'runtime.foreground',
  ]);
  assert.match(terminalWrites[0]!, /FULL COMPUTER ACCESS ENABLED/);
  assert.match(terminalWrites[1]!, /Loom owner password: owner-secret-test/);
  assert.match(terminalWrites[1]!, /full access to this macOS account/i);
  assert.deepEqual(statuses, ['READY STATUS']);
});

test('launchYolo stops an acquired runtime when the local terminal cannot close', async () => {
  const stopReasons: string[] = [];
  let foregroundCalls = 0;
  const terminalHandle = {} as FileHandle;
  const runtime = {
    async stop(reason: string) { stopReasons.push(reason); },
  } as unknown as ForegroundLoomRuntime;

  await assert.rejects(
    launchYolo({
      validateSupport: () => undefined,
      openTerminal: async () => ({
        inputHandle: terminalHandle,
        outputHandle: terminalHandle,
      }),
      writeToTerminal: async () => undefined,
      closeTerminal: async () => { throw new Error('tty close failed'); },
      createRuntime: async () => ({ runtime, ownerPassword: null }),
      runForeground: async () => { foregroundCalls += 1; },
      statusWriter: () => undefined,
    }),
    /tty close failed/,
  );
  assert.deepEqual(stopReasons, ['local-terminal-close-failure']);
  assert.equal(foregroundCalls, 0);
});

test('explicit YOLO launch routes to the injected foreground launcher exactly once', async () => {
  let launches = 0;
  await runCliCommand(['launch', '--yolo'], {
    launchYolo: async () => { launches += 1; },
  });
  assert.equal(launches, 1);
});

test('YOLO launch refuses to create runtime state without a local terminal', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-cli-home-')));
  const result = runCliWithHomeWithoutTerminal(home, 'launch', '--yolo');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Local terminal confirmation is required/);
  await assert.rejects(stat(path.join(home, '.loom')), /ENOENT/);
});

test('plain launch refuses to start unrestricted access', () => {
  const result = runCli('launch');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /loom launch --yolo/);
  assert.doesNotMatch(result.stdout, /FULL COMPUTER ACCESS ENABLED/);
});

test('config check validates the default state without modifying invalid configuration', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-cli-home-')));
  const stateRoot = path.join(home, '.loom');
  await initializeState(stateRoot);

  const valid = runCliWithHome(home, 'config', 'check');
  assert.equal(valid.status, 0);
  assert.match(valid.stdout, /Configuration valid/);

  const configPath = path.join(stateRoot, 'config.json');
  const invalidBytes = '{"version":1,"unknown":true}\n';
  await writeFile(configPath, invalidBytes, { mode: 0o600 });
  const invalid = runCliWithHome(home, 'config', 'check');

  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid Loom configuration/);
  assert.equal(await readFile(configPath, 'utf8'), invalidBytes);
});

test('config reset requires and accepts local terminal confirmation', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-cli-home-')));
  const stateRoot = path.join(home, '.loom');
  await initializeState(stateRoot);
  const configPath = path.join(stateRoot, 'config.json');
  await writeFile(configPath, '{"invalid":true}\n', { mode: 0o600 });

  const expectScript = `
set timeout 10
spawn $env(LOOM_TEST_NODE) $env(LOOM_TEST_CLI) config reset
expect {
  "Type RESET to restore the default Loom configuration: " { send "RESET\\r" }
  timeout { exit 124 }
  eof { exit 125 }
}
expect eof
set result [wait]
exit [lindex $result 3]
`;
  const result = spawnSync('/usr/bin/expect', ['-c', expectScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      LOOM_TEST_NODE: process.execPath,
      LOOM_TEST_CLI: cliPath.pathname,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    version: 1,
    tunnel: { type: 'quick' },
    extraRoots: [],
  });
  assert.equal(
    (await readdir(stateRoot)).some((name) => name.startsWith('config.invalid.')),
    true,
  );
});

test('auth reset refuses while a live Loom runtime lock matches the process table', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-cli-home-')));
  const stateRoot = path.join(home, '.loom');
  const opened = await AuthStore.open(stateRoot);
  assert.ok(opened.ownerPassword);
  const observed = await inspectProcess(process.pid);
  assert.ok(observed);
  await writeRuntimeLock(stateRoot, {
    pid: observed.pid,
    startTime: observed.startTime,
    executablePath: observed.executablePath,
    launchId: 'test-live-launch',
    statePath: stateRoot,
  });

  const result = runCliWithHomeWithoutTerminal(home, 'auth', 'reset');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Loom is currently running/);
  const reopened = await AuthStore.open(stateRoot);
  assert.equal(await reopened.store.verifyOwnerPassword(opened.ownerPassword), true);
});

test('auth reset uses local terminal confirmation, prints the new password there, and preserves non-auth state', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-cli-home-')));
  const stateRoot = path.join(home, '.loom');
  const opened = await AuthStore.open(stateRoot);
  assert.ok(opened.ownerPassword);
  await opened.store.bindEndpoint('https://loom.example.com/mcp');
  const client = await opened.store.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/connector/oauth/callback'],
    scopes: ['loom:tools'],
  });
  const configBefore = await readFile(path.join(stateRoot, 'config.json'));
  const memoryMarker = path.join(stateRoot, 'memory', 'keep.txt');
  const browserMarker = path.join(stateRoot, 'browser-profile', 'keep.txt');
  await mkdir(path.dirname(memoryMarker), { recursive: true });
  await mkdir(path.dirname(browserMarker), { recursive: true });
  await writeFile(memoryMarker, 'memory survives');
  await writeFile(browserMarker, 'browser survives');

  const noTerminal = runCliWithHomeWithoutTerminal(home, 'auth', 'reset');
  assert.notEqual(noTerminal.status, 0);
  assert.match(noTerminal.stderr, /Local terminal confirmation is required/);
  assert.equal(await opened.store.verifyOwnerPassword(opened.ownerPassword), true);

  const expectScript = `
set timeout 15
spawn $env(LOOM_TEST_NODE) $env(LOOM_TEST_CLI) auth reset
expect {
  "Type RESET to rotate the Loom owner password: " { send "RESET\\r" }
  timeout { exit 124 }
  eof { exit 125 }
}
expect {
  -re {New Loom owner password: ([A-Za-z0-9_-]+)} {}
  timeout { exit 126 }
  eof { exit 127 }
}
expect eof
set result [wait]
exit [lindex $result 3]
`;
  const result = spawnSync('/usr/bin/expect', ['-c', expectScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      LOOM_TEST_NODE: process.execPath,
      LOOM_TEST_CLI: cliPath.pathname,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const passwordMatch = result.stdout.match(/New Loom owner password: ([A-Za-z0-9_-]{43})/);
  assert.ok(passwordMatch, result.stdout);
  const newPassword = passwordMatch[1]!;
  const reopened = await AuthStore.open(stateRoot);
  assert.equal(await reopened.store.verifyOwnerPassword(opened.ownerPassword), false);
  assert.equal(await reopened.store.verifyOwnerPassword(newPassword), true);
  assert.equal(reopened.store.resourceUri, 'https://loom.example.com/mcp');
  assert.deepEqual(await readFile(path.join(stateRoot, 'config.json')), configBefore);
  assert.equal(await readFile(memoryMarker, 'utf8'), 'memory survives');
  assert.equal(await readFile(browserMarker, 'utf8'), 'browser survives');
  await assert.rejects(reopened.store.issueAuthorizationCode({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0]!,
    scopes: ['loom:tools'],
    resource: 'https://loom.example.com/mcp',
    ownerPassword: newPassword,
    codeChallenge: AuthStore.pkceChallenge('z'.repeat(64)),
    codeChallengeMethod: 'S256',
  }));
});
