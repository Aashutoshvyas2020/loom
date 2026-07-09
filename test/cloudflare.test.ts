import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  CLOUDFLARED_DOWNLOAD_TIMEOUT_MS,
  CLOUDFLARED_VERSION,
  CloudflaredExecutableError,
  NamedTunnelAuthError,
  NamedTunnelConfigError,
  NamedTunnelManager,
  NamedTunnelStartupError,
  QuickTunnelConfigError,
  QuickTunnelManager,
  QuickTunnelStartupError,
  QuickTunnelUnsafeUrlError,
  type QuickTunnelProcess,
  assertQuickTunnelConfigCompatible,
  quickTunnelOriginFromOutput,
  cloudflaredReleaseFor,
  discoverCloudflaredOnPath,
  hashCloudflaredExecutable,
  installCloudflaredRelease,
  startCloudflared,
  validateNamedTunnelConfiguration,
  verifyCloudflaredExecutable,
} from '../src/cloudflare.js';
import { AuditLogger } from '../src/audit.js';
import { initializeState } from '../src/config.js';
import { AuthStore } from '../src/oauth.js';
import { RuntimeReadiness } from '../src/runtime.js';
import {
  NAMED_TUNNEL_BACKOFF_BASE_MS,
  NAMED_TUNNEL_BACKOFF_MAX_MS,
  NAMED_TUNNEL_MAX_RETRIES,
  NAMED_TUNNEL_READY_DEADLINE_MS,
  QUICK_TUNNEL_URL_DEADLINE_MS,
} from '../src/limits.js';
import { ProcessManager } from '../src/process-manager.js';
import type { OutputRead } from '../src/output.js';

const execFileAsync = promisify(execFile);

async function tempRoot(prefix = 'loom-cloudflared-'): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}



interface QuickFrame {
  text?: string;
  state?: 'running' | 'completed' | 'cancelled' | 'timed-out';
  exitCode?: number | null;
  signal?: string | null;
}

class ScriptedQuickProcess implements QuickTunnelProcess {
  readonly frames: QuickFrame[];
  cancelCount = 0;
  private index = 0;
  private cursor = 0;

  constructor(frames: QuickFrame[]) {
    this.frames = frames;
  }

  poll(requestedCursor: number): OutputRead {
    assert.equal(requestedCursor, this.cursor);
    const frame = this.frames[this.index] ?? { state: 'running' as const };
    if (this.index < this.frames.length) this.index += 1;
    const text = frame.text ?? '';
    const start = this.cursor;
    this.cursor += Buffer.byteLength(text);
    return {
      requestedCursor,
      availableFrom: start,
      nextCursor: this.cursor,
      gap: false,
      segments: text.length === 0 ? [] : [{ source: 'stderr', text }],
      totalBytes: this.cursor,
      truncated: false,
      state: frame.state ?? 'running',
      exitCode: frame.exitCode ?? null,
      signal: frame.signal ?? null,
    };
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1;
  }
}

