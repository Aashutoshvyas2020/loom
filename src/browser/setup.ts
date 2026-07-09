import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import { atomicWriteFile } from '../atomic-file.js';
import { BrowserExecutableError, BrowserNotReadyError } from '../browser.js';
import { PathPolicyError, assertNoSymlinkComponents, resolveUserPath } from '../paths.js';
import { ProcessManager } from '../process-manager.js';

const execFileAsync = promisify(execFile);
const moduleRequire = createRequire(import.meta.url);
export const PINNED_PLAYWRIGHT_VERSION = '1.61.1';
export const PINNED_CHROMIUM_REVISION = '1228';
export const PINNED_CHROMIUM_VERSION = '149.0.7827.55';

type SupportedArchitecture = 'arm64' | 'x64';
interface ArchitectureDescriptor {
  architecture: SupportedArchitecture;
  archiveUrl: string;
  archiveSha256: string;
  executableSha256: string;
  browserDirectory: string;
}

const ARCHITECTURES: Readonly<Record<SupportedArchitecture, Omit<ArchitectureDescriptor, 'architecture'>>> = {
  arm64: {
    archiveUrl: 'https://cdn.playwright.dev/builds/cft/149.0.7827.55/mac-arm64/chrome-mac-arm64.zip',
    archiveSha256: '311211b54c429245e2cec0314ee1e314085e9c00350215b95e1a879350786630',
    executableSha256: 'b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7',
    browserDirectory: 'chrome-mac-arm64',
  },
  x64: {
    archiveUrl: 'https://cdn.playwright.dev/builds/cft/149.0.7827.55/mac-x64/chrome-mac-x64.zip',
    archiveSha256: '4fff3b1bff4ab5acab495438d501fd56ecd326fc2e18670858930386dca864e6',
    executableSha256: '67b852c3608e6a38dd2287f4c713205795a857cd7e9e699eb680811b4ab10675',
    browserDirectory: 'chrome-mac-x64',
  },
};

export interface ChromiumInstallManifest {
  schemaVersion: 1;
  playwrightVersion: string;
  chromiumRevision: string;
  chromiumVersion: string;
  architecture: SupportedArchitecture;
  archiveUrl: string;
  archiveSha256: string;
  executablePath: string;
  executableSha256: string;
  installedAt: string;
}

export interface VerifiedChromiumExecutable {
  executablePath: string;
  sha256: string;
  bytes: number;
}

export interface InstallPinnedChromiumOptions {
  installationDirectory: string;
  playwrightCliPath?: string;
  architecture?: NodeJS.Architecture;
  now?: () => Date;
  runInstaller?: (input: { executable: string; args: string[]; env: NodeJS.ProcessEnv }) => Promise<void>;
  verifyExecutable?: typeof verifyChromiumExecutable;
  verifyLaunch?: (executablePath: string, profileDirectory: string) => Promise<void>;
}

interface FileIdentity { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }

function currentUserId(): number {
  if (process.getuid === undefined) throw new BrowserExecutableError('Browser ownership checks require POSIX.');
  return process.getuid();
}

function descriptorFor(architecture: NodeJS.Architecture): ArchitectureDescriptor {
  if (architecture !== 'arm64' && architecture !== 'x64') {
    throw new BrowserExecutableError(`Unsupported Chromium architecture: ${architecture}`);
  }
  return { architecture, ...ARCHITECTURES[architecture] };
}

export function pinnedChromiumExecutableSha256For(
  architecture: NodeJS.Architecture,
): string {
  return descriptorFor(architecture).executableSha256;
}

function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

