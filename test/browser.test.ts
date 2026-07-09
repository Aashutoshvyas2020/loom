import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { AuditLogger, AuditUnavailableError } from '../src/audit.js';
import { ProcessManager } from '../src/process-manager.js';
import {
  ManagedChromiumBackend,
  closeManagedChromium,
  recoverBrowserProfileLocks,
  runBoundedEvaluation,
  runBoundedPageOperation,
  writeBrowserLock,
  writeExclusiveReadable,
} from '../src/browser/backend.js';
import {
  installPinnedChromium,
  hashChromiumExecutable,
  verifyChromiumExecutable,
  verifyChromiumLaunch,
} from '../src/browser/setup.js';
import { inspectProcess } from '../src/watchdog.js';
import {
  BrowserExecutableError,
  BrowserNotReadyError,
  BrowserTabNotFoundError,
  BrowserToolError,
  BrowserToolService,
  createBrowserToolDispatcher,
  type BrowserBackend,
  type BrowserSnapshotResult,
  type BrowserTab,
} from '../src/tools/browser.js';

const execFileAsync = promisify(execFile);

async function tempRoot(prefix = 'loom-browser-'): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

async function setupAudit() {
  const root = await tempRoot();
  const auditDirectory = path.join(root, 'audit');
  await mkdir(auditDirectory, { mode: 0o700 });
  const audit = await AuditLogger.create({
    auditDirectory,
    now: () => new Date('2026-07-08T11:00:00.000Z'),
  });
  return { root, auditDirectory, audit };
}