async function auditRecords(directory: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for (const filename of (await readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort()) {
    const text = await readFile(path.join(directory, filename), 'utf8');
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      records.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return records;
}

async function makeFakeCloudflared(
  root: string,
  version = CLOUDFLARED_VERSION,
  marker = 'trusted',
): Promise<string> {
  const executable = path.join(root, 'cloudflared-real');
  await writeFile(executable, `#!/bin/sh
# ${marker}
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'cloudflared version ${version} (built test)'
  exit 0
fi
exit 3
`);
  await chmod(executable, 0o700);
  return executable;
}

async function makeNamedTunnelArtifacts(
  root: string,
  tunnelName = 'loom-prod',
): Promise<{
  cloudflareDirectory: string;
  originCertFile: string;
  credentialsFile: string;
  tunnelId: string;
  tunnelSecret: string;
}> {
  const cloudflareDirectory = path.join(root, '.cloudflared');
  await mkdir(cloudflareDirectory, { recursive: true, mode: 0o700 });
  const tunnelId = '6f4f721c-22f2-41c7-a77d-41e5b09e4fc2';
  const tunnelSecret = Buffer.alloc(32, 7).toString('base64');
  const originCertFile = path.join(cloudflareDirectory, 'cert.pem');
  const credentialsFile = path.join(cloudflareDirectory, `${tunnelId}.json`);
  const originToken = Buffer.from(JSON.stringify({
    zoneID: 'zone-id',
    accountID: 'account-id',
    apiToken: 'api-token',
  })).toString('base64');
  await writeFile(originCertFile, [
    '-----BEGIN ARGO TUNNEL TOKEN-----',
    originToken,
    '-----END ARGO TUNNEL TOKEN-----',
    '',
  ].join('\n'), { mode: 0o600 });
  await writeFile(credentialsFile, `${JSON.stringify({
    AccountTag: 'account-id',
    TunnelSecret: tunnelSecret,
    TunnelID: tunnelId,
    TunnelName: tunnelName,
  })}\n`, { mode: 0o600 });
  return { cloudflareDirectory, originCertFile, credentialsFile, tunnelId, tunnelSecret };
}

test('pinned Cloudflared release metadata is architecture-specific and exact', () => {
  assert.equal(CLOUDFLARED_VERSION, '2026.7.0');
  assert.equal(CLOUDFLARED_DOWNLOAD_TIMEOUT_MS, 30 * 60_000);
  assert.deepEqual(cloudflaredReleaseFor('arm64'), {
    architecture: 'arm64',
    version: '2026.7.0',
    archiveUrl: 'https://github.com/cloudflare/cloudflared/releases/download/2026.7.0/cloudflared-darwin-arm64.tgz',
    archiveBytes: 18_957_597,
    archiveSha256: '276f4ae3119c88d1708b0f884a35a1c87d9ae459b0dab6313f2daddbddab2bec',
    executableSha256: 'cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04',
  });
  assert.deepEqual(cloudflaredReleaseFor('x64'), {
    architecture: 'x64',
    version: '2026.7.0',
    archiveUrl: 'https://github.com/cloudflare/cloudflared/releases/download/2026.7.0/cloudflared-darwin-amd64.tgz',
    archiveBytes: 20_841_929,
    archiveSha256: 'dd1fb6a914a21dc52c64bad96987bbbc72d6c65553a2cfee1dd5bc886742ddfb',
    executableSha256: 'c0c65579c6f11b1381cf5ffd1614f5094bf140e18938eae4ad16931da9f69499',
  });
  assert.throws(() => cloudflaredReleaseFor('ia32'), /Unsupported Cloudflared architecture/);
});

test('Cloudflared verification canonicalizes a symlink and requires exact hash and version', async () => {
  const root = await tempRoot();
  const executable = await makeFakeCloudflared(root);
  const linked = path.join(root, 'cloudflared');
  await symlink(executable, linked);
  const sha256 = await hashCloudflaredExecutable(executable);
  const processManager = new ProcessManager({ statePath: root });

  const verified = await verifyCloudflaredExecutable({
    executablePath: linked,
    expectedSha256: sha256,
    expectedVersion: CLOUDFLARED_VERSION,
    processManager,
  });

  assert.equal(verified.requestedPath, linked);
  assert.equal(verified.executablePath, executable);
  assert.equal(verified.sha256, sha256);
  assert.equal(verified.version, CLOUDFLARED_VERSION);
  assert.equal(verified.bytes > 0, true);

  await assert.rejects(
    verifyCloudflaredExecutable({
      executablePath: linked,
      expectedSha256: '0'.repeat(64),
      expectedVersion: CLOUDFLARED_VERSION,
      processManager,
    }),
    CloudflaredExecutableError,
  );
  await assert.rejects(
    verifyCloudflaredExecutable({
      executablePath: linked,
      expectedSha256: sha256,
      expectedVersion: '2026.6.0',
      processManager,
    }),
    /version 2026\.7\.0.*expected 2026\.6\.0/,
  );
});

test('PATH discovery verifies the first Cloudflared match and reports its canonical path and version', async () => {
  const root = await tempRoot('loom-cloudflared-path-');
  const realDirectory = path.join(root, 'real');
  const binDirectory = path.join(root, 'bin');
  await mkdir(realDirectory, { mode: 0o700 });
  await mkdir(binDirectory, { mode: 0o700 });
  const executable = await makeFakeCloudflared(realDirectory);
  const candidate = path.join(binDirectory, 'cloudflared');
  await symlink(executable, candidate);
  const sha256 = await hashCloudflaredExecutable(executable);
  const processManager = new ProcessManager({ statePath: root });

  const discovered = await discoverCloudflaredOnPath({
    pathValue: binDirectory,
    expectedSha256: sha256,
    expectedVersion: CLOUDFLARED_VERSION,
    processManager,
  });

  assert.equal(discovered.requestedPath, candidate);
  assert.equal(discovered.executablePath, executable);
  assert.equal(discovered.version, CLOUDFLARED_VERSION);

  const hostileDirectory = path.join(root, 'hostile');
  await mkdir(hostileDirectory, { mode: 0o700 });
  await makeFakeCloudflared(hostileDirectory, CLOUDFLARED_VERSION, 'hostile');
  await symlink(path.join(hostileDirectory, 'cloudflared-real'), path.join(hostileDirectory, 'cloudflared'));
  await assert.rejects(
    discoverCloudflaredOnPath({
      pathValue: `${hostileDirectory}${path.delimiter}${binDirectory}`,
      expectedSha256: sha256,
      expectedVersion: CLOUDFLARED_VERSION,
      processManager,
    }),
    /SHA-256 mismatch/,
  );
});

test('Cloudflared installer follows bounded HTTPS redirects and atomically promotes a verified executable', async () => {
  const root = await tempRoot('loom-cloudflared-install-');
  const installationDirectory = path.join(root, 'cloudflared');
  const archive = Buffer.from('fake cloudflared archive');
  const executable = Buffer.from(`#!/bin/sh
# installed
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'cloudflared version ${CLOUDFLARED_VERSION} (built test)'
  exit 0
fi
exit 3
`);
  const release = {
    architecture: 'arm64' as const,
    version: CLOUDFLARED_VERSION,
    archiveUrl: 'https://downloads.example/cloudflared.tgz',
    archiveBytes: archive.byteLength,
    archiveSha256: sha256(archive),
    executableSha256: sha256(executable),
  };
  const requests: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, redirect: init?.redirect });
    if (url === release.archiveUrl) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://cdn.example/cloudflared.tgz' },
      });
    }
    return new Response(archive, {
      status: 200,
      headers: { 'content-length': String(archive.byteLength) },
    });
  };
  const processManager = new ProcessManager({ statePath: root });

  const installed = await installCloudflaredRelease({
    installationDirectory,
    release,
    processManager,
    fetchImpl,
    extractArchive: async (archivePath, executablePath) => {
      assert.deepEqual(await readFile(archivePath), archive);
      await writeFile(executablePath, executable, { mode: 0o600 });
    },
  });

  assert.deepEqual(requests, [
    { url: release.archiveUrl, redirect: 'manual' },
    { url: 'https://cdn.example/cloudflared.tgz', redirect: 'manual' },
  ]);
  assert.equal(installed.executablePath, path.join(installationDirectory, 'cloudflared'));
  assert.equal(installed.sha256, release.executableSha256);
  assert.equal(installed.version, CLOUDFLARED_VERSION);
  assert.equal((await stat(installationDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(installed.executablePath)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(installationDirectory), ['cloudflared']);
});

test('Cloudflared installer rejects a symlinked parent before creating installation state', async () => {
  const root = await tempRoot('loom-cloudflared-symlink-parent-');
  const actualParent = path.join(root, 'actual');
  const linkedParent = path.join(root, 'linked');
  await mkdir(actualParent, { mode: 0o700 });
  await symlink(actualParent, linkedParent);
  const archive = Buffer.from('archive');

  await assert.rejects(
    installCloudflaredRelease({
      installationDirectory: path.join(linkedParent, 'cloudflared'),
      release: {
        architecture: 'arm64',
        version: CLOUDFLARED_VERSION,
        archiveUrl: 'https://downloads.example/cloudflared.tgz',
        archiveBytes: archive.byteLength,
        archiveSha256: sha256(archive),
        executableSha256: 'a'.repeat(64),
      },
      processManager: new ProcessManager({ statePath: root }),
      fetchImpl: async () => new Response(archive),
    }),
    /Symbolic-link path component/,
  );
  await assert.rejects(access(path.join(actualParent, 'cloudflared')));
});

