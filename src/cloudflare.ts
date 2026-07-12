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
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { assertNoSymlinkComponents, resolveUserPath } from './paths.js';
import { atomicWriteFile } from './atomic-file.js';
import { AuditLogger } from './audit.js';
import {
  MAX_FILE_BYTES_PER_ROOT,
  NAMED_TUNNEL_BACKOFF_BASE_MS,
  NAMED_TUNNEL_BACKOFF_MAX_MS,
  NAMED_TUNNEL_MAX_RETRIES,
  NAMED_TUNNEL_READY_DEADLINE_MS,
  QUICK_TUNNEL_URL_DEADLINE_MS,
} from './limits.js';
import type { OutputRead } from './output.js';
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

export class NamedTunnelConfigError extends CloudflaredError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NamedTunnelConfigError';
  }
}

export class NamedTunnelAuthError extends CloudflaredError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NamedTunnelAuthError';
  }
}

export class NamedTunnelStartupError extends CloudflaredError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NamedTunnelStartupError';
  }
}

class NamedTunnelTransientError extends NamedTunnelStartupError {
  readonly timedOut: boolean;

  constructor(message: string, options?: ErrorOptions & { timedOut?: boolean }) {
    super(message, options);
    this.name = 'NamedTunnelTransientError';
    this.timedOut = options?.timedOut ?? false;
  }
}

class NamedTunnelStoppedError extends NamedTunnelStartupError {
  constructor() {
    super('Named Tunnel stopped during startup.');
    this.name = 'NamedTunnelStoppedError';
  }
}

export class QuickTunnelConfigError extends CloudflaredError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'QuickTunnelConfigError';
  }
}

export class QuickTunnelStartupError extends CloudflaredError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'QuickTunnelStartupError';
  }
}

export class QuickTunnelUnsafeUrlError extends QuickTunnelStartupError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'QuickTunnelUnsafeUrlError';
  }
}

class QuickTunnelTransientError extends QuickTunnelStartupError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'QuickTunnelTransientError';
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

export interface ValidateNamedTunnelConfigurationInput {
  tunnelName: string;
  hostname: string;
  originCertFile: string;
  credentialsFile: string;
}

export interface ValidatedNamedTunnelConfiguration {
  tunnelName: string;
  tunnelId: string;
  hostname: string;
  publicOrigin: string;
  publicEndpoint: string;
  originCertFile: string;
  credentialsFile: string;
}

export interface NamedTunnelReadyResult {
  mode: 'named';
  tunnelName: string;
  tunnelId: string;
  hostname: string;
  publicOrigin: string;
  publicEndpoint: string;
  production: true;
  retryCount: number;
}

export interface NamedTunnelStatus {
  mode: 'named';
  ready: boolean;
  starting: boolean;
  stopping: boolean;
  tunnelName: string;
  tunnelId: string | null;
  hostname: string;
  publicOrigin: string | null;
  publicEndpoint: string | null;
  production: boolean;
  retryCount: number;
}

export interface QuickTunnelProcess {
  poll(cursor: number, maximumBytes?: number): OutputRead;
  cancel(): Promise<unknown>;
}

export interface QuickTunnelReadyResult {
  mode: 'quick';
  publicOrigin: string;
  publicEndpoint: string;
  production: false;
  recreationCount: number;
}

export interface QuickTunnelStatus {
  mode: 'quick';
  ready: boolean;
  starting: boolean;
  stopping: boolean;
  publicOrigin: string | null;
  publicEndpoint: string | null;
  production: false;
  recreationCount: number;
}

export interface NamedTunnelManagerOptions extends VerifyCloudflaredExecutableInput {
  audit: AuditLogger;
  localOrigin: string;
  tunnelName: string;
  hostname: string;
  credentialsFile: string;
  originCertFile?: string;
  cwd: string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  startProcess?: (args: string[]) => Promise<QuickTunnelProcess>;
}