async function auditRecords(auditDirectory: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for (const name of (await readdir(auditDirectory)).filter((entry) => entry.endsWith('.jsonl')).sort()) {
    const raw = await readFile(path.join(auditDirectory, name), 'utf8');
    for (const line of raw.split('\n').filter(Boolean)) {
      records.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return records;
}

class FakeBrowserBackend implements BrowserBackend {
  readonly calls: Array<[string, unknown]> = [];
  running = true;
  tab: BrowserTab = {
    id: 'tab_1234567890123456789012',
    url: 'https://example.com/start?secret=query-secret',
    title: 'Example',
  };

  async status() {
    this.calls.push(['status', null]);
    return { running: this.running, tabs: this.running ? 1 : 0, version: 'test-browser' };
  }

  async tabs() {
    this.calls.push(['tabs', null]);
    return this.running ? [this.tab] : [];
  }

  async open(input: { url?: string }) {
    this.calls.push(['open', input]);
    return { ...this.tab, ...(input.url === undefined ? {} : { url: input.url }) };
  }

  async navigate(input: { tabId: string; url: string }) {
    this.calls.push(['navigate', input]);
    return { ...this.tab, id: input.tabId, url: input.url };
  }

  async snapshot(input: { tabId: string; maxBytes: number }): Promise<BrowserSnapshotResult> {
    this.calls.push(['snapshot', input]);
    return {
      tabId: input.tabId,
      url: this.tab.url,
      title: this.tab.title,
      text: 'private page text',
      bytes: 17,
      truncated: false,
    };
  }

  async click(input: { tabId: string; selector: string }) {
    this.calls.push(['click', input]);
    return { tabId: input.tabId, url: this.tab.url };
  }

  async type(input: { tabId: string; selector: string; text: string; submit: boolean }) {
    this.calls.push(['type', input]);
    return { tabId: input.tabId, url: this.tab.url };
  }

  async evaluate(input: { tabId: string; expression: string; maxBytes: number }) {
    this.calls.push(['evaluate', input]);
    return {
      tabId: input.tabId,
      url: this.tab.url,
      json: '{"secret":"private evaluation"}',
      bytes: 31,
    };
  }

  async screenshot(input: { tabId: string; fullPage: boolean; maxBytes: number }) {
    this.calls.push(['screenshot', input]);
    return {
      tabId: input.tabId,
      url: this.tab.url,
      data: Buffer.from('fake-png'),
      mimeType: 'image/png' as const,
      filePath: '/tmp/fake-screenshot.png',
    };
  }

  async close(input: { tabId: string }) {
    this.calls.push(['close', input]);
    return { tabId: input.tabId };
  }

  async grantPermissions(input: { origin: string; permissions: string[] }) {
    this.calls.push(['grant_permissions', input]);
    return input;
  }

  async clearPermissions(input: { origin?: string }) {
    this.calls.push(['clear_permissions', input]);
    return input;
  }

  async setGeolocation(input: {
    origin: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
  }) {
    this.calls.push(['set_geolocation', input]);
    return input;
  }

  async shutdown() {
    this.calls.push(['shutdown', null]);
    this.running = false;
  }
}

test('Chromium executable verification requires a stable nonsymlink executable and exact SHA-256', async () => {
  const root = await tempRoot();
  const executable = path.join(root, 'Chromium');
  await writeFile(executable, '#!/bin/sh\nexit 0\n');
  await chmod(executable, 0o700);
  const digest = await hashChromiumExecutable(executable);

  const verified = await verifyChromiumExecutable({ executablePath: executable, expectedSha256: digest });
  assert.equal(verified.executablePath, executable);
  assert.equal(verified.sha256, digest);
  assert.equal(verified.bytes > 0, true);

  await assert.rejects(
    verifyChromiumExecutable({ executablePath: executable, expectedSha256: '0'.repeat(64) }),
    BrowserExecutableError,
  );
  const linked = path.join(root, 'linked');
  await symlink(executable, linked);
  await assert.rejects(
    verifyChromiumExecutable({ executablePath: linked, expectedSha256: digest }),
    BrowserExecutableError,
  );
});

test('Chromium launch verification uses a wrapper-owned CDP endpoint and cleans the process tree', async () => {
  const root = await tempRoot('loom-browser-launch-');
  const executable = path.join(root, 'fake-chromium');
  const profileDirectory = path.join(root, 'profile');
  const argsPath = path.join(root, 'args.json');
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const profileArg = process.argv.find((value) => value.startsWith('--user-data-dir='));
if (!profileArg || !process.argv.includes('--remote-debugging-port=0')) process.exit(2);
const profile = profileArg.slice('--user-data-dir='.length);
fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(path.dirname(profile), 'args.json'), JSON.stringify(process.argv.slice(2)));
const server = http.createServer((request, response) => {
  if (request.url !== '/json/version') { response.statusCode = 404; response.end(); return; }
  response.setHeader('content-type', 'application/json');
  const address = server.address();
  response.end(JSON.stringify({ Browser: 'FakeChromium/1', webSocketDebuggerUrl: 'ws://127.0.0.1:' + address.port + '/devtools/browser/test' }));
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), address.port + '\\n/devtools/browser/test\\n');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
setInterval(() => {}, 1000);
`);
  await chmod(executable, 0o700);

  await verifyChromiumLaunch(executable, profileDirectory);

  const args = JSON.parse(await readFile(argsPath, 'utf8')) as string[];
  assert.equal(args.includes('--remote-debugging-port=0'), true);
  assert.equal(args.some((value) => value.startsWith('--user-data-dir=')), true);
  assert.equal(args.includes('--dump-dom'), false);
  await assert.rejects(access(profileDirectory));
  assert.equal(
    (await execFileAsync('/bin/ps', ['-axo', 'command='])).stdout.includes(profileDirectory),
    false,
  );
});

test('pinned Chromium setup resolves the local Playwright CLI independently of cwd', async () => {
  const root = await tempRoot('loom-browser-cwd-');
  const installationDirectory = path.join(root, 'browser');
  const expectedCli = await realpath(fileURLToPath(
    new URL('../../node_modules/playwright-core/cli.js', import.meta.url),
  ));
  const browserDirectory = process.arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64';
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    await installPinnedChromium({
      installationDirectory,
      architecture: process.arch,
      runInstaller: async (input) => {
        assert.equal(await realpath(input.args[0]!), expectedCli);
        const stagingDirectory = input.env.PLAYWRIGHT_BROWSERS_PATH;
        assert.ok(stagingDirectory);
        const executablePath = path.join(
          stagingDirectory,
          'chromium-1228',
          browserDirectory,
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing',
        );
        await mkdir(path.dirname(executablePath), { recursive: true, mode: 0o700 });
        await writeFile(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
      },
      verifyExecutable: async (input) => ({
        executablePath: input.executablePath,
        sha256: input.expectedSha256,
        bytes: (await stat(input.executablePath)).size,
      }),
      verifyLaunch: async () => undefined,
    });
  } finally {
    process.chdir(previousCwd);
  }
});

test('pinned Chromium setup installs through the local Playwright CLI, verifies launch, and atomically writes the manifest', async () => {
  const root = await tempRoot('loom-browser-setup-');
  const installationDirectory = path.join(root, 'browser');
  await mkdir(installationDirectory, { mode: 0o700 });
  await writeFile(path.join(installationDirectory, 'old-marker'), 'old install');
  const browserDirectory = process.arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64';
  let installedExecutable = '';
  const verifiedExecutables: string[] = [];
  let launchVerified = false;

  const manifest = await installPinnedChromium({
    installationDirectory,
    architecture: process.arch,
    now: () => new Date('2026-07-08T12:00:00.000Z'),
    runInstaller: async (input) => {
      assert.equal(input.executable, process.execPath);
      assert.deepEqual(input.args.slice(-3), ['install', 'chromium', '--no-shell']);
      assert.equal(input.env.PLAYWRIGHT_DOWNLOAD_HOST, 'https://cdn.playwright.dev');
      assert.equal(input.env.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST, 'https://cdn.playwright.dev');
      const stagingDirectory = input.env.PLAYWRIGHT_BROWSERS_PATH;
      assert.ok(stagingDirectory);
      installedExecutable = path.join(
        stagingDirectory,
        'chromium-1228',
        browserDirectory,
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing',
      );
      await mkdir(path.dirname(installedExecutable), { recursive: true, mode: 0o700 });
      await writeFile(installedExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    },
    verifyExecutable: async (input) => {
      verifiedExecutables.push(input.executablePath);
      assert.equal(path.basename(input.executablePath), 'Google Chrome for Testing');
      assert.match(input.expectedSha256, /^[a-f0-9]{64}$/);
      return {
        executablePath: input.executablePath,
        sha256: input.expectedSha256,
        bytes: (await stat(input.executablePath)).size,
      };
    },
    verifyLaunch: async (executablePath, profileDirectory) => {
      assert.equal(executablePath, installedExecutable);
      assert.equal(path.dirname(profileDirectory), path.dirname(installedExecutable).split('/chromium-1228/')[0]);
      launchVerified = true;
    },
  });

  assert.equal(launchVerified, true);
  assert.deepEqual(verifiedExecutables, [installedExecutable, manifest.executablePath]);
  assert.equal(manifest.chromiumRevision, '1228');
  assert.equal(manifest.playwrightVersion, '1.61.1');
  assert.equal(manifest.installedAt, '2026-07-08T12:00:00.000Z');
  assert.equal(await readFile(manifest.executablePath, 'utf8'), '#!/bin/sh\nexit 0\n');
  assert.deepEqual(
    JSON.parse(await readFile(path.join(installationDirectory, 'loom-browser.json'), 'utf8')),
    manifest,
  );
  assert.equal((await stat(installationDirectory)).mode & 0o777, 0o700);
  assert.equal((await readdir(root)).some((name) => name.includes('browser-install-') || name.includes('browser-backup-')), false);
});

test('pinned Chromium setup restores the previous installation when promoted verification fails', async () => {
  const root = await tempRoot('loom-browser-rollback-');
  const installationDirectory = path.join(root, 'browser');
  await mkdir(installationDirectory, { mode: 0o700 });
  await writeFile(path.join(installationDirectory, 'old-marker'), 'preserve me');
  const browserDirectory = process.arch === 'arm64' ? 'chrome-mac-arm64' : 'chrome-mac-x64';
  let verificationCalls = 0;

  await assert.rejects(
    installPinnedChromium({
      installationDirectory,
      architecture: process.arch,
      runInstaller: async (input) => {
        const stagingDirectory = input.env.PLAYWRIGHT_BROWSERS_PATH;
        assert.ok(stagingDirectory);
        const executablePath = path.join(
          stagingDirectory,
          'chromium-1228',
          browserDirectory,
          'Google Chrome for Testing.app',
          'Contents',
          'MacOS',
          'Google Chrome for Testing',
        );
        await mkdir(path.dirname(executablePath), { recursive: true, mode: 0o700 });
        await writeFile(executablePath, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
      },
      verifyExecutable: async (input) => {
        verificationCalls += 1;
        if (verificationCalls === 2) {
          throw new BrowserExecutableError('promoted verification failed');
        }
        return {
          executablePath: input.executablePath,
          sha256: input.expectedSha256,
          bytes: (await stat(input.executablePath)).size,
        };
      },
      verifyLaunch: async () => undefined,
    }),
    /promoted verification failed/,
  );

  assert.equal(verificationCalls, 2);
  assert.equal(await readFile(path.join(installationDirectory, 'old-marker'), 'utf8'), 'preserve me');
  assert.equal(
    (await readdir(root)).some((name) => name.includes('browser-install-') || name.includes('browser-backup-')),
    false,
  );
});

test('browser lock recovery refuses live or mismatched identities and removes only verified stale profile locks', async () => {
  const root = await tempRoot('loom-browser-lock-');
  const runtimeDirectory = path.join(root, 'runtime');
  const profileDirectory = path.join(root, 'profile');
  await mkdir(runtimeDirectory, { mode: 0o700 });
  await mkdir(profileDirectory, { mode: 0o700 });
  const observed = await inspectProcess(process.pid);
  assert.ok(observed);
  const identity = {
    pid: observed.pid,
    startTime: observed.startTime,
    executablePath: observed.executablePath,
    launchId: 'browser-test-launch',
    profilePath: profileDirectory,
  };

  await writeBrowserLock(runtimeDirectory, identity);
  assert.equal((await stat(path.join(runtimeDirectory, 'browser.lock'))).mode & 0o777, 0o600);
  await assert.rejects(
    recoverBrowserProfileLocks({
      runtimeDirectory,
      profileDirectory,
      inspect: inspectProcess,
      listProcesses: async () => [],
    }),
    /still live/,
  );

  await assert.rejects(
    recoverBrowserProfileLocks({
      runtimeDirectory,
      profileDirectory,
      inspect: async () => ({ ...observed, startTime: observed.startTime + 1 }),
      listProcesses: async () => [],
    }),
    /identity is uncertain/,
  );

  await assert.rejects(
    recoverBrowserProfileLocks({
      runtimeDirectory,
      profileDirectory,
      inspect: async (pid) => pid === identity.pid
        ? null
        : {
            pid,
            ppid: 1,
            pgid: pid,
            startTime: observed.startTime,
            executablePath: '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          },
      listProcesses: async () => [{
        pid: 99_001,
        command: `Google Chrome for Testing --user-data-dir=${profileDirectory}`,
      }],
    }),
    /still references/,
  );
  await access(path.join(runtimeDirectory, 'browser.lock'));

  await recoverBrowserProfileLocks({
    runtimeDirectory,
    profileDirectory,
    inspect: async (pid) => pid === identity.pid
      ? null
      : {
          pid,
          ppid: 1,
          pgid: pid,
          startTime: observed.startTime,
          executablePath: '/private/tmp/chromium-tools/node',
        },
    listProcesses: async () => [{
      pid: 99_002,
      command: `node validation-script.js ${profileDirectory}`,
    }],
  });
  await assert.rejects(access(path.join(runtimeDirectory, 'browser.lock')));

  await writeBrowserLock(runtimeDirectory, identity);
  await writeFile(path.join(profileDirectory, 'SingletonLock'), 'stale');
  await writeFile(path.join(profileDirectory, 'SingletonCookie'), 'stale');
  await writeFile(path.join(profileDirectory, 'SingletonSocket'), 'stale');
  await recoverBrowserProfileLocks({
    runtimeDirectory,
    profileDirectory,
    inspect: async () => null,
    listProcesses: async () => [],
  });
  await assert.rejects(access(path.join(runtimeDirectory, 'browser.lock')));
  await assert.rejects(access(path.join(profileDirectory, 'SingletonLock')));
  await assert.rejects(access(path.join(profileDirectory, 'SingletonCookie')));
  await assert.rejects(access(path.join(profileDirectory, 'SingletonSocket')));
});

test('exclusive browser download persistence never overwrites and cleans failed partial files', async () => {
  const root = await tempRoot('loom-browser-download-');
  const target = path.join(root, 'download.bin');
  await writeExclusiveReadable(target, Readable.from([Buffer.from('first'), Buffer.from('-payload')]));
  assert.equal(await readFile(target, 'utf8'), 'first-payload');
  assert.equal((await stat(target)).mode & 0o777, 0o600);

  await assert.rejects(
    writeExclusiveReadable(target, Readable.from([Buffer.from('replacement')])),
    /EEXIST|exist/i,
  );
  assert.equal(await readFile(target, 'utf8'), 'first-payload');

  const failedTarget = path.join(root, 'failed.bin');
  const failingStream = Readable.from((async function* () {
    yield Buffer.from('partial');
    throw new Error('stream failed');
  })());
  await assert.rejects(writeExclusiveReadable(failedTarget, failingStream), /stream failed/);
  await assert.rejects(access(failedTarget));
});

test('mutating browser actions are durably audited before backend calls without leaking URL queries, selectors, typed text, or expressions', async (t) => {
  const { auditDirectory, audit } = await setupAudit();
  t.after(() => audit.close());
  const backend = new FakeBrowserBackend();
  const originalOpen = backend.open.bind(backend);
  backend.open = async (input) => {
    const records = await auditRecords(auditDirectory);
    assert.equal(records.at(-1)?.phase, 'start');
    assert.equal(records.at(-1)?.operation, 'browser.open');
    return originalOpen(input);
  };
  const service = new BrowserToolService({ backend, audit });

  await service.open({ url: 'https://example.com/path?token=url-secret' });
  await service.navigate({
    tabId: backend.tab.id,
    url: 'https://example.com/next?password=url-secret-two',
  });
  await service.click({ tabId: backend.tab.id, selector: '#private-selector' });
  await service.type({
    tabId: backend.tab.id,
    selector: '#password',
    text: 'typed-secret',
    submit: true,
  });
  await service.evaluate({
    tabId: backend.tab.id,
    expression: 'document.cookie + "evaluation-secret"',
  });
  await service.close({ tabId: backend.tab.id });
  await service.grantPermissions({
    origin: 'https://example.com',
    permissions: ['geolocation'],
  });
  await service.clearPermissions({ origin: 'https://example.com' });
  await service.setGeolocation({
    origin: 'https://example.com',
    latitude: 37.7749,
    longitude: -122.4194,
    accuracy: 10,
  });
  await service.screenshot({ tabId: backend.tab.id });

  const persisted = JSON.stringify(await auditRecords(auditDirectory));
  for (const forbidden of [
    'url-secret',
    'url-secret-two',
    'private-selector',
    '#password',
    'typed-secret',
    'document.cookie',
    'evaluation-secret',
  ]) {
    assert.equal(persisted.includes(forbidden), false);
  }
  assert.equal((await auditRecords(auditDirectory)).filter((record) => record.phase === 'start').length, 10);
});

test('audit failure blocks capability-increasing browser mutations but preserves tab close and read-only actions', async (t) => {
  const { auditDirectory, audit } = await setupAudit();
  t.after(() => audit.close());
  const backend = new FakeBrowserBackend();
  const service = new BrowserToolService({ backend, audit });
  await rm(auditDirectory, { recursive: true });

  await assert.rejects(service.open({ url: 'https://example.com' }), AuditUnavailableError);
  await assert.rejects(
    service.navigate({ tabId: backend.tab.id, url: 'https://example.com/next' }),
    AuditUnavailableError,
  );
  await assert.rejects(service.click({ tabId: backend.tab.id, selector: '#button' }), AuditUnavailableError);
  await assert.rejects(
    service.type({ tabId: backend.tab.id, selector: '#input', text: 'blocked' }),
    AuditUnavailableError,
  );
  await assert.rejects(
    service.evaluate({ tabId: backend.tab.id, expression: '1 + 1' }),
    AuditUnavailableError,
  );
  const closed = await service.close({ tabId: backend.tab.id });
  assert.equal(closed.structuredContent?.tabId, backend.tab.id);
  await assert.rejects(service.screenshot({ tabId: backend.tab.id }), AuditUnavailableError);

  assert.equal((await service.status()).structuredContent?.running, true);
  assert.equal((await service.tabs()).structuredContent?.tabs instanceof Array, true);
  const availableSnapshot = await service.snapshot({ tabId: backend.tab.id });
  assert.match(
    availableSnapshot.content[0]?.type === 'text'
      ? availableSnapshot.content[0].text
      : '',
    /private page text/,
  );
  assert.deepEqual(backend.calls.map(([name]) => name), ['close', 'status', 'tabs', 'snapshot']);
});

test('read results keep page/evaluation/screenshot content out of structured metadata and audit bytes', async (t) => {
  const { auditDirectory, audit } = await setupAudit();
  t.after(() => audit.close());
  const backend = new FakeBrowserBackend();
  const service = new BrowserToolService({ backend, audit });

  const snapshot = await service.snapshot({ tabId: backend.tab.id, maxBytes: 1024 });
  assert.equal(snapshot.content[0]?.type === 'text' ? snapshot.content[0].text : '', 'private page text');
  assert.equal(JSON.stringify(snapshot.structuredContent).includes('private page text'), false);

  const screenshot = await service.screenshot({ tabId: backend.tab.id, maxBytes: 1024 });
  assert.equal(screenshot.content[0]?.type, 'image');
  assert.equal(JSON.stringify(screenshot.structuredContent).includes('fake-png'), false);

  const evaluated = await service.evaluate({ tabId: backend.tab.id, expression: '({secret:"value"})' });
  assert.equal(
    evaluated.content[0]?.type === 'text' ? evaluated.content[0].text : '',
    '{"secret":"private evaluation"}',
  );
  assert.equal(JSON.stringify(evaluated.structuredContent).includes('private evaluation'), false);

  const persisted = JSON.stringify(await auditRecords(auditDirectory));
  assert.equal(persisted.includes('private page text'), false);
  assert.equal(persisted.includes('fake-png'), false);
  assert.equal(persisted.includes('private evaluation'), false);
});

test('browser input validation rejects unsafe URLs/origins, malformed tabs, unsupported permissions, and excessive bounds before backend calls', async (t) => {
  const { auditDirectory, audit } = await setupAudit();
  t.after(() => audit.close());
  const backend = new FakeBrowserBackend();
  const service = new BrowserToolService({ backend, audit });

  await assert.rejects(service.open({ url: 'javascript:alert(1)' }), BrowserToolError);
  await assert.rejects(
    service.navigate({ tabId: '../bad', url: 'https://example.com' }),
    BrowserToolError,
  );
  await assert.rejects(
    service.navigate({ tabId: backend.tab.id, url: 'file:///etc/passwd' }),
    BrowserToolError,
  );
  await assert.rejects(service.click({ tabId: backend.tab.id, selector: '' }), BrowserToolError);
  await assert.rejects(
    service.type({ tabId: backend.tab.id, selector: '#a', text: 'x'.repeat(1024 * 1024 + 1) }),
    BrowserToolError,
  );
  await assert.rejects(
    service.snapshot({ tabId: backend.tab.id, maxBytes: 0 }),
    BrowserToolError,
  );
  await assert.rejects(
    service.screenshot({ tabId: backend.tab.id, maxBytes: 2 * 1024 * 1024 + 1 }),
    BrowserToolError,
  );
  await assert.rejects(
    service.grantPermissions({ origin: 'https://example.com/path', permissions: ['camera'] }),
    BrowserToolError,
  );
  await assert.rejects(
    service.grantPermissions({ origin: 'https://example.com', permissions: ['unsupported_permission'] }),
    BrowserToolError,
  );
  await assert.rejects(
    service.setGeolocation({
      origin: 'https://example.com',
      latitude: 91,
      longitude: 0,
    }),
    BrowserToolError,
  );

  assert.deepEqual(backend.calls, []);
  assert.deepEqual(await readdir(auditDirectory), []);
});

test('backend not-ready and missing-tab errors remain typed at the tool boundary', async (t) => {
  const { audit, auditDirectory } = await setupAudit();
  t.after(() => audit.close());
  const backend = new FakeBrowserBackend();
  backend.snapshot = async () => {
    throw new BrowserNotReadyError('browser is stopped');
  };
  backend.click = async () => {
    throw new BrowserTabNotFoundError('tab missing');
  };
  const service = new BrowserToolService({ backend, audit });

  await assert.rejects(service.snapshot({ tabId: backend.tab.id }), BrowserNotReadyError);
  await assert.rejects(service.click({ tabId: backend.tab.id, selector: '#button' }), BrowserTabNotFoundError);
  const records = await auditRecords(auditDirectory);
  assert.equal(records.at(-1)?.status, 'error');
});

test('browser dispatcher handles every browser action and delegates the other six tools', async (t) => {
  const { audit } = await setupAudit();
  t.after(() => audit.close());
  const backend = new FakeBrowserBackend();
  const service = new BrowserToolService({ backend, audit });
  const delegated: Array<[string, Record<string, unknown>]> = [];
  const dispatcher = createBrowserToolDispatcher(service, async (name, arguments_) => {
    delegated.push([name, arguments_]);
    return { content: [{ type: 'text', text: 'delegated' }] };
  });

  await dispatcher('loom_browser', { action: 'status' });
  await dispatcher('loom_browser', { action: 'tabs' });
  await dispatcher('loom_browser', { action: 'open', url: 'https://example.com' });
  await dispatcher('loom_browser', { action: 'navigate', tabId: backend.tab.id, url: 'https://example.com/next' });
  await dispatcher('loom_browser', { action: 'snapshot', tabId: backend.tab.id });
  await dispatcher('loom_browser', { action: 'click', tabId: backend.tab.id, selector: '#button' });
  await dispatcher('loom_browser', { action: 'type', tabId: backend.tab.id, selector: '#input', text: 'value' });
  await dispatcher('loom_browser', { action: 'evaluate', tabId: backend.tab.id, expression: '1+1' });
  await dispatcher('loom_browser', { action: 'screenshot', tabId: backend.tab.id });
  await dispatcher('loom_browser', { action: 'close', tabId: backend.tab.id });
  await dispatcher('loom_browser', { action: 'grant_permissions', origin: 'https://example.com', permissions: ['geolocation'] });
  await dispatcher('loom_browser', { action: 'clear_permissions', origin: 'https://example.com' });
  await dispatcher('loom_browser', {
    action: 'set_geolocation',
    origin: 'https://example.com',
    latitude: 37,
    longitude: -122,
  });
  await dispatcher('loom_read', { path: '/tmp/example.txt' });

  assert.equal(backend.calls.length, 13);
  assert.deepEqual(delegated, [['loom_read', { path: '/tmp/example.txt' }]]);
});

test('managed Chromium shutdown requests CDP close and waits for natural process exit', async () => {
  const commands: string[] = [];
  let disconnected = false;
  let cancelled = false;
  await closeManagedChromium(
    {
      newBrowserCDPSession: async () => ({
        send: async (command: string) => { commands.push(command); },
      }),
      close: async () => { disconnected = true; },
    },
    {
      wait: async () => ({ state: 'completed' as const, exitCode: 0, signal: null }),
      cancel: async () => {
        cancelled = true;
        return { state: 'cancelled' as const, exitCode: null, signal: 'SIGTERM' };
      },
    },
    20,
  );

  assert.deepEqual(commands, ['Browser.close']);
  assert.equal(disconnected, false);
  assert.equal(cancelled, false);
});

test('managed Chromium shutdown disconnects and cancels when graceful exit exceeds its deadline', async () => {
  let disconnected = false;
  let cancelled = false;
  await closeManagedChromium(
    {
      newBrowserCDPSession: async () => ({ send: async () => undefined }),
      close: async () => { disconnected = true; },
    },
    {
      wait: async () => new Promise<never>(() => undefined),
      cancel: async () => {
        cancelled = true;
        return { state: 'cancelled' as const, exitCode: null, signal: 'SIGTERM' };
      },
    },
    20,
  );

  assert.equal(disconnected, true);
  assert.equal(cancelled, true);
});

test('bounded page operations recover a tab when an internal snapshot evaluation hangs', async () => {
  let closed = false;
  let healthChecks = 0;
  let restarted = false;
  await assert.rejects(
    runBoundedPageOperation({
      page: {
        close: async () => { closed = true; },
        url: () => 'https://hung-snapshot.example/',
      },
      operation: async () => new Promise<never>(() => undefined),
      timeoutMs: 20,
      timeoutMessage: 'Browser snapshot evaluation exceeded its deadline.',
      closeTimeoutMs: 20,
      verifyHealthy: async () => { healthChecks += 1; },
      restartBrowser: async () => { restarted = true; },
    }),
    /snapshot evaluation exceeded/,
  );
  assert.equal(closed, true);
  assert.equal(healthChecks, 1);
  assert.equal(restarted, false);
});

test('bounded evaluation closes only the timed-out page and verifies surviving browser health', async () => {
  let closed = false;
  let healthChecks = 0;
  let restarted = false;
  const page = {
    evaluate: async () => new Promise<never>(() => undefined),
    close: async () => { closed = true; },
    url: () => 'https://hung.example/',
  };
  await assert.rejects(
    runBoundedEvaluation({
      page,
      expression: 'while (true) {}',
      evaluationTimeoutMs: 20,
      closeTimeoutMs: 20,
      verifyHealthy: async () => { healthChecks += 1; },
      restartBrowser: async () => { restarted = true; },
    }),
    /evaluation exceeded/,
  );
  assert.equal(closed, true);
  assert.equal(healthChecks, 1);
  assert.equal(restarted, false);
});

test('bounded evaluation restarts the browser only when timed-out page cleanup fails', async () => {
  let restarted = false;
  const page = {
    evaluate: async () => new Promise<never>(() => undefined),
    close: async () => new Promise<never>(() => undefined),
    url: () => 'https://hung.example/',
  };
  await assert.rejects(
    runBoundedEvaluation({
      page,
      expression: 'while (true) {}',
      evaluationTimeoutMs: 20,
      closeTimeoutMs: 20,
      verifyHealthy: async () => undefined,
      restartBrowser: async () => { restarted = true; },
    }),
    /evaluation exceeded/,
  );
  assert.equal(restarted, true);
});

test('bounded evaluation restarts the browser when surviving browser health fails', async () => {
  let restarted = false;
  const page = {
    evaluate: async () => new Promise<never>(() => undefined),
    close: async () => undefined,
    url: () => 'https://hung.example/',
  };
  await assert.rejects(
    runBoundedEvaluation({
      page,
      expression: 'while (true) {}',
      evaluationTimeoutMs: 20,
      closeTimeoutMs: 20,
      verifyHealthy: async () => { throw new Error('CDP unhealthy'); },
      restartBrowser: async () => { restarted = true; },
    }),
    /evaluation exceeded/,
  );
  assert.equal(restarted, true);
});