test('Cloudflared installer extracts the pinned single-file archive with the system tar boundary', async () => {
  const root = await tempRoot('loom-cloudflared-tar-');
  const sourceDirectory = path.join(root, 'source');
  const installationDirectory = path.join(root, 'installed');
  const archivePath = path.join(root, 'cloudflared.tgz');
  await mkdir(sourceDirectory, { mode: 0o700 });
  const generatedExecutable = await makeFakeCloudflared(sourceDirectory, CLOUDFLARED_VERSION, 'archive');
  const sourceExecutable = path.join(sourceDirectory, 'cloudflared');
  await rename(generatedExecutable, sourceExecutable);
  await execFileAsync('/usr/bin/tar', [
    '-czf',
    archivePath,
    '-C',
    sourceDirectory,
    path.basename(sourceExecutable),
  ]);
  const archive = await readFile(archivePath);
  const executable = await readFile(sourceExecutable);
  const release = {
    architecture: 'arm64' as const,
    version: CLOUDFLARED_VERSION,
    archiveUrl: 'https://downloads.example/cloudflared.tgz',
    archiveBytes: archive.byteLength,
    archiveSha256: sha256(archive),
    executableSha256: sha256(executable),
  };

  const installed = await installCloudflaredRelease({
    installationDirectory,
    release,
    processManager: new ProcessManager({ statePath: root }),
    fetchImpl: async () => new Response(archive, {
      status: 200,
      headers: { 'content-length': String(archive.byteLength) },
    }),
  });

  assert.equal(installed.version, CLOUDFLARED_VERSION);
  assert.equal(installed.sha256, release.executableSha256);
  assert.equal((await stat(installed.executablePath)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(installationDirectory), ['cloudflared']);
});

test('Cloudflared installer enforces a bounded configurable download deadline without residue', async () => {
  const root = await tempRoot('loom-cloudflared-timeout-');
  const installationDirectory = path.join(root, 'cloudflared');
  const archive = Buffer.from('archive');

  await assert.rejects(
    installCloudflaredRelease({
      installationDirectory,
      release: {
        architecture: 'arm64',
        version: CLOUDFLARED_VERSION,
        archiveUrl: 'https://downloads.example/cloudflared.tgz',
        archiveBytes: archive.byteLength,
        archiveSha256: sha256(archive),
        executableSha256: 'a'.repeat(64),
      },
      processManager: new ProcessManager({ statePath: root }),
      downloadTimeoutMs: 10,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    }),
    /timeout|aborted/i,
  );
  assert.deepEqual(await readdir(installationDirectory), []);
});

test('Cloudflared installer rejects insecure or corrupt downloads without replacing the prior binary', async () => {
  const root = await tempRoot('loom-cloudflared-install-fail-');
  const installationDirectory = path.join(root, 'cloudflared');
  await mkdir(installationDirectory, { mode: 0o700 });
  const priorPath = path.join(installationDirectory, 'cloudflared');
  await writeFile(priorPath, 'prior binary', { mode: 0o700 });
  const archive = Buffer.from('expected archive');
  const release = {
    architecture: 'arm64' as const,
    version: CLOUDFLARED_VERSION,
    archiveUrl: 'https://downloads.example/cloudflared.tgz',
    archiveBytes: archive.byteLength,
    archiveSha256: sha256(archive),
    executableSha256: 'a'.repeat(64),
  };
  const processManager = new ProcessManager({ statePath: root });

  await assert.rejects(
    installCloudflaredRelease({
      installationDirectory,
      release,
      processManager,
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: 'http://insecure.example/cloudflared.tgz' },
      }),
    }),
    /redirects must remain.*HTTPS/,
  );
  assert.equal(await readFile(priorPath, 'utf8'), 'prior binary');
  assert.deepEqual(await readdir(installationDirectory), ['cloudflared']);

  await assert.rejects(
    installCloudflaredRelease({
      installationDirectory,
      release,
      processManager,
      fetchImpl: async () => new Response(Buffer.from('corrupt archive!'), {
        status: 200,
        headers: { 'content-length': String(archive.byteLength) },
      }),
    }),
    /SHA-256 mismatch/,
  );
  assert.equal(await readFile(priorPath, 'utf8'), 'prior binary');
  assert.deepEqual(await readdir(installationDirectory), ['cloudflared']);
});

test('Cloudflared launch re-verifies the executable and injects fixed direct argv flags', async () => {
  const root = await tempRoot('loom-cloudflared-launch-');
  const executable = path.join(root, 'fake cloudflared');
  const argsPath = path.join(root, 'args.json');
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === '--version') {
  process.stdout.write('cloudflared version ${CLOUDFLARED_VERSION} (built test)\\n');
  process.exit(0);
}
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1000);
`);
  await chmod(executable, 0o700);
  const expectedSha256 = await hashCloudflaredExecutable(executable);
  const processManager = new ProcessManager({ statePath: root });

  const job = await startCloudflared({
    processManager,
    executablePath: executable,
    expectedSha256,
    expectedVersion: CLOUDFLARED_VERSION,
    cwd: root,
    args: ['--url', 'http://127.0.0.1:43123', 'value with spaces'],
  });
  try {
    let args: string[] | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        args = JSON.parse(await readFile(argsPath, 'utf8')) as string[];
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.deepEqual(args, [
      'tunnel',
      '--no-autoupdate',
      '--metrics',
      '127.0.0.1:0',
      '--url',
      'http://127.0.0.1:43123',
      'value with spaces',
    ]);
    assert.equal(job.metadata.targetExecutablePath, executable);
  } finally {
    await job.cancel();
  }

  await assert.rejects(
    startCloudflared({
      processManager,
      executablePath: executable,
      expectedSha256,
      expectedVersion: CLOUDFLARED_VERSION,
      cwd: root,
      args: ['--metrics=0.0.0.0:9999'],
    }),
    /reserved Cloudflared option/,
  );
});


test('Quick Tunnel parser accepts only strict trycloudflare origins and config conflicts fail closed', async () => {
  assert.equal(
    quickTunnelOriginFromOutput('INF Visit https://First-Part.trycloudflare.com now\n'),
    'https://first-part.trycloudflare.com',
  );
  assert.equal(quickTunnelOriginFromOutput('https://first-part.trycloudflare.com/path\n'), null);
  assert.equal(quickTunnelOriginFromOutput('https://first-part.trycloudflare.com:443\n'), null);
  assert.equal(quickTunnelOriginFromOutput('https://-bad.trycloudflare.com\n'), null);
  assert.equal(quickTunnelOriginFromOutput('https://bad-.trycloudflare.com\n'), null);
  assert.equal(quickTunnelOriginFromOutput('https://two.labels.trycloudflare.com\n'), null);
  assert.equal(quickTunnelOriginFromOutput('prefixhttps://valid.trycloudflare.com\n'), null);
  const hostile = `${'a'.repeat(256 * 1024)}https://${'-'.repeat(64)}.trycloudflare.com`;
  const parseStarted = performance.now();
  assert.equal(quickTunnelOriginFromOutput(hostile), null);
  assert.equal(performance.now() - parseStarted < 250, true);

  const root = await tempRoot('loom-quick-config-');
  const configDirectory = path.join(root, '.cloudflared');
  await assertQuickTunnelConfigCompatible(configDirectory);
  await mkdir(configDirectory, { mode: 0o700 });
  await writeFile(path.join(configDirectory, 'config.yaml'), 'tunnel: existing\n', { mode: 0o600 });
  await assert.rejects(
    assertQuickTunnelConfigCompatible(configDirectory),
    QuickTunnelConfigError,
  );
  await rm(path.join(configDirectory, 'config.yaml'));
  await writeFile(path.join(configDirectory, 'config.yml'), 'ingress: []\n', { mode: 0o600 });
  await assert.rejects(
    assertQuickTunnelConfigCompatible(configDirectory),
    /config\.yml/,
  );
});


