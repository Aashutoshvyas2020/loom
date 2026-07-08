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
  cloudflaredReleaseFor,
  discoverCloudflaredOnPath,
  hashCloudflaredExecutable,
  installCloudflaredRelease,
  startCloudflared,
  verifyCloudflaredExecutable,
} from '../src/cloudflare.js';
import { ProcessManager } from '../src/process-manager.js';

const execFileAsync = promisify(execFile);

async function tempRoot(prefix = 'loom-cloudflared-'): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
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