async function inspectChromiumExecutable(inputPath: string): Promise<VerifiedChromiumExecutable> {
  let executablePath: string;
  try {
    const requestedPath = resolveUserPath(inputPath);
    await assertNoSymlinkComponents(requestedPath);
    executablePath = await realpath(requestedPath);
    await assertNoSymlinkComponents(executablePath);
  } catch (error) {
    throw new BrowserExecutableError(error instanceof Error ? error.message : String(error), {
      cause: error instanceof Error ? error : undefined,
    });
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const discovered = await lstat(executablePath, { bigint: true });
    if (discovered.isSymbolicLink() || !discovered.isFile()) throw new BrowserExecutableError('Chromium executable must be a regular file.');
    if (discovered.uid !== BigInt(currentUserId())) throw new BrowserExecutableError('Chromium executable is not owned by the current user.');
    if ((Number(discovered.mode) & 0o111) === 0) throw new BrowserExecutableError('Chromium executable is not executable.');
    handle = await open(executablePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== discovered.dev || before.ino !== discovered.ino) throw new BrowserExecutableError('Chromium executable changed before verification.');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
    const after = await handle.stat({ bigint: true });
    await assertNoSymlinkComponents(executablePath);
    const pathname = await lstat(executablePath, { bigint: true });
    if (!pathname.isFile() || !sameIdentity(before, after) || before.dev !== pathname.dev || before.ino !== pathname.ino) {
      throw new BrowserExecutableError('Chromium executable changed during verification.');
    }
    return { executablePath, sha256: hash.digest('hex'), bytes: Number(before.size) };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function hashChromiumExecutable(executablePath: string): Promise<string> {
  return (await inspectChromiumExecutable(executablePath)).sha256;
}

export async function verifyChromiumExecutable(input: { executablePath: string; expectedSha256: string }): Promise<VerifiedChromiumExecutable> {
  if (!/^[a-fA-F0-9]{64}$/.test(input.expectedSha256)) throw new BrowserExecutableError('expectedSha256 must be a 64-character hexadecimal digest.');
  const verified = await inspectChromiumExecutable(input.executablePath);
  if (verified.sha256 !== input.expectedSha256.toLowerCase()) throw new BrowserExecutableError(`Chromium executable SHA-256 mismatch at ${verified.executablePath}.`);
  return verified;
}

function executableRelativePath(descriptor: ArchitectureDescriptor): string {
  return path.join(`chromium-${PINNED_CHROMIUM_REVISION}`, descriptor.browserDirectory, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
}

async function defaultInstaller(input: { executable: string; args: string[]; env: NodeJS.ProcessEnv }): Promise<void> {
  await execFileAsync(input.executable, input.args, { env: input.env, timeout: 10 * 60 * 1_000, maxBuffer: 8 * 1024 * 1024 });
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

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function verifyChromiumLaunch(
  executablePath: string,
  inputProfileDirectory: string,
): Promise<void> {
  const profileDirectory = resolveUserPath(inputProfileDirectory);
  const statePath = path.dirname(profileDirectory);
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  await assertNoSymlinkComponents(profileDirectory);
  const manager = new ProcessManager({ statePath });
  let job: Awaited<ReturnType<ProcessManager['start']>> | undefined;
  let completed = false;
  let completionError: Error | undefined;
  try {
    job = await manager.start({
      executable: executablePath,
      cwd: profileDirectory,
      args: [
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profileDirectory}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-service-autorun',
        '--password-store=basic',
        '--use-mock-keychain',
        'about:blank',
      ],
    });
    void job.wait().then(
      () => { completed = true; },
      (error: unknown) => {
        completionError = error instanceof Error ? error : new Error(String(error));
      },
    );

    const devtoolsFile = path.join(profileDirectory, 'DevToolsActivePort');
    const deadline = Date.now() + 30_000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      if (completionError !== undefined) {
        throw new BrowserNotReadyError('Pinned Chromium failed before publishing CDP readiness.', {
          cause: completionError,
        });
      }
      if (completed) {
        throw new BrowserNotReadyError('Pinned Chromium exited before publishing CDP readiness.');
      }
      try {
        await assertNoSymlinkComponents(devtoolsFile);
        const stats = await lstat(devtoolsFile);
        if (stats.isSymbolicLink()
          || !stats.isFile()
          || stats.uid !== currentUserId()
          || stats.size <= 0
          || stats.size > 1024) {
          throw new BrowserNotReadyError('Pinned Chromium produced unsafe DevTools metadata.');
        }
        const [portLine, websocketPath] = (await readFile(devtoolsFile, 'utf8')).trim().split('\n');
        const port = Number(portLine);
        if (!Number.isInteger(port)
          || port < 1
          || port > 65_535
          || websocketPath === undefined
          || !websocketPath.startsWith('/devtools/browser/')) {
          throw new BrowserNotReadyError('Pinned Chromium produced malformed DevTools metadata.');
        }
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (!response.ok) {
          throw new BrowserNotReadyError(`Pinned Chromium CDP probe returned HTTP ${response.status}.`);
        }
        const metadata = await response.json() as Record<string, unknown>;
        if (typeof metadata.Browser !== 'string'
          || typeof metadata.webSocketDebuggerUrl !== 'string') {
          throw new BrowserNotReadyError('Pinned Chromium CDP response is malformed.');
        }
        const webSocketUrl = new URL(metadata.webSocketDebuggerUrl);
        if (webSocketUrl.protocol !== 'ws:'
          || !['127.0.0.1', 'localhost'].includes(webSocketUrl.hostname)
          || Number(webSocketUrl.port) !== port
          || webSocketUrl.pathname !== websocketPath) {
          throw new BrowserNotReadyError('Pinned Chromium CDP response is not bound to the expected loopback endpoint.');
        }
        return;
      } catch (error) {
        if (error instanceof BrowserNotReadyError) throw error;
        if (nestedErrorCode(error) !== 'ENOENT') lastError = error;
      }
      await sleep(25);
    }
    throw new BrowserNotReadyError('Pinned Chromium did not publish a usable CDP endpoint within 30000 ms.', {
      cause: lastError instanceof Error ? lastError : undefined,
    });
  } finally {
    try {
      await job?.cancel();
    } finally {
      await rm(profileDirectory, { recursive: true, force: true });
    }
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function installPinnedChromium(options: InstallPinnedChromiumOptions): Promise<ChromiumInstallManifest> {
  const descriptor = descriptorFor(options.architecture ?? process.arch);
  const installationDirectory = resolveUserPath(options.installationDirectory);
  const parentDirectory = path.dirname(installationDirectory);
  const stagingDirectory = path.join(parentDirectory, `.browser-install-${randomBytes(12).toString('hex')}`);
  const backupDirectory = path.join(parentDirectory, `.browser-backup-${randomBytes(12).toString('hex')}`);
  const cliPath = options.playwrightCliPath
    ?? path.join(path.dirname(moduleRequire.resolve('playwright-core')), 'cli.js');
  const runInstaller = options.runInstaller ?? defaultInstaller;
  const verifyExecutable = options.verifyExecutable ?? verifyChromiumExecutable;
  const verifyLaunch = options.verifyLaunch ?? verifyChromiumLaunch;
  const now = options.now ?? (() => new Date());
  try {
    await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
    await assertNoSymlinkComponents(parentDirectory);
    await mkdir(stagingDirectory, { mode: 0o700 });
    await runInstaller({
      executable: process.execPath,
      args: [cliPath, 'install', 'chromium', '--no-shell'],
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: stagingDirectory,
        PLAYWRIGHT_DOWNLOAD_HOST: 'https://cdn.playwright.dev',
        PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: 'https://cdn.playwright.dev',
      },
    });
    const stagedExecutable = path.join(stagingDirectory, executableRelativePath(descriptor));
    const staged = await verifyExecutable({ executablePath: stagedExecutable, expectedSha256: descriptor.executableSha256 });
    await verifyLaunch(staged.executablePath, path.join(stagingDirectory, '.launch-verification-profile'));
    const finalExecutable = path.join(installationDirectory, executableRelativePath(descriptor));
    const manifest: ChromiumInstallManifest = {
      schemaVersion: 1,
      playwrightVersion: PINNED_PLAYWRIGHT_VERSION,
      chromiumRevision: PINNED_CHROMIUM_REVISION,
      chromiumVersion: PINNED_CHROMIUM_VERSION,
      architecture: descriptor.architecture,
      archiveUrl: descriptor.archiveUrl,
      archiveSha256: descriptor.archiveSha256,
      executablePath: finalExecutable,
      executableSha256: descriptor.executableSha256,
      installedAt: now().toISOString(),
    };
    await atomicWriteFile(path.join(stagingDirectory, 'loom-browser.json'), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    let previousMoved = false;
    try {
      await rename(installationDirectory, backupDirectory);
      previousMoved = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await rename(stagingDirectory, installationDirectory);
      await syncDirectory(parentDirectory);
      await chmod(installationDirectory, 0o700);
      await verifyExecutable({
        executablePath: finalExecutable,
        expectedSha256: descriptor.executableSha256,
      });
      if (previousMoved) {
        await rm(backupDirectory, { recursive: true, force: true });
        await syncDirectory(parentDirectory);
      }
      return manifest;
    } catch (error) {
      await rm(installationDirectory, { recursive: true, force: true }).catch(() => undefined);
      if (previousMoved) {
        await rename(backupDirectory, installationDirectory);
      }
      await syncDirectory(parentDirectory);
      throw error;
    }
  } catch (error) {
    if (error instanceof BrowserExecutableError || error instanceof BrowserNotReadyError) throw error;
    if (error instanceof PathPolicyError) throw new BrowserExecutableError(error.message, { cause: error });
    throw new BrowserExecutableError(`Unable to install pinned Chromium: ${String(error)}`, { cause: error instanceof Error ? error : undefined });
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function readChromiumInstallManifest(installationDirectory: string): Promise<ChromiumInstallManifest> {
  const root = resolveUserPath(installationDirectory);
  const manifestPath = path.join(root, 'loom-browser.json');
  await assertNoSymlinkComponents(manifestPath);
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<ChromiumInstallManifest>;
  const descriptor = descriptorFor(process.arch);
  if (parsed.schemaVersion !== 1 || parsed.playwrightVersion !== PINNED_PLAYWRIGHT_VERSION || parsed.chromiumRevision !== PINNED_CHROMIUM_REVISION || parsed.chromiumVersion !== PINNED_CHROMIUM_VERSION || parsed.architecture !== descriptor.architecture || parsed.archiveUrl !== descriptor.archiveUrl || parsed.archiveSha256 !== descriptor.archiveSha256 || parsed.executableSha256 !== descriptor.executableSha256 || typeof parsed.executablePath !== 'string' || typeof parsed.installedAt !== 'string') {
    throw new BrowserExecutableError('Chromium install manifest does not match the pinned build.');
  }
  const expectedExecutable = path.join(root, executableRelativePath(descriptor));
  if (parsed.executablePath !== expectedExecutable) throw new BrowserExecutableError('Chromium install manifest executable path is not canonical.');
  await verifyChromiumExecutable({ executablePath: parsed.executablePath, expectedSha256: parsed.executableSha256 });
  return parsed as ChromiumInstallManifest;
}