test('Named Tunnel validates a stable hostname and matching private Cloudflare authentication files', async () => {
  const root = await tempRoot('loom-named-validation-');
  const cloudflareDirectory = path.join(root, '.cloudflared');
  await mkdir(cloudflareDirectory, { mode: 0o700 });
  const originCertFile = path.join(cloudflareDirectory, 'cert.pem');
  const credentialsFile = path.join(cloudflareDirectory, '6f4f721c-22f2-41c7-a77d-41e5b09e4fc2.json');
  const originToken = Buffer.from(JSON.stringify({
    zoneID: 'zone-id',
    accountID: 'account-id',
    apiToken: 'api-token',
  })).toString('base64');
  await writeFile(originCertFile, [
    '-----BEGIN ARGO TUNNEL TOKEN-----',
    originToken,
    '-----END ARGO TUNNEL TOKEN-----',
    '',
  ].join('\n'), { mode: 0o600 });
  await writeFile(credentialsFile, `${JSON.stringify({
    AccountTag: 'account-id',
    TunnelSecret: Buffer.alloc(32, 7).toString('base64'),
    TunnelID: '6f4f721c-22f2-41c7-a77d-41e5b09e4fc2',
    TunnelName: 'loom-prod',
  })}\n`, { mode: 0o600 });

  const validated = await validateNamedTunnelConfiguration({
    tunnelName: 'loom-prod',
    hostname: 'LOOM.Example.COM',
    originCertFile,
    credentialsFile,
  });
  assert.deepEqual(validated, {
    tunnelName: 'loom-prod',
    tunnelId: '6f4f721c-22f2-41c7-a77d-41e5b09e4fc2',
    hostname: 'loom.example.com',
    publicOrigin: 'https://loom.example.com',
    publicEndpoint: 'https://loom.example.com/mcp',
    originCertFile,
    credentialsFile,
  });

  await writeFile(credentialsFile, `${JSON.stringify({
    AccountTag: 'account-id',
    TunnelSecret: Buffer.alloc(32, 7).toString('base64'),
    TunnelID: '6f4f721c-22f2-41c7-a77d-41e5b09e4fc2',
    TunnelName: 'other-tunnel',
  })}\n`, { mode: 0o600 });
  await assert.rejects(
    validateNamedTunnelConfiguration({
      tunnelName: 'loom-prod',
      hostname: 'loom.example.com',
      originCertFile,
      credentialsFile,
    }),
    /do not match configured tunnel name/,
  );

  await assert.rejects(
    validateNamedTunnelConfiguration({
      tunnelName: 'loom-prod',
      hostname: 'unsafe.trycloudflare.com',
      originCertFile,
      credentialsFile,
    }),
    NamedTunnelConfigError,
  );

  const symlinkedCredentials = path.join(root, 'credentials-link.json');
  await symlink(credentialsFile, symlinkedCredentials);
  await assert.rejects(
    validateNamedTunnelConfiguration({
      tunnelName: 'loom-prod',
      hostname: 'loom.example.com',
      originCertFile,
      credentialsFile: symlinkedCredentials,
    }),
    /symbolic/i,
  );
});


test('Named Tunnel manager launches exact ephemeral-origin argv and publishes stable production status', async () => {
  const root = await tempRoot('loom-named-manager-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const auditDirectory = path.join(root, 'audit');
  const audit = await AuditLogger.create({ auditDirectory });
  const process = new ScriptedQuickProcess([
    { text: 'INF Initial protocol quic\n' },
    { text: 'INF Registered tunnel connection connIndex=0\n' },
  ]);
  const starts: string[][] = [];
  let clock = 0;
  const manager = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used-by-injected-start',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'LOOM.Example.COM',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    startProcess: async (args) => {
      starts.push(args);
      return process;
    },
  });

  const initialStatus = manager.status;
  assert.deepEqual(initialStatus, {
    mode: 'named',
    ready: false,
    starting: false,
    stopping: false,
    tunnelName: 'loom-prod',
    tunnelId: null,
    hostname: 'loom.example.com',
    publicOrigin: null,
    publicEndpoint: null,
    production: false,
    retryCount: 0,
  });

  try {
    const ready = await manager.start();
    assert.deepEqual(ready, {
      mode: 'named',
      tunnelName: 'loom-prod',
      tunnelId: artifacts.tunnelId,
      hostname: 'loom.example.com',
      publicOrigin: 'https://loom.example.com',
      publicEndpoint: 'https://loom.example.com/mcp',
      production: true,
      retryCount: 0,
    });
    assert.deepEqual(starts, [[
      '--origincert',
      artifacts.originCertFile,
      'run',
      '--url',
      'http://127.0.0.1:43123',
      '--credentials-file',
      artifacts.credentialsFile,
      'loom-prod',
    ]]);
    assert.deepEqual(manager.status, {
      mode: 'named',
      ready: true,
      starting: false,
      stopping: false,
      tunnelName: 'loom-prod',
      tunnelId: artifacts.tunnelId,
      hostname: 'loom.example.com',
      publicOrigin: 'https://loom.example.com',
      publicEndpoint: 'https://loom.example.com/mcp',
      production: true,
      retryCount: 0,
    });
    const persistedAudit = JSON.stringify(await auditRecords(auditDirectory));
    for (const forbidden of [
      'loom-prod',
      'loom.example.com',
      'https://loom.example.com/mcp',
      artifacts.originCertFile,
      artifacts.credentialsFile,
      artifacts.tunnelSecret,
      'account-id',
      'api-token',
      'Registered tunnel connection',
      'Initial protocol quic',
    ]) {
      assert.equal(persistedAudit.includes(forbidden), false);
    }
  } finally {
    await manager.stop();
    await manager.stop();
    assert.equal(manager.status.production, false);
    assert.equal(manager.status.publicEndpoint, null);
    await audit.close();
  }
  assert.equal(process.cancelCount, 1);
});

