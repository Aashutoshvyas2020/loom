import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { assertNoSymlinkComponents, resolveUserPath } from './paths.js';
import { ProcessManager } from './process-manager.js';

const execFileAsync = promisify(execFile);

export class CloudflaredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CloudflaredError';
  }
}

export class CloudflaredExecutableError extends CloudflaredError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CloudflaredExecutableError';
  }
}

export class CloudflaredInstallError extends CloudflaredError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CloudflaredInstallError';
  }
}

export class CloudflaredLaunchError extends CloudflaredError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CloudflaredLaunchError';
  }
}

export const CLOUDFLARED_VERSION = '2026.7.0';
export const CLOUDFLARED_DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

type SupportedArchitecture = 'arm64' | 'x64';

export interface CloudflaredRelease {
  architecture: SupportedArchitecture;
  version: string;
  archiveUrl: string;
  archiveBytes: number;
  archiveSha256: string;
  executableSha256: string;
}

export interface VerifiedCloudflaredExecutable {
  requestedPath: string;
  executablePath: string;
  sha256: string;
  bytes: number;
  version: string;
}

export interface VerifyCloudflaredExecutableInput {
  executablePath: string;
  expectedSha256: string;
  expectedVersion: string;
  processManager: ProcessManager;
}

export interface DiscoverCloudflaredOnPathInput {
  pathValue?: string;
  expectedSha256: string;
  expectedVersion: string;
  processManager: ProcessManager;
}

export interface InstallCloudflaredReleaseOptions {
  installationDirectory: string;
  release: CloudflaredRelease;
  processManager: ProcessManager;
  fetchImpl?: typeof fetch;
  extractArchive?: (archivePath: string, executablePath: string) => Promise<void>;
  maxRedirects?: number;
  downloadTimeoutMs?: number;
}