export interface QuickTunnelManagerOptions extends VerifyCloudflaredExecutableInput {
  audit: AuditLogger;
  localOrigin: string;
  cwd: string;
  configDirectory?: string;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  startProcess?: (args: string[]) => Promise<QuickTunnelProcess>;
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

async function readNamedTunnelAuthFile(
  inputPath: string,
  label: string,
): Promise<{ filePath: string; bytes: Buffer }> {
  let filePath: string;
  try {
    filePath = resolveUserPath(inputPath);
    await assertNoSymlinkComponents(filePath);
  } catch (error) {
    throw new NamedTunnelConfigError(
      `Unable to resolve named tunnel ${label}: ${String(error)}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const discovered = await lstat(filePath, { bigint: true });
    if (discovered.isSymbolicLink() || !discovered.isFile()) {
      throw new NamedTunnelConfigError(`Named tunnel ${label} must be a regular file.`);
    }
    if (discovered.uid !== BigInt(currentUserId())) {
      throw new NamedTunnelConfigError(`Named tunnel ${label} is not owned by the current user.`);
    }
    const rawMode = Number(discovered.mode);
    const mode = rawMode & 0o777;
    if ((rawMode & 0o7000) !== 0
      || (mode & 0o077) !== 0
      || (mode & 0o400) === 0
      || (mode & 0o111) !== 0) {
      throw new NamedTunnelConfigError(
        `Named tunnel ${label} must be private, owner-readable, and non-executable.`,
      );
    }
    if (discovered.size <= 0n || discovered.size > BigInt(MAX_FILE_BYTES_PER_ROOT)) {
      throw new NamedTunnelConfigError(`Named tunnel ${label} has an invalid size.`);
    }

    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== discovered.dev || before.ino !== discovered.ino) {
      throw new NamedTunnelConfigError(`Named tunnel ${label} changed before validation.`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    await assertNoSymlinkComponents(filePath);
    const pathname = await lstat(filePath, { bigint: true });
    if (!pathname.isFile()
      || !sameIdentity(before, after)
      || before.dev !== pathname.dev
      || before.ino !== pathname.ino) {
      throw new NamedTunnelConfigError(`Named tunnel ${label} changed during validation.`);
    }
    return { filePath, bytes };
  } catch (error) {
    if (error instanceof NamedTunnelConfigError) throw error;
    throw new NamedTunnelConfigError(`Unable to validate named tunnel ${label}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function decodeStrictBase64(value: string, label: string): Buffer {
  const normalized = value.replace(/\s+/g, '');
  if (normalized.length === 0
    || normalized.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new NamedTunnelConfigError(`${label} is not valid base64.`);
  }
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.toString('base64') !== normalized) {
    throw new NamedTunnelConfigError(`${label} is not canonical base64.`);
  }
  return decoded;
}

function parseOriginCertificate(bytes: Buffer): { accountId: string } {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new NamedTunnelConfigError('Named tunnel origin certificate must be UTF-8 PEM.');
  }
  const blockPattern = /-----BEGIN ([A-Z0-9 ]+)-----\r?\n([\s\S]*?)-----END \1-----/g;
  let cursor = 0;
  let tokenPayload: Buffer | undefined;
  for (const match of text.matchAll(blockPattern)) {
    const index = match.index ?? 0;
    if (text.slice(cursor, index).trim() !== '') {
      throw new NamedTunnelConfigError('Named tunnel origin certificate contains invalid PEM data.');
    }
    cursor = index + match[0].length;
    const blockType = match[1]!;
    if (blockType === 'ARGO TUNNEL TOKEN') {
      if (tokenPayload !== undefined) {
        throw new NamedTunnelConfigError('Named tunnel origin certificate contains multiple tokens.');
      }
      tokenPayload = decodeStrictBase64(match[2]!, 'Origin certificate token');
    } else if (blockType !== 'PRIVATE KEY' && blockType !== 'CERTIFICATE') {
      throw new NamedTunnelConfigError(
        `Named tunnel origin certificate contains unsupported PEM block ${blockType}.`,
      );
    }
  }
  if (text.slice(cursor).trim() !== '' || tokenPayload === undefined) {
    throw new NamedTunnelConfigError('Named tunnel origin certificate is missing its tunnel token.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(tokenPayload.toString('utf8'));
  } catch (error) {
    throw new NamedTunnelConfigError('Named tunnel origin certificate token is invalid JSON.', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NamedTunnelConfigError('Named tunnel origin certificate token must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  for (const key of ['zoneID', 'accountID', 'apiToken'] as const) {
    if (typeof record[key] !== 'string' || record[key].trim() === '') {
      throw new NamedTunnelConfigError(`Named tunnel origin certificate is missing ${key}.`);
    }
  }
  if (record.endpoint !== undefined && typeof record.endpoint !== 'string') {
    throw new NamedTunnelConfigError('Named tunnel origin certificate endpoint must be a string.');
  }
  return { accountId: record.accountID as string };
}

function validateNamedTunnelName(value: string): string {
  if (value.length === 0
    || value.length > 128
    || value !== value.trim()
    || value.startsWith('-')
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new NamedTunnelConfigError('Named tunnel name is invalid.');
  }
  return value;
}

function validateNamedTunnelHostname(value: string): string {
  const hostname = value.toLowerCase();
  const pattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (!pattern.test(hostname)
    || hostname === 'trycloudflare.com'
    || hostname.endsWith('.trycloudflare.com')) {
    throw new NamedTunnelConfigError('Named tunnel hostname must be a stable public DNS hostname.');
  }
  return hostname;
}

function parseNamedTunnelCredentials(
  bytes: Buffer,
  certificateAccountId: string,
  credentialsFile: string,
): { tunnelId: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new NamedTunnelConfigError('Named tunnel credentials are invalid JSON.', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new NamedTunnelConfigError('Named tunnel credentials must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  const requiredKeys = ['AccountTag', 'TunnelID', 'TunnelSecret'];
  const allowedKeys = new Set([...requiredKeys, 'Endpoint']);
  const actualKeys = Object.keys(record);
  if (requiredKeys.some((key) => !(key in record))
    || actualKeys.some((key) => !allowedKeys.has(key))) {
    throw new NamedTunnelConfigError('Named tunnel credentials have an unexpected schema.');
  }
  if (record.Endpoint !== undefined && typeof record.Endpoint !== 'string') {
    throw new NamedTunnelConfigError('Named tunnel credentials contain an invalid Endpoint.');
  }
  if (typeof record.AccountTag !== 'string' || record.AccountTag.trim() === '') {
    throw new NamedTunnelConfigError('Named tunnel credentials are missing AccountTag.');
  }
  if (record.AccountTag !== certificateAccountId) {
    throw new NamedTunnelConfigError(
      'Named tunnel credentials do not match the origin certificate account.',
    );
  }
  if (typeof record.TunnelID !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(record.TunnelID)) {
    throw new NamedTunnelConfigError('Named tunnel credentials contain an invalid TunnelID.');
  }
  const tunnelId = record.TunnelID.toLowerCase();
  if (path.basename(credentialsFile).toLowerCase() !== `${tunnelId}.json`) {
    throw new NamedTunnelConfigError(
      'Named tunnel credentials filename does not match TunnelID.',
    );
  }
  if (typeof record.TunnelSecret !== 'string'
    || decodeStrictBase64(record.TunnelSecret, 'TunnelSecret').byteLength !== 32) {
    throw new NamedTunnelConfigError('Named tunnel credentials contain an invalid TunnelSecret.');
  }
  return { tunnelId };
}

export async function validateNamedTunnelConfiguration(
  input: ValidateNamedTunnelConfigurationInput,
): Promise<ValidatedNamedTunnelConfiguration> {
  const tunnelName = validateNamedTunnelName(input.tunnelName);
  const hostname = validateNamedTunnelHostname(input.hostname);
  const originCert = await readNamedTunnelAuthFile(input.originCertFile, 'origin certificate');
  const credentials = await readNamedTunnelAuthFile(input.credentialsFile, 'credentials file');
  const certificate = parseOriginCertificate(originCert.bytes);
  const parsedCredentials = parseNamedTunnelCredentials(
    credentials.bytes,
    certificate.accountId,
    credentials.filePath,
  );
  const publicOrigin = `https://${hostname}`;
  return {
    tunnelName,
    tunnelId: parsedCredentials.tunnelId,
    hostname,
    publicOrigin,
    publicEndpoint: `${publicOrigin}/mcp`,
    originCertFile: originCert.filePath,
    credentialsFile: credentials.filePath,
  };
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


const QUICK_TUNNEL_ORIGIN_PATTERN = /(?:^|\s)(https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.trycloudflare\.com)(?=\s|$)/i;

export function quickTunnelOriginFromOutput(output: string): string | null {
  const match = QUICK_TUNNEL_ORIGIN_PATTERN.exec(output);
  return match === null ? null : match[1]!.toLowerCase();
}

export async function assertQuickTunnelConfigCompatible(
  inputDirectory = path.join(homedir(), '.cloudflared'),
): Promise<void> {
  const configDirectory = resolveUserPath(inputDirectory);
  try {
    await assertNoSymlinkComponents(path.dirname(configDirectory));
    let directoryStats;
    try {
      directoryStats = await lstat(configDirectory);
    } catch (error) {
      if (nestedErrorCode(error) === 'ENOENT') return;
      throw error;
    }
    if (directoryStats.isSymbolicLink()
      || !directoryStats.isDirectory()
      || directoryStats.uid !== currentUserId()) {
      throw new QuickTunnelConfigError(
        `Unsafe Cloudflared config directory: ${configDirectory}`,
      );
    }
    await assertNoSymlinkComponents(configDirectory);

    for (const filename of ['config.yaml', 'config.yml']) {
      const candidate = path.join(configDirectory, filename);
      try {
        await lstat(candidate);
      } catch (error) {
        if (nestedErrorCode(error) === 'ENOENT') continue;
        throw error;
      }
      throw new QuickTunnelConfigError(
        `Quick Tunnel is disabled while Cloudflared config exists: ${candidate}`,
      );
    }
  } catch (error) {
    if (error instanceof QuickTunnelConfigError) throw error;
    throw new QuickTunnelConfigError(`Unable to validate Quick Tunnel config: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
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
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(new CloudflaredInstallError('Cloudflared download timeout.')),
      input.downloadTimeoutMs,
    );
    try {
      response = await input.fetchImpl(url, {
        redirect: 'manual',
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
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


const TUNNEL_REGISTERED_PATTERN = /(?:registered tunnel connection|tunnel connection[^\n]*registered)/i;
const TUNNEL_POLL_BYTES = 64 * 1024;
const TUNNEL_MAX_LOG_BYTES = 256 * 1024;
const TUNNEL_DEFAULT_POLL_MS = 25;

function appendBoundedTunnelLog(current: string, next: string): string {
  const combined = `${current}${next}`;
  const bytes = Buffer.from(combined);
  if (bytes.byteLength <= TUNNEL_MAX_LOG_BYTES) return combined;
  return bytes.subarray(bytes.byteLength - TUNNEL_MAX_LOG_BYTES).toString('utf8');
}

function validateQuickLocalOrigin(value: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch (error) {
    throw new QuickTunnelStartupError('Quick Tunnel local origin is invalid.', {
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
    || value !== origin.origin) {
    throw new QuickTunnelStartupError(
      'Quick Tunnel local origin must be a bare HTTP loopback origin with an explicit port.',
    );
  }
  return origin.origin;
}

const NAMED_TUNNEL_AUTH_FAILURE_PATTERN = /(?:authentication failed|unauthorized|invalid tunnel secret|failed to find[^\n]*origin cert|cannot determine default origin certificate|client didn't specify origincert|origin certificate[^\n]*(?:invalid|missing))/i;
const NAMED_TUNNEL_CONFIG_FAILURE_PATTERN = /(?:error parsing tunnel id|tunnel[^\n]*(?:not found|does not exist)|credentials(?: file)?[^\n]*(?:not found|invalid|failed to (?:parse|read|load))|unknown flag|requires the id or name|invalid[^\n]*url|(?:failed|unable) to (?:load|read|parse)(?: the)? configuration|configuration (?:error|invalid)|error parsing config)/i;

function validateNamedLocalOrigin(value: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch (error) {
    throw new NamedTunnelConfigError('Named Tunnel local origin is invalid.', {
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
    || value !== origin.origin) {
    throw new NamedTunnelConfigError(
      'Named Tunnel local origin must be a bare HTTP loopback origin with an explicit port.',
    );
  }
  return origin.origin;
}

function namedTunnelBackoffMs(retryNumber: number): number {
  return Math.min(
    NAMED_TUNNEL_BACKOFF_BASE_MS * (2 ** (retryNumber - 1)),
    NAMED_TUNNEL_BACKOFF_MAX_MS,
  );
}

function classifyNamedTunnelOutput(output: string): CloudflaredError | null {
  if (NAMED_TUNNEL_AUTH_FAILURE_PATTERN.test(output)) {
    return new NamedTunnelAuthError('Cloudflared reported a named-tunnel authentication failure.');
  }
  if (NAMED_TUNNEL_CONFIG_FAILURE_PATTERN.test(output)) {
    return new NamedTunnelConfigError('Cloudflared reported a named-tunnel configuration failure.');
  }
  return null;
}

function classifyNamedTunnelStartError(error: unknown): CloudflaredError {
  if (error instanceof CloudflaredError) {
    return error;
  }
  const code = nestedErrorCode(error);
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'EINVAL') {
    return new NamedTunnelConfigError('Cloudflared could not start with the named-tunnel configuration.', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  return new NamedTunnelTransientError('Cloudflared process failed to start transiently.', {
    cause: error instanceof Error ? error : undefined,
  });
}

export class NamedTunnelManager {
  private readonly audit: AuditLogger;
  private readonly localOrigin: string;
  private readonly tunnelName: string;
  private readonly hostname: string;
  private readonly originCertFile: string;
  private readonly credentialsFile: string;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly startProcess: (args: string[]) => Promise<QuickTunnelProcess>;
  private activeProcess: QuickTunnelProcess | undefined;
  private readyResult: NamedTunnelReadyResult | undefined;
  private startPromise: Promise<NamedTunnelReadyResult> | undefined;
  private stopPromise: Promise<void> | undefined;
  private lifecycleVersion = 0;
  private startAbortController: AbortController | undefined;

  constructor(options: NamedTunnelManagerOptions) {
    this.audit = options.audit;
    this.localOrigin = validateNamedLocalOrigin(options.localOrigin);
    this.tunnelName = validateNamedTunnelName(options.tunnelName);
    this.hostname = validateNamedTunnelHostname(options.hostname);
    this.originCertFile = options.originCertFile ?? path.join(homedir(), '.cloudflared', 'cert.pem');
    this.credentialsFile = options.credentialsFile;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
    this.pollIntervalMs = options.pollIntervalMs ?? TUNNEL_DEFAULT_POLL_MS;
    if (!Number.isSafeInteger(this.pollIntervalMs)
      || this.pollIntervalMs <= 0
      || this.pollIntervalMs > 1_000) {
      throw new NamedTunnelConfigError('pollIntervalMs must be an integer from 1 to 1000.');
    }
    this.startProcess = options.startProcess ?? ((args) => startCloudflared({
      processManager: options.processManager,
      executablePath: options.executablePath,
      expectedSha256: options.expectedSha256,
      expectedVersion: options.expectedVersion,
      cwd: options.cwd,
      args,
    }));
  }

  get status(): NamedTunnelStatus {
    return {
      mode: 'named',
      ready: this.readyResult !== undefined,
      starting: this.startPromise !== undefined,
      stopping: this.stopPromise !== undefined,
      tunnelName: this.tunnelName,
      tunnelId: this.readyResult?.tunnelId ?? null,
      hostname: this.hostname,
      publicOrigin: this.readyResult?.publicOrigin ?? null,
      publicEndpoint: this.readyResult?.publicEndpoint ?? null,
      production: this.readyResult !== undefined,
      retryCount: this.readyResult?.retryCount ?? 0,
    };
  }

  start(): Promise<NamedTunnelReadyResult> {
    if (this.readyResult !== undefined) return Promise.resolve({ ...this.readyResult });
    if (this.startPromise !== undefined) return this.startPromise;
    if (this.stopPromise !== undefined) {
      return Promise.reject(new NamedTunnelStartupError('Named Tunnel is stopping.'));
    }
    if (this.activeProcess !== undefined) {
      return Promise.reject(new NamedTunnelStartupError(
        'Named Tunnel has an uncleaned named-tunnel process; stop must succeed before restart.',
      ));
    }
    const lifecycleVersion = this.lifecycleVersion;
    const abortController = new AbortController();
    this.startAbortController = abortController;
    this.startPromise = this.startInternal(lifecycleVersion, abortController.signal).finally(() => {
      if (this.startAbortController === abortController) this.startAbortController = undefined;
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.lifecycleVersion += 1;
    this.startAbortController?.abort();
    this.stopPromise = (async () => {
      const process = this.activeProcess;
      if (process !== undefined) {
        await process.cancel();
        if (this.activeProcess === process) this.activeProcess = undefined;
      }
      this.readyResult = undefined;
    })().finally(() => {
      this.stopPromise = undefined;
    });
    return this.stopPromise;
  }

  private async cleanAttempt(process: QuickTunnelProcess): Promise<void> {
    try {
      await process.cancel();
    } catch (error) {
      throw new NamedTunnelStartupError('Unable to clean up named-tunnel process before retry.', {
        cause: error instanceof Error ? error : undefined,
      });
    }
    if (this.activeProcess === process) this.activeProcess = undefined;
  }

  private async validateConfiguration(): Promise<ValidatedNamedTunnelConfiguration> {
    return validateNamedTunnelConfiguration({
      tunnelName: this.tunnelName,
      hostname: this.hostname,
      originCertFile: this.originCertFile,
      credentialsFile: this.credentialsFile,
    });
  }

  private assertStartActive(lifecycleVersion: number): void {
    if (lifecycleVersion !== this.lifecycleVersion) {
      throw new NamedTunnelStoppedError();
    }
  }

  private async sleepWhileActive(
    milliseconds: number,
    lifecycleVersion: number,
    signal: AbortSignal,
  ): Promise<void> {
    this.assertStartActive(lifecycleVersion);
    if (signal.aborted) throw new NamedTunnelStoppedError();
    let resolveAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      resolveAbort = resolve;
      signal.addEventListener('abort', resolveAbort, { once: true });
    });
    try {
      await Promise.race([this.sleep(milliseconds), aborted]);
    } finally {
      signal.removeEventListener('abort', resolveAbort);
    }
    this.assertStartActive(lifecycleVersion);
  }

  private async startInternal(
    lifecycleVersion: number,
    signal: AbortSignal,
  ): Promise<NamedTunnelReadyResult> {
    await this.validateConfiguration();
    this.assertStartActive(lifecycleVersion);
    const receipt = await this.audit.recordMutationStart('tunnel.named.start', {
      mode: 'named',
      retryLimit: NAMED_TUNNEL_MAX_RETRIES,
    });
    let finishStatus: 'ok' | 'error' | 'timed-out' | 'cancelled' = 'error';
    try {
      this.assertStartActive(lifecycleVersion);
      for (let retryCount = 0; retryCount <= NAMED_TUNNEL_MAX_RETRIES; retryCount += 1) {
        this.assertStartActive(lifecycleVersion);
        const validated = await this.validateConfiguration();
        this.assertStartActive(lifecycleVersion);
        const args = [
          '--origincert',
          validated.originCertFile,
          'run',
          '--url',
          this.localOrigin,
          '--credentials-file',
          validated.credentialsFile,
          validated.tunnelName,
        ];
        let process: QuickTunnelProcess;
        try {
          process = await this.startProcess(args);
          if (lifecycleVersion !== this.lifecycleVersion) {
            await this.cleanAttempt(process);
            this.assertStartActive(lifecycleVersion);
          }
        } catch (error) {
          this.assertStartActive(lifecycleVersion);
          if (error instanceof NamedTunnelStoppedError) throw error;
          const classified = classifyNamedTunnelStartError(error);
          if (!(classified instanceof NamedTunnelTransientError)
            || retryCount === NAMED_TUNNEL_MAX_RETRIES) {
            throw classified;
          }
          await this.sleepWhileActive(
            namedTunnelBackoffMs(retryCount + 1),
            lifecycleVersion,
            signal,
          );
          continue;
        }

        this.activeProcess = process;
        try {
          const ready = await this.waitForReady(
            process,
            validated,
            retryCount,
            lifecycleVersion,
            signal,
          );
          this.assertStartActive(lifecycleVersion);
          this.readyResult = ready;
          finishStatus = 'ok';
          return { ...ready };
        } catch (error) {
          if (error instanceof NamedTunnelStoppedError && this.stopPromise !== undefined) {
            await this.stopPromise;
          }
          if (this.activeProcess === process) {
            await this.cleanAttempt(process);
          }
          if (error instanceof NamedTunnelStoppedError) throw error;
          if (!(error instanceof NamedTunnelTransientError)
            || retryCount === NAMED_TUNNEL_MAX_RETRIES) {
            if (error instanceof NamedTunnelTransientError && error.timedOut) {
              finishStatus = 'timed-out';
            }
            throw error;
          }
          await this.sleepWhileActive(
            namedTunnelBackoffMs(retryCount + 1),
            lifecycleVersion,
            signal,
          );
        }
      }
      throw new NamedTunnelStartupError('Named Tunnel exhausted its retry limit.');
    } catch (error) {
      if (error instanceof NamedTunnelStoppedError) finishStatus = 'cancelled';
      throw error;
    } finally {
      await this.audit.recordFinish(receipt, finishStatus);
    }
  }

  private async waitForReady(
    process: QuickTunnelProcess,
    validated: ValidatedNamedTunnelConfiguration,
    retryCount: number,
    lifecycleVersion: number,
    signal: AbortSignal,
  ): Promise<NamedTunnelReadyResult> {
    const deadline = this.now() + NAMED_TUNNEL_READY_DEADLINE_MS;
    let cursor = 0;
    let startupLog = '';

    while (this.now() < deadline) {
      this.assertStartActive(lifecycleVersion);
      const polled = process.poll(cursor, TUNNEL_POLL_BYTES);
      if (polled.requestedCursor !== cursor || polled.gap) {
        throw new NamedTunnelStartupError('Named Tunnel output cursor became inconsistent.');
      }
      cursor = polled.nextCursor;
      const chunk = polled.segments.map((segment) => segment.text).join('');
      startupLog = appendBoundedTunnelLog(startupLog, chunk);
      const classified = classifyNamedTunnelOutput(startupLog);
      if (classified !== null) throw classified;

      if (TUNNEL_REGISTERED_PATTERN.test(startupLog)) {
        this.assertStartActive(lifecycleVersion);
        return {
          mode: 'named',
          tunnelName: validated.tunnelName,
          tunnelId: validated.tunnelId,
          hostname: validated.hostname,
          publicOrigin: validated.publicOrigin,
          publicEndpoint: validated.publicEndpoint,
          production: true,
          retryCount,
        };
      }
      if (polled.state !== 'running') {
        throw new NamedTunnelTransientError(
          `Cloudflared exited before Named Tunnel readiness with state ${polled.state}.`,
        );
      }
      const remaining = deadline - this.now();
      if (remaining <= 0) break;
      await this.sleepWhileActive(
        Math.min(this.pollIntervalMs, remaining),
        lifecycleVersion,
        signal,
      );
    }
    this.assertStartActive(lifecycleVersion);
    throw new NamedTunnelTransientError(
      `Named Tunnel did not become ready within ${NAMED_TUNNEL_READY_DEADLINE_MS} ms.`,
      { timedOut: true },
    );
  }
}

export class QuickTunnelManager {
  private readonly audit: AuditLogger;
  private readonly localOrigin: string;
  private readonly configDirectory: string;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly startProcess: (args: string[]) => Promise<QuickTunnelProcess>;
  private activeProcess: QuickTunnelProcess | undefined;
  private readyResult: QuickTunnelReadyResult | undefined;
  private startPromise: Promise<QuickTunnelReadyResult> | undefined;
  private stopPromise: Promise<void> | undefined;

  constructor(options: QuickTunnelManagerOptions) {
    this.audit = options.audit;
    this.localOrigin = validateQuickLocalOrigin(options.localOrigin);
    this.configDirectory = options.configDirectory ?? path.join(homedir(), '.cloudflared');
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
    this.pollIntervalMs = options.pollIntervalMs ?? TUNNEL_DEFAULT_POLL_MS;
    if (!Number.isSafeInteger(this.pollIntervalMs)
      || this.pollIntervalMs <= 0
      || this.pollIntervalMs > 1_000) {
      throw new QuickTunnelStartupError('pollIntervalMs must be an integer from 1 to 1000.');
    }
    this.startProcess = options.startProcess ?? ((args) => startCloudflared({
      processManager: options.processManager,
      executablePath: options.executablePath,
      expectedSha256: options.expectedSha256,
      expectedVersion: options.expectedVersion,
      cwd: options.cwd,
      args,
    }));
  }

  get status(): QuickTunnelStatus {
    return {
      mode: 'quick',
      ready: this.readyResult !== undefined,
      starting: this.startPromise !== undefined,
      stopping: this.stopPromise !== undefined,
      publicOrigin: this.readyResult?.publicOrigin ?? null,
      publicEndpoint: this.readyResult?.publicEndpoint ?? null,
      production: false,
      recreationCount: this.readyResult?.recreationCount ?? 0,
    };
  }

  start(): Promise<QuickTunnelReadyResult> {
    if (this.readyResult !== undefined) return Promise.resolve({ ...this.readyResult });
    if (this.startPromise !== undefined) return this.startPromise;
    if (this.stopPromise !== undefined) {
      return Promise.reject(new QuickTunnelStartupError('Quick Tunnel is stopping.'));
    }
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  stop(): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.stopPromise = (async () => {
      const process = this.activeProcess;
      this.activeProcess = undefined;
      this.readyResult = undefined;
      await process?.cancel();
    })().finally(() => {
      this.stopPromise = undefined;
    });
    return this.stopPromise;
  }

  private async startInternal(): Promise<QuickTunnelReadyResult> {
    await assertQuickTunnelConfigCompatible(this.configDirectory);
    const receipt = await this.audit.recordMutationStart('tunnel.quick.start', {
      mode: 'quick',
      recreationLimit: 1,
    });
    let finishStatus: 'ok' | 'error' | 'timed-out' = 'error';
    try {
      for (let recreationCount = 0; recreationCount <= 1; recreationCount += 1) {
        let process: QuickTunnelProcess;
        try {
          process = await this.startProcess(['--url', this.localOrigin]);
        } catch (error) {
          const transient = new QuickTunnelTransientError(
            `Cloudflared process failed to start: ${String(error)}`,
            { cause: error instanceof Error ? error : undefined },
          );
          if (recreationCount === 0) continue;
          throw transient;
        }
        this.activeProcess = process;
        try {
          const ready = await this.waitForReady(process, recreationCount);
          this.readyResult = ready;
          finishStatus = 'ok';
          return { ...ready };
        } catch (error) {
          await process.cancel().catch(() => undefined);
          if (this.activeProcess === process) this.activeProcess = undefined;
          if (error instanceof QuickTunnelUnsafeUrlError) throw error;
          if (!(error instanceof QuickTunnelTransientError) || recreationCount === 1) throw error;
        }
      }
      throw new QuickTunnelStartupError('Quick Tunnel exhausted its recreation limit.');
    } catch (error) {
      if (error instanceof QuickTunnelTransientError
        && error.message.includes(String(QUICK_TUNNEL_URL_DEADLINE_MS))) {
        finishStatus = 'timed-out';
      }
      throw error;
    } finally {
      await this.audit.recordFinish(receipt, finishStatus);
    }
  }

  private async waitForReady(
    process: QuickTunnelProcess,
    recreationCount: number,
  ): Promise<QuickTunnelReadyResult> {
    const deadline = this.now() + QUICK_TUNNEL_URL_DEADLINE_MS;
    let cursor = 0;
    let startupLog = '';
    let origin: string | null = null;
    let registered = false;

    while (this.now() < deadline) {
      const polled = process.poll(cursor, TUNNEL_POLL_BYTES);
      if (polled.requestedCursor !== cursor || polled.gap) {
        throw new QuickTunnelStartupError('Quick Tunnel output cursor became inconsistent.');
      }
      cursor = polled.nextCursor;
      const chunk = polled.segments.map((segment) => segment.text).join('');
      startupLog = appendBoundedTunnelLog(startupLog, chunk);
      origin ??= quickTunnelOriginFromOutput(startupLog);
      registered ||= TUNNEL_REGISTERED_PATTERN.test(startupLog);

      if (origin === null
        && /trycloudflare\.com/i.test(startupLog)
        && /https:\/\//i.test(startupLog)) {
        throw new QuickTunnelUnsafeUrlError('Cloudflared emitted an unsafe Quick Tunnel URL.');
      }
      if (origin !== null && registered) {
        return {
          mode: 'quick',
          publicOrigin: origin,
          publicEndpoint: `${origin}/mcp`,
          production: false,
          recreationCount,
        };
      }
      if (polled.state !== 'running') {
        throw new QuickTunnelTransientError(
          `Cloudflared exited before Quick Tunnel readiness with state ${polled.state}.`,
        );
      }
      const remaining = deadline - this.now();
      if (remaining <= 0) break;
      await this.sleep(Math.min(this.pollIntervalMs, remaining));
    }
    throw new QuickTunnelTransientError(
      `Quick Tunnel did not become ready within ${QUICK_TUNNEL_URL_DEADLINE_MS} ms.`,
    );
  }
}

function validateTunnelArgs(args: string[]): void {
  const reserved = [
    '--config',
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
  const clientConfigPath = path.join(options.cwd, 'cloudflared-client.yml');
  await atomicWriteFile(clientConfigPath, 'no-autoupdate: true\n', { createParents: true });
  return options.processManager.start({
    executable: verified.executablePath,
    cwd: options.cwd,
    args: [
      '--config',
      clientConfigPath,
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