test('Named Tunnel stable endpoints preserve OAuth generation and owner password across restart', async () => {
  const root = await tempRoot('loom-named-endpoint-');
  const stateRoot = path.join(root, '.loom');
  await initializeState(stateRoot);
  const opened = await AuthStore.open(stateRoot);
  assert.ok(opened.ownerPassword);
  const ownerPassword = opened.ownerPassword;
  const bindings: string[] = [];
  const readiness = new RuntimeReadiness({
    stateRoot,
    mcp: {
      origin: 'http://127.0.0.1:43123',
      mcpUrl: 'http://127.0.0.1:43123/mcp',
      bindPublicEndpoint: async (resource) => {
        bindings.push(resource);
        await opened.store.bindEndpoint(resource);
      },
    },
  });
  await readiness.persistNotReady();
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(stateRoot, 'audit') });

  async function run(hostname: string) {
    const process = new ScriptedQuickProcess([{
      text: 'INF Registered tunnel connection connIndex=0\n',
    }]);
    const manager = new NamedTunnelManager({
      audit,
      processManager: new ProcessManager({ statePath: stateRoot }),
      executablePath: '/private/tmp/not-used',
      expectedSha256: 'a'.repeat(64),
      expectedVersion: CLOUDFLARED_VERSION,
      localOrigin: 'http://127.0.0.1:43123',
      tunnelName: 'loom-prod',
      hostname,
      originCertFile: artifacts.originCertFile,
      credentialsFile: artifacts.credentialsFile,
      cwd: stateRoot,
      now: () => 0,
      sleep: async () => undefined,
      startProcess: async () => process,
    });
    const ready = await manager.start();
    const runtime = await readiness.bindPublicOrigin({
      publicOrigin: ready.publicOrigin,
      tunnelMode: 'named',
    });
    await manager.stop();
    return runtime;
  }

  const first = await run('loom.example.com');
  assert.equal(first.productionEligible, true);
  assert.equal(opened.store.generation, 1);
  const restarted = await run('LOOM.Example.COM');
  assert.equal(restarted.publicMcpUrl, first.publicMcpUrl);
  assert.equal(opened.store.generation, 1);
  const changed = await run('new-loom.example.com');
  assert.equal(changed.publicMcpUrl, 'https://new-loom.example.com/mcp');
  assert.equal(opened.store.generation, 2);
  assert.deepEqual(bindings, [
    'https://loom.example.com/mcp',
    'https://loom.example.com/mcp',
    'https://new-loom.example.com/mcp',
  ]);
  assert.equal(await opened.store.verifyOwnerPassword(ownerPassword), true);

  const reopened = await AuthStore.open(stateRoot);
  assert.equal(reopened.ownerPassword, null);
  assert.equal(await reopened.store.verifyOwnerPassword(ownerPassword), true);
  assert.equal(reopened.store.generation, 2);
  assert.equal(reopened.store.resourceUri, 'https://new-loom.example.com/mcp');
  await audit.close();
});

test('Named Tunnel retries only transient failures with exponential backoff', async () => {
  const root = await tempRoot('loom-named-retry-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const processes = [
    new ScriptedQuickProcess([{ text: 'ERR edge connection failed\n', state: 'completed', exitCode: 1 }]),
    new ScriptedQuickProcess([{ text: 'ERR temporary network failure\n', state: 'completed', exitCode: 1 }]),
    new ScriptedQuickProcess([{ text: 'INF Registered tunnel connection\n' }]),
  ];
  const sleeps: number[] = [];
  let clock = 0;
  let starts = 0;
  const manager = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'loom.example.com',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    now: () => clock,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
    startProcess: async () => processes[starts++]!,
  });
  try {
    const ready = await manager.start();
    assert.equal(ready.retryCount, 2);
    assert.equal(starts, 3);
    assert.deepEqual(sleeps, [
      NAMED_TUNNEL_BACKOFF_BASE_MS,
      NAMED_TUNNEL_BACKOFF_BASE_MS * 2,
    ]);
    assert.deepEqual(processes.slice(0, 2).map((item) => item.cancelCount), [1, 1]);
  } finally {
    await manager.stop();
    await audit.close();
  }
  assert.equal(processes[2]!.cancelCount, 1);
});

test('Named Tunnel stops after five transient retries and caps exponential backoff', async () => {
  const root = await tempRoot('loom-named-retry-limit-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const processes = Array.from(
    { length: NAMED_TUNNEL_MAX_RETRIES + 1 },
    () => new ScriptedQuickProcess([{ text: 'ERR temporary edge failure\n', state: 'completed', exitCode: 1 }]),
  );
  const sleeps: number[] = [];
  let clock = 0;
  let starts = 0;
  const manager = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'loom.example.com',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    now: () => clock,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
    startProcess: async () => processes[starts++]!,
  });
  await assert.rejects(manager.start(), NamedTunnelStartupError);
  assert.equal(starts, NAMED_TUNNEL_MAX_RETRIES + 1);
  assert.deepEqual(sleeps, Array.from({ length: NAMED_TUNNEL_MAX_RETRIES }, (_, index) => (
    Math.min(NAMED_TUNNEL_BACKOFF_BASE_MS * (2 ** index), NAMED_TUNNEL_BACKOFF_MAX_MS)
  )));
  assert.deepEqual(processes.map((item) => item.cancelCount), processes.map(() => 1));
  await audit.close();
});