export interface StartCloudflaredOptions extends VerifyCloudflaredExecutableInput {
  cwd: string;
  args: string[];
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

const MAX_DOWNLOAD_TIMEOUT_MS = CLOUDFLARED_DOWNLOAD_TIMEOUT_MS;

const RELEASES: Readonly<Record<SupportedArchitecture, Omit<CloudflaredRelease, 'architecture'>>> = {
  arm64: {
    version: CLOUDFLARED_VERSION,
    archiveUrl: 'https://github.com/cloudflare/cloudflared/releases/download/2026.7.0/cloudflared-darwin-arm64.tgz',
    archiveBytes: 18_957_597,
    archiveSha256: '276f4ae3119c88d1708b0f884a35a1c87d9ae459b0dab6313f2daddbddab2bec',
    executableSha256: 'cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04',
  },
  x64: {
    version: CLOUDFLARED_VERSION,
    archiveUrl: 'https://github.com/cloudflare/cloudflared/releases/download/2026.7.0/cloudflared-darwin-amd64.tgz',
    archiveBytes: 20_841_929,
    archiveSha256: 'dd1fb6a914a21dc52c64bad96987bbbc72d6c65553a2cfee1dd5bc886742ddfb',
    executableSha256: 'c0c65579c6f11b1381cf5ffd1614f5094bf140e18938eae4ad16931da9f69499',
  },
};

function currentUserId(): number {
  if (process.getuid === undefined) {
    throw new CloudflaredExecutableError('Cloudflared ownership checks require POSIX.');
  }
  return process.getuid();
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

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
  await assertNoSymlinkComponents(path.dirname(directoryPath));
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  await assertNoSymlinkComponents(directoryPath);
  const stats = await lstat(directoryPath);
  if (stats.isSymbolicLink() || !stats.isDirectory() || stats.uid !== currentUserId()) {
    throw new CloudflaredInstallError(`Unsafe Cloudflared installation directory: ${directoryPath}`);
  }
  if ((stats.mode & 0o777) !== 0o700) await chmod(directoryPath, 0o700);
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function inspectCloudflaredExecutable(inputPath: string): Promise<{
  requestedPath: string;
  executablePath: string;
  sha256: string;
  bytes: number;
}> {
  const requestedPath = resolveUserPath(inputPath);
  let executablePath: string;
  try {
    executablePath = await realpath(requestedPath);
    await assertNoSymlinkComponents(executablePath);
  } catch (error) {
    throw new CloudflaredExecutableError(
      `Unable to resolve cloudflared executable: ${String(error)}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const discovered = await lstat(executablePath, { bigint: true });
    if (discovered.isSymbolicLink() || !discovered.isFile()) {
      throw new CloudflaredExecutableError('Cloudflared executable must resolve to a regular file.');
    }
    if (discovered.uid !== BigInt(currentUserId())) {
      throw new CloudflaredExecutableError('Cloudflared executable is not owned by the current user.');
    }
    if ((Number(discovered.mode) & 0o111) === 0) {
      throw new CloudflaredExecutableError('Cloudflared executable is not executable.');
    }

    handle = await open(executablePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== discovered.dev || before.ino !== discovered.ino) {
      throw new CloudflaredExecutableError('Cloudflared executable changed before verification.');
    }
    const digest = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      digest.update(chunk as Buffer);
    }
    const after = await handle.stat({ bigint: true });
    const currentPath = await realpath(requestedPath);
    await assertNoSymlinkComponents(executablePath);
    const pathname = await lstat(executablePath, { bigint: true });
    if (currentPath !== executablePath
      || !pathname.isFile()
      || !sameIdentity(before, after)
      || before.dev !== pathname.dev
      || before.ino !== pathname.ino) {
      throw new CloudflaredExecutableError('Cloudflared executable changed during verification.');
    }
    return {
      requestedPath,
      executablePath,
      sha256: digest.digest('hex'),
      bytes: Number(before.size),
    };
  } catch (error) {
    if (error instanceof CloudflaredExecutableError) throw error;
    throw new CloudflaredExecutableError(`Unable to verify cloudflared: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readCloudflaredVersion(
  processManager: ProcessManager,
  executablePath: string,
): Promise<string> {
  const job = await processManager.start({
    executable: executablePath,
    args: ['--version'],
    cwd: path.dirname(executablePath),
    timeoutMs: 5_000,
  });
  const result = await job.wait();
  const output = job.poll(0, 64 * 1024).segments.map((segment) => segment.text).join('').trim();
  if (result.state !== 'completed' || result.exitCode !== 0) {
    throw new CloudflaredExecutableError(
      `Cloudflared version probe failed with state ${result.state} and exit code ${String(result.exitCode)}.`,
    );
  }
  const match = /^cloudflared version ([0-9]{4}\.[0-9]+\.[0-9]+)(?:\s+\(built [^)]+\))?$/.exec(output);
  if (match === null) {
    throw new CloudflaredExecutableError('Cloudflared returned an unrecognized version string.');
  }
  return match[1]!;
}

export async function hashCloudflaredExecutable(executablePath: string): Promise<string> {
  return (await inspectCloudflaredExecutable(executablePath)).sha256;
}

export async function verifyCloudflaredExecutable(
  input: VerifyCloudflaredExecutableInput,
): Promise<VerifiedCloudflaredExecutable> {
  if (!/^[a-fA-F0-9]{64}$/.test(input.expectedSha256)) {
    throw new CloudflaredExecutableError('expectedSha256 must be a 64-character hexadecimal digest.');
  }
  const inspected = await inspectCloudflaredExecutable(input.executablePath);
  if (inspected.sha256 !== input.expectedSha256.toLowerCase()) {
    throw new CloudflaredExecutableError(
      `Cloudflared SHA-256 mismatch at ${inspected.executablePath}.`,
    );
  }
  const version = await readCloudflaredVersion(input.processManager, inspected.executablePath);
  if (version !== input.expectedVersion) {
    throw new CloudflaredExecutableError(
      `Cloudflared version ${version} does not match expected ${input.expectedVersion}.`,
    );
  }
  return { ...inspected, version };
}

function validateRelease(release: CloudflaredRelease): void {
  const url = new URL(release.archiveUrl);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new CloudflaredInstallError('Cloudflared archive URL must use HTTPS without credentials.');
  }
  if (!Number.isSafeInteger(release.archiveBytes)
    || release.archiveBytes <= 0
    || release.archiveBytes > 64 * 1024 * 1024) {
    throw new CloudflaredInstallError('Cloudflared archive size is invalid.');
  }
  if (!/^[a-fA-F0-9]{64}$/.test(release.archiveSha256)
    || !/^[a-fA-F0-9]{64}$/.test(release.executableSha256)) {
    throw new CloudflaredInstallError('Cloudflared release hashes must be SHA-256 digests.');
  }
}

async function downloadCloudflaredArchive(input: {
  release: CloudflaredRelease;
  archivePath: string;
  fetchImpl: typeof fetch;
  maxRedirects: number;
  downloadTimeoutMs: number;
}): Promise<void> {
  let url = new URL(input.release.archiveUrl);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= input.maxRedirects; redirects += 1) {
    response = await input.fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(input.downloadTimeoutMs),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === input.maxRedirects) {
        throw new CloudflaredInstallError('Cloudflared download exceeded the redirect limit.');
      }
      const location = response.headers.get('location');
      if (location === null) {
        throw new CloudflaredInstallError('Cloudflared redirect omitted Location.');
      }
      url = new URL(location, url);
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        throw new CloudflaredInstallError('Cloudflared redirects must remain credential-free HTTPS.');
      }
      continue;
    }
    break;
  }
  if (response === undefined || response.status !== 200 || response.body === null) {
    throw new CloudflaredInstallError(
      `Cloudflared download failed with HTTP ${String(response?.status ?? 'unknown')}.`,
    );
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) !== input.release.archiveBytes) {
    throw new CloudflaredInstallError('Cloudflared archive Content-Length does not match the pinned size.');
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    handle = await open(
      input.archivePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    created = true;
    const digest = createHash('sha256');
    let bytes = 0;
    let offset = 0;
    for await (const chunk of response.body) {
      const data = Buffer.from(chunk);
      bytes += data.byteLength;
      if (bytes > input.release.archiveBytes) {
        throw new CloudflaredInstallError('Cloudflared archive exceeds the pinned size.');
      }
      digest.update(data);
      let written = 0;
      while (written < data.byteLength) {
        const result = await handle.write(
          data,
          written,
          data.byteLength - written,
          offset,
        );
        written += result.bytesWritten;
        offset += result.bytesWritten;
      }
    }
    if (bytes !== input.release.archiveBytes) {
      throw new CloudflaredInstallError('Cloudflared archive size does not match the pinned size.');
    }
    if (digest.digest('hex') !== input.release.archiveSha256.toLowerCase()) {
      throw new CloudflaredInstallError('Cloudflared archive SHA-256 mismatch.');
    }
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    handle = undefined;
    if (created) await rm(input.archivePath, { force: true }).catch(() => undefined);
    if (error instanceof CloudflaredInstallError) throw error;
    throw new CloudflaredInstallError(`Unable to download Cloudflared: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function defaultExtractArchive(
  archivePath: string,
  executablePath: string,
): Promise<void> {
  const listed = await execFileAsync('/usr/bin/tar', ['-tzf', archivePath], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  const entries = listed.stdout.split(/\r?\n/).filter(Boolean);
  if (entries.length !== 1 || !['cloudflared', './cloudflared'].includes(entries[0]!)) {
    throw new CloudflaredInstallError('Cloudflared archive contains an unexpected file layout.');
  }
  await execFileAsync('/usr/bin/tar', ['-xzf', archivePath, '-C', path.dirname(executablePath)], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
}

export async function installCloudflaredRelease(
  options: InstallCloudflaredReleaseOptions,
): Promise<VerifiedCloudflaredExecutable> {
  validateRelease(options.release);
  const installationDirectory = resolveUserPath(options.installationDirectory);
  await ensurePrivateDirectory(installationDirectory);
  const finalPath = path.join(installationDirectory, 'cloudflared');
  try {
    const existing = await lstat(finalPath);
    if (existing.isSymbolicLink() || !existing.isFile() || existing.uid !== currentUserId()) {
      throw new CloudflaredInstallError('Existing Cloudflared installation is unsafe.');
    }
  } catch (error) {
    if (nestedErrorCode(error) !== 'ENOENT') throw error;
  }

  const stagingDirectory = path.join(
    installationDirectory,
    `.install-${randomBytes(12).toString('hex')}`,
  );
  const archivePath = path.join(stagingDirectory, 'cloudflared.tgz');
  const stagedExecutable = path.join(stagingDirectory, 'cloudflared');
  const maxRedirects = options.maxRedirects ?? 5;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    throw new CloudflaredInstallError('maxRedirects must be an integer from 0 to 10.');
  }
  const downloadTimeoutMs = options.downloadTimeoutMs ?? CLOUDFLARED_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isSafeInteger(downloadTimeoutMs)
    || downloadTimeoutMs <= 0
    || downloadTimeoutMs > MAX_DOWNLOAD_TIMEOUT_MS) {
    throw new CloudflaredInstallError(
      `downloadTimeoutMs must be a positive integer no greater than ${MAX_DOWNLOAD_TIMEOUT_MS}.`,
    );
  }

  try {
    await mkdir(stagingDirectory, { mode: 0o700 });
    await downloadCloudflaredArchive({
      release: options.release,
      archivePath,
      fetchImpl: options.fetchImpl ?? fetch,
      maxRedirects,
      downloadTimeoutMs,
    });
    await (options.extractArchive ?? defaultExtractArchive)(archivePath, stagedExecutable);
    await chmod(stagedExecutable, 0o700);
    const verified = await verifyCloudflaredExecutable({
      executablePath: stagedExecutable,
      expectedSha256: options.release.executableSha256,
      expectedVersion: options.release.version,
      processManager: options.processManager,
    });
    const stagedIdentity = await lstat(stagedExecutable, { bigint: true });
    await rename(stagedExecutable, finalPath);
    const finalIdentity = await lstat(finalPath, { bigint: true });
    if (stagedIdentity.dev !== finalIdentity.dev || stagedIdentity.ino !== finalIdentity.ino) {
      throw new CloudflaredInstallError('Cloudflared installation identity changed during promotion.');
    }
    await syncDirectory(installationDirectory);
    return {
      ...verified,
      requestedPath: finalPath,
      executablePath: finalPath,
    };
  } catch (error) {
    if (error instanceof CloudflaredError) throw error;
    throw new CloudflaredInstallError(`Unable to install Cloudflared: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function validateTunnelArgs(args: string[]): void {
  const reserved = [
    '--metrics',
    '--no-autoupdate',
    '--autoupdate-freq',
  ];
  for (const argument of args) {
    if (typeof argument !== 'string' || argument.includes('\0')) {
      throw new CloudflaredLaunchError('Cloudflared arguments must be NUL-free strings.');
    }
    if (argument === 'tunnel'
      || reserved.some((option) => argument === option || argument.startsWith(`${option}=`))) {
      throw new CloudflaredLaunchError(`Caller supplied reserved Cloudflared option: ${argument}`);
    }
  }
}

export async function startCloudflared(options: StartCloudflaredOptions) {
  validateTunnelArgs(options.args);
  const verified = await verifyCloudflaredExecutable(options);
  return options.processManager.start({
    executable: verified.executablePath,
    cwd: options.cwd,
    args: [
      'tunnel',
      '--no-autoupdate',
      '--metrics',
      '127.0.0.1:0',
      ...options.args,
    ],
  });
}

export async function discoverCloudflaredOnPath(
  input: DiscoverCloudflaredOnPathInput,
): Promise<VerifiedCloudflaredExecutable> {
  const pathValue = input.pathValue ?? process.env.PATH ?? '';
  for (const directory of pathValue.split(path.delimiter)) {
    if (directory.length === 0 || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, 'cloudflared');
    try {
      await lstat(candidate);
    } catch (error) {
      if (nestedErrorCode(error) === 'ENOENT') continue;
      throw new CloudflaredExecutableError(
        `Unable to inspect PATH Cloudflared candidate: ${candidate}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
    return verifyCloudflaredExecutable({
      executablePath: candidate,
      expectedSha256: input.expectedSha256,
      expectedVersion: input.expectedVersion,
      processManager: input.processManager,
    });
  }
  throw new CloudflaredExecutableError('Cloudflared was not found on PATH.');
}

export function cloudflaredReleaseFor(architecture: NodeJS.Architecture): CloudflaredRelease {
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new CloudflaredInstallError(`Unsupported Cloudflared architecture: ${architecture}`);
  }
  return { architecture, ...RELEASES[architecture] };
}