test('Named Tunnel authentication and configuration failures stop immediately without fallback', async () => {
  const root = await tempRoot('loom-named-fail-fast-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });

  for (const scenario of [
    {
      output: 'ERR authentication failed: unauthorized\n',
      expected: NamedTunnelAuthError,
    },
    {
      output: 'ERR error parsing tunnel ID: tunnel not found\n',
      expected: NamedTunnelConfigError,
    },
  ]) {
    const process = new ScriptedQuickProcess([{
      text: scenario.output,
      state: 'completed',
      exitCode: 1,
    }]);
    const sleeps: number[] = [];
    let starts = 0;
    const manager = new NamedTunnelManager({
      audit,
      processManager: new ProcessManager({ statePath: root }),
      executablePath: '/private/tmp/not-used',
      expectedSha256: 'a'.repeat(64),
      expectedVersion: CLOUDFLARED_VERSION,
      localOrigin: 'http://127.0.0.1:43123',
      tunnelName: 'loom-prod',
      hostname: 'loom.example.com',
      originCertFile: artifacts.originCertFile,
      credentialsFile: artifacts.credentialsFile,
      cwd: root,
      now: () => 0,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      startProcess: async () => { starts += 1; return process; },
    });
    await assert.rejects(manager.start(), scenario.expected);
    assert.equal(starts, 1);
    assert.deepEqual(sleeps, []);
    assert.equal(process.cancelCount, 1);
  }
  await audit.close();
});

test('Named Tunnel validates files before audit and audit failure blocks launch', async () => {
  const root = await tempRoot('loom-named-audit-order-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  await audit.close();
  let starts = 0;

  await writeFile(artifacts.credentialsFile, '{}\n', { mode: 0o600 });
  const invalid = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'loom.example.com',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    startProcess: async () => { starts += 1; return new ScriptedQuickProcess([]); },
  });
  await assert.rejects(invalid.start(), NamedTunnelConfigError);
  assert.equal(starts, 0);

  await makeNamedTunnelArtifacts(root);
  const blocked = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'loom.example.com',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    startProcess: async () => { starts += 1; return new ScriptedQuickProcess([]); },
  });
  await assert.rejects(blocked.start(), /Audit is unavailable/);
  assert.equal(starts, 0);
});

test('Named Tunnel readiness timeout cleans every attempt and never falls back to Quick Tunnel', async () => {
  const root = await tempRoot('loom-named-timeout-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const processes = Array.from(
    { length: NAMED_TUNNEL_MAX_RETRIES + 1 },
    () => new ScriptedQuickProcess([]),
  );
  let clock = 0;
  let starts = 0;
  const manager = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'loom.example.com',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    startProcess: async (args) => {
      assert.equal(args.includes('trycloudflare.com'), false);
      return processes[starts++]!;
    },
  });
  await assert.rejects(manager.start(), new RegExp(String(NAMED_TUNNEL_READY_DEADLINE_MS)));
  assert.equal(starts, NAMED_TUNNEL_MAX_RETRIES + 1);
  assert.deepEqual(processes.map((item) => item.cancelCount), processes.map(() => 1));
  await audit.close();
});


test('Named Tunnel stop during startup cancels the active attempt without retry', async () => {
  const root = await tempRoot('loom-named-stop-starting-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const process = new ScriptedQuickProcess([]);
  let starts = 0;
  let clock = 0;
  let releaseSleep!: () => void;
  let enteredSleep!: () => void;
  const sleepEntered = new Promise<void>((resolve) => { enteredSleep = resolve; });
  const sleepRelease = new Promise<void>((resolve) => { releaseSleep = resolve; });
  const manager = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'loom.example.com',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    now: () => clock,
    sleep: async (milliseconds) => {
      enteredSleep();
      await sleepRelease;
      clock += milliseconds;
    },
    startProcess: async () => {
      starts += 1;
      return process;
    },
  });

  const starting = manager.start();
  await sleepEntered;
  await manager.stop();
  let startupOutcome: Error | 'pending';
  try {
    startupOutcome = await Promise.race([
      starting.then(
        () => new Error('Named Tunnel startup unexpectedly resolved.'),
        (error: unknown) => error instanceof Error ? error : new Error(String(error)),
      ),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);
  } finally {
    releaseSleep();
  }
  assert.notEqual(startupOutcome, 'pending');
  assert.match((startupOutcome as Error).message, /stopped during startup/i);
  assert.equal(starts, 1);
  assert.equal(process.cancelCount, 1);
  assert.equal(manager.status.ready, false);
  assert.equal(manager.status.publicEndpoint, null);
  await audit.close();
});

test('Named Tunnel revalidates authentication files before every retry', async () => {
  const root = await tempRoot('loom-named-revalidate-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const first = new ScriptedQuickProcess([{
    text: 'ERR temporary edge failure\n',
    state: 'completed',
    exitCode: 1,
  }]);
  let starts = 0;
  let mutated = false;
  const manager = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'loom.example.com',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    now: () => 0,
    sleep: async () => {
      if (!mutated) {
        mutated = true;
        await writeFile(artifacts.credentialsFile, '{}\n', { mode: 0o600 });
      }
    },
    startProcess: async () => {
      starts += 1;
      return first;
    },
  });
  await assert.rejects(manager.start(), NamedTunnelConfigError);
  assert.equal(starts, 1);
  assert.equal(first.cancelCount, 1);
  await audit.close();
});

test('Named Tunnel cleanup failure blocks retry and remains fail closed', async () => {
  const root = await tempRoot('loom-named-cleanup-fail-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const scripted = new ScriptedQuickProcess([{
    text: 'ERR temporary edge failure\n',
    state: 'completed',
    exitCode: 1,
  }]);
  const brokenProcess: QuickTunnelProcess = {
    poll: (cursor) => scripted.poll(cursor),
    cancel: async () => {
      throw new Error('cleanup failed');
    },
  };
  let starts = 0;
  const sleeps: number[] = [];
  const manager = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'loom.example.com',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    now: () => 0,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    startProcess: async () => {
      starts += 1;
      return brokenProcess;
    },
  });
  await assert.rejects(manager.start(), /clean up named-tunnel process/i);
  await assert.rejects(manager.start(), /uncleaned named-tunnel process/i);
  assert.equal(starts, 1);
  assert.deepEqual(sleeps, []);
  await audit.close();
});

test('Named Tunnel ignores benign missing persistent-config notices', async () => {
  const root = await tempRoot('loom-named-benign-config-log-');
  const artifacts = await makeNamedTunnelArtifacts(root);
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const process = new ScriptedQuickProcess([{
    text: 'INF No configuration file found; continuing with command-line arguments\n',
  }, {
    text: 'INF Registered tunnel connection\n',
  }]);
  let starts = 0;
  const manager = new NamedTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    tunnelName: 'loom-prod',
    hostname: 'loom.example.com',
    originCertFile: artifacts.originCertFile,
    credentialsFile: artifacts.credentialsFile,
    cwd: root,
    now: () => 0,
    sleep: async () => undefined,
    startProcess: async () => {
      starts += 1;
      return process;
    },
  });
  try {
    const ready = await manager.start();
    assert.equal(ready.production, true);
    assert.equal(starts, 1);
  } finally {
    await manager.stop();
    await audit.close();
  }
});

test('Named Tunnel static validation rejects option-like names and malformed credentials', async () => {
  const root = await tempRoot('loom-named-static-reject-');
  const artifacts = await makeNamedTunnelArtifacts(root);

  await assert.rejects(
    validateNamedTunnelConfiguration({
      tunnelName: '--url',
      hostname: 'loom.example.com',
      originCertFile: artifacts.originCertFile,
      credentialsFile: artifacts.credentialsFile,
    }),
    NamedTunnelConfigError,
  );

  await chmod(artifacts.credentialsFile, 0o644);
  await assert.rejects(
    validateNamedTunnelConfiguration({
      tunnelName: 'loom-prod',
      hostname: 'loom.example.com',
      originCertFile: artifacts.originCertFile,
      credentialsFile: artifacts.credentialsFile,
    }),
    /private/i,
  );
  await chmod(artifacts.credentialsFile, 0o600);

  await writeFile(artifacts.credentialsFile, `${JSON.stringify({
    AccountTag: 'wrong-account',
    TunnelSecret: artifacts.tunnelSecret,
    TunnelID: artifacts.tunnelId,
    TunnelName: 'loom-prod',
  })}\n`, { mode: 0o600 });
  await assert.rejects(
    validateNamedTunnelConfiguration({
      tunnelName: 'loom-prod',
      hostname: 'loom.example.com',
      originCertFile: artifacts.originCertFile,
      credentialsFile: artifacts.credentialsFile,
    }),
    /origin certificate account/,
  );

  await writeFile(artifacts.credentialsFile, `${JSON.stringify({
    AccountTag: 'account-id',
    TunnelSecret: 'not-base64',
    TunnelID: 'not-a-uuid',
    TunnelName: 'loom-prod',
  })}\n`, { mode: 0o600 });
  await assert.rejects(
    validateNamedTunnelConfiguration({
      tunnelName: 'loom-prod',
      hostname: 'loom.example.com',
      originCertFile: artifacts.originCertFile,
      credentialsFile: artifacts.credentialsFile,
    }),
    /invalid TunnelID/,
  );
});


test('Quick Tunnel manager parses split output, waits for registration, audits safely, and reports non-production status', async () => {
  const root = await tempRoot('loom-quick-manager-');
  const auditDirectory = path.join(root, 'audit');
  const audit = await AuditLogger.create({ auditDirectory });
  const process = new ScriptedQuickProcess([
    { text: 'INF Quick Tunnel: https://split-' },
    { text: 'origin.trycloudflare.com' },
    { text: '\nINF Registered tunnel connection connIndex=0\n' },
  ]);
  const starts: string[][] = [];
  let clock = 0;
  const manager = new QuickTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used-by-injected-start',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    cwd: root,
    configDirectory: path.join(root, '.cloudflared'),
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    startProcess: async (args) => {
      starts.push(args);
      return process;
    },
  });

  try {
    const ready = await manager.start();
    assert.deepEqual(ready, {
      mode: 'quick',
      publicOrigin: 'https://split-origin.trycloudflare.com',
      publicEndpoint: 'https://split-origin.trycloudflare.com/mcp',
      production: false,
      recreationCount: 0,
    });
    assert.deepEqual(starts, [['--url', 'http://127.0.0.1:43123']]);
    assert.deepEqual(manager.status, {
      mode: 'quick',
      ready: true,
      starting: false,
      stopping: false,
      publicOrigin: ready.publicOrigin,
      publicEndpoint: ready.publicEndpoint,
      production: false,
      recreationCount: 0,
    });
    const persistedAudit = JSON.stringify(await auditRecords(auditDirectory));
    assert.equal(persistedAudit.includes('trycloudflare.com'), false);
    assert.equal(persistedAudit.includes('Registered tunnel connection'), false);
  } finally {
    await manager.stop();
    await audit.close();
  }
  assert.equal(process.cancelCount, 1);
});

test('Quick Tunnel permits exactly one transient recreation and cleans both attempts', async () => {
  const root = await tempRoot('loom-quick-recreate-');
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const first = new ScriptedQuickProcess([{ state: 'completed', exitCode: 1 }]);
  const second = new ScriptedQuickProcess([{
    text: 'https://second.trycloudflare.com\nRegistered tunnel connection\n',
  }]);
  const processes = [first, second];
  let starts = 0;
  const manager = new QuickTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    cwd: root,
    configDirectory: path.join(root, '.cloudflared'),
    now: () => 0,
    sleep: async () => undefined,
    startProcess: async () => processes[starts++]!,
  });
  try {
    const ready = await manager.start();
    assert.equal(ready.recreationCount, 1);
    assert.equal(starts, 2);
    assert.equal(first.cancelCount, 1);
  } finally {
    await manager.stop();
    await audit.close();
  }
  assert.equal(second.cancelCount, 1);

  const failureAudit = await AuditLogger.create({ auditDirectory: path.join(root, 'failure-audit') });
  const failed = [
    new ScriptedQuickProcess([{ state: 'completed', exitCode: 1 }]),
    new ScriptedQuickProcess([{ state: 'completed', exitCode: 1 }]),
  ];
  let failedStarts = 0;
  const failing = new QuickTunnelManager({
    audit: failureAudit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    cwd: root,
    configDirectory: path.join(root, '.cloudflared'),
    now: () => 0,
    sleep: async () => undefined,
    startProcess: async () => failed[failedStarts++]!,
  });
  await assert.rejects(failing.start(), QuickTunnelStartupError);
  assert.equal(failedStarts, 2);
  assert.deepEqual(failed.map((process) => process.cancelCount), [1, 1]);
  await failureAudit.close();
});

test('Quick Tunnel rejects malformed candidate URLs without recreation', async () => {
  const root = await tempRoot('loom-quick-unsafe-');
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const process = new ScriptedQuickProcess([{
    text: 'https://valid.trycloudflare.com/path\nRegistered tunnel connection\n',
  }]);
  let starts = 0;
  const manager = new QuickTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    cwd: root,
    configDirectory: path.join(root, '.cloudflared'),
    now: () => 0,
    sleep: async () => undefined,
    startProcess: async () => { starts += 1; return process; },
  });
  await assert.rejects(manager.start(), QuickTunnelUnsafeUrlError);
  assert.equal(starts, 1);
  assert.equal(process.cancelCount, 1);
  await audit.close();
});

test('Quick Tunnel enforces the 15-second deadline on each of at most two attempts', async () => {
  const root = await tempRoot('loom-quick-deadline-');
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const processes = [new ScriptedQuickProcess([]), new ScriptedQuickProcess([])];
  let starts = 0;
  let clock = 0;
  const manager = new QuickTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    cwd: root,
    configDirectory: path.join(root, '.cloudflared'),
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    startProcess: async () => processes[starts++]!,
  });
  await assert.rejects(
    manager.start(),
    new RegExp(String(QUICK_TUNNEL_URL_DEADLINE_MS)),
  );
  assert.equal(starts, 2);
  assert.equal(clock, QUICK_TUNNEL_URL_DEADLINE_MS * 2);
  assert.deepEqual(processes.map((process) => process.cancelCount), [1, 1]);
  await audit.close();
});


test('Quick Tunnel URL changes invalidate endpoint OAuth state without rotating the owner password', async () => {
  const root = await tempRoot('loom-quick-endpoint-');
  const stateRoot = path.join(root, '.loom');
  await initializeState(stateRoot);
  const opened = await AuthStore.open(stateRoot);
  assert.ok(opened.ownerPassword);
  const ownerPassword = opened.ownerPassword;
  const bindings: string[] = [];
  const readiness = new RuntimeReadiness({
    stateRoot,
    mcp: {
      origin: 'http://127.0.0.1:43123',
      mcpUrl: 'http://127.0.0.1:43123/mcp',
      bindPublicEndpoint: async (resource) => {
        bindings.push(resource);
        await opened.store.bindEndpoint(resource);
      },
    },
  });
  await readiness.persistNotReady();
  const audit = await AuditLogger.create({ auditDirectory: path.join(stateRoot, 'audit') });

  async function run(originLabel: string) {
    const process = new ScriptedQuickProcess([{
      text: `https://${originLabel}.trycloudflare.com\nRegistered tunnel connection\n`,
    }]);
    const manager = new QuickTunnelManager({
      audit,
      processManager: new ProcessManager({ statePath: stateRoot }),
      executablePath: '/private/tmp/not-used',
      expectedSha256: 'a'.repeat(64),
      expectedVersion: CLOUDFLARED_VERSION,
      localOrigin: 'http://127.0.0.1:43123',
      cwd: stateRoot,
      configDirectory: path.join(root, '.cloudflared'),
      now: () => 0,
      sleep: async () => undefined,
      startProcess: async () => process,
    });
    const ready = await manager.start();
    const runtime = await readiness.bindPublicOrigin({
      publicOrigin: ready.publicOrigin,
      tunnelMode: 'quick',
    });
    await manager.stop();
    return runtime;
  }

  const first = await run('first-owner');
  assert.equal(first.productionEligible, false);
  assert.equal(opened.store.generation, 1);
  const second = await run('second-owner');
  assert.equal(second.productionEligible, false);
  assert.equal(opened.store.generation, 2);
  assert.deepEqual(bindings, [
    'https://first-owner.trycloudflare.com/mcp',
    'https://second-owner.trycloudflare.com/mcp',
  ]);
  assert.equal(await opened.store.verifyOwnerPassword(ownerPassword), true);

  const reopened = await AuthStore.open(stateRoot);
  assert.equal(reopened.ownerPassword, null);
  assert.equal(await reopened.store.verifyOwnerPassword(ownerPassword), true);
  assert.equal(reopened.store.generation, 2);
  assert.equal(reopened.store.resourceUri, 'https://second-owner.trycloudflare.com/mcp');
  await audit.close();
});

test('Quick Tunnel recreates once after a transient process-start failure', async () => {
  const root = await tempRoot('loom-quick-start-failure-');
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  const process = new ScriptedQuickProcess([{
    text: 'https://recovered.trycloudflare.com\nRegistered tunnel connection\n',
  }]);
  let starts = 0;
  const manager = new QuickTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    cwd: root,
    configDirectory: path.join(root, '.cloudflared'),
    now: () => 0,
    sleep: async () => undefined,
    startProcess: async () => {
      starts += 1;
      if (starts === 1) throw new Error('transient spawn failure');
      return process;
    },
  });
  try {
    const ready = await manager.start();
    assert.equal(ready.recreationCount, 1);
    assert.equal(starts, 2);
  } finally {
    await manager.stop();
    await audit.close();
  }
});

test('Quick Tunnel audit failure blocks process launch', async () => {
  const root = await tempRoot('loom-quick-audit-fail-');
  const audit = await AuditLogger.create({ auditDirectory: path.join(root, 'audit') });
  await audit.close();
  let starts = 0;
  const manager = new QuickTunnelManager({
    audit,
    processManager: new ProcessManager({ statePath: root }),
    executablePath: '/private/tmp/not-used',
    expectedSha256: 'a'.repeat(64),
    expectedVersion: CLOUDFLARED_VERSION,
    localOrigin: 'http://127.0.0.1:43123',
    cwd: root,
    configDirectory: path.join(root, '.cloudflared'),
    startProcess: async () => {
      starts += 1;
      return new ScriptedQuickProcess([]);
    },
  });
  await assert.rejects(manager.start(), /Audit is unavailable/);
  assert.equal(starts, 0);
});
