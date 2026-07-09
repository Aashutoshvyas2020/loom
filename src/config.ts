import type { Stats } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { atomicWriteFile } from './atomic-file.js';
import { PathPolicyError, assertNoSymlinkComponents, resolveUserPath } from './paths.js';

export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

export interface QuickTunnelConfig {
  type: 'quick';
}

export interface NamedTunnelConfig {
  type: 'named';
  name: string;
  hostname: string;
  credentialsFile: string;
}

export interface LoomConfig {
  version: 1;
  tunnel: QuickTunnelConfig | NamedTunnelConfig;
  extraRoots: string[];
}

export interface RuntimeIdentity {
  pid: number;
  startTime: number;
  executablePath: string;
  launchId: string;
  statePath: string;
}

export interface ResetConfigResult {
  config: LoomConfig;
  backupPath?: string;
}

export const DEFAULT_CONFIG: LoomConfig = {
  version: 1,
  tunnel: { type: 'quick' },
  extraRoots: [],
};

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;

const namedTunnelName = z.string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim(), 'Tunnel name must not have surrounding whitespace.')
  .refine((value) => !value.startsWith('-'), 'Tunnel name must not be option-like.')
  .refine((value) => !controlCharacterPattern.test(value), 'Tunnel name contains control characters.');

const stableHostname = z.string()
  .regex(hostnamePattern)
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => value !== 'trycloudflare.com' && !value.endsWith('.trycloudflare.com'),
    'Named tunnel hostname must not use trycloudflare.com.',
  );

const supportedPath = z.string().min(1).superRefine((value, context) => {
  try {
    resolveUserPath(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid path.',
    });
  }
});

const runtimeIdentitySchema = z.object({
  pid: z.number().int().positive(),
  startTime: z.number().finite().nonnegative(),
  executablePath: z.string().refine(path.isAbsolute, 'Executable path must be absolute.'),
  launchId: z.string().min(1),
  statePath: z.string().refine(path.isAbsolute, 'State path must be absolute.'),
}).strict();

const configSchema = z.object({
  version: z.literal(1),
  tunnel: z.discriminatedUnion('type', [
    z.object({ type: z.literal('quick') }).strict(),
    z.object({
      type: z.literal('named'),
      name: namedTunnelName,
      hostname: stableHostname,
      credentialsFile: supportedPath,
    }).strict(),
  ]),
  extraRoots: z.array(supportedPath).superRefine((roots, context) => {
    const canonical = new Set<string>();
    for (const root of roots) {
      try {
        const resolved = resolveUserPath(root);
        if (canonical.has(resolved)) {
          context.addIssue({ code: 'custom', message: `Duplicate extra root: ${root}` });
        }
        canonical.add(resolved);
      } catch {
        // The element-level schema reports the path error.
      }
    }
  }),
}).strict();

const stateDirectories = [
  'audit',
  'browser',
  'browser-profile',
  'cloudflared',
  'downloads',
  'downloads/screenshots',
  'memory',
  'runtime',
] as const;

function currentUserId(): number {
  if (process.getuid === undefined) {
    throw new ConfigError('Loom state ownership checks require a POSIX user ID.');
  }
  return process.getuid();
}

function modeBits(mode: number): number {
  return mode & 0o777;
}

async function inspectOwnedPath(targetPath: string): Promise<Stats> {
  const stats = await lstat(targetPath);
  if (stats.isSymbolicLink()) {
    throw new ConfigError(`Symbolic-link state path is not allowed: ${targetPath}`);
  }
  if (stats.uid !== currentUserId()) {
    throw new ConfigError(`State path is not owned by the current user: ${targetPath}`);
  }
  return stats;
}

async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
  try {
    const stats = await inspectOwnedPath(directoryPath);
    if (!stats.isDirectory()) {
      throw new ConfigError(`State path is not a directory: ${directoryPath}`);
    }
    if (modeBits(stats.mode) !== 0o700) {
      await chmod(directoryPath, 0o700);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await mkdir(directoryPath, { mode: 0o700 });
  }
}

async function ensurePrivateFile(filePath: string): Promise<void> {
  const stats = await inspectOwnedPath(filePath);
  if (!stats.isFile()) {
    throw new ConfigError(`State path is not a regular file: ${filePath}`);
  }
  if (modeBits(stats.mode) !== 0o600) {
    await chmod(filePath, 0o600);
  }
}

function parseConfigBytes(bytes: Buffer, configPath: string): LoomConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new ConfigError(`Invalid JSON in ${configPath}.`, {
      cause: error instanceof Error ? error : undefined,
    });
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Invalid Loom configuration in ${configPath}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

async function readConfigBytes(stateRoot: string, requirePrivateMode: boolean): Promise<Buffer> {
  const configPath = path.join(stateRoot, 'config.json');
  try {
    await assertNoSymlinkComponents(configPath);
    const stats = await inspectOwnedPath(configPath);
    if (!stats.isFile()) {
      throw new ConfigError(`Configuration is not a regular file: ${configPath}`);
    }
    if (requirePrivateMode && modeBits(stats.mode) !== 0o600) {
      throw new ConfigError(`Configuration permissions must be 0600: ${configPath}`);
    }
    return await readFile(configPath);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if (error instanceof PathPolicyError) {
      throw new ConfigError(error.message, { cause: error });
    }
    throw new ConfigError(`Unable to read Loom configuration at ${configPath}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function serializeConfig(config: LoomConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function initializeState(inputStateRoot = '~/.loom'): Promise<LoomConfig> {
  const stateRoot = resolveUserPath(inputStateRoot);
  try {
    await assertNoSymlinkComponents(stateRoot);
    await ensurePrivateDirectory(stateRoot);
    for (const relativePath of stateDirectories) {
      const directoryPath = path.join(stateRoot, relativePath);
      await assertNoSymlinkComponents(directoryPath);
      await ensurePrivateDirectory(directoryPath);
    }

    const configPath = path.join(stateRoot, 'config.json');
    try {
      await ensurePrivateFile(configPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      await atomicWriteFile(configPath, serializeConfig(DEFAULT_CONFIG));
    }

    return parseConfigBytes(await readConfigBytes(stateRoot, true), configPath);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if (error instanceof PathPolicyError) {
      throw new ConfigError(error.message, { cause: error });
    }
    throw new ConfigError(`Unable to initialize Loom state at ${stateRoot}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export async function checkConfig(inputStateRoot = '~/.loom'): Promise<LoomConfig> {
  const stateRoot = resolveUserPath(inputStateRoot);
  const configPath = path.join(stateRoot, 'config.json');
  return parseConfigBytes(await readConfigBytes(stateRoot, true), configPath);
}

export async function resetConfig(
  inputStateRoot = '~/.loom',
  now = new Date(),
): Promise<ResetConfigResult> {
  const stateRoot = resolveUserPath(inputStateRoot);
  await assertNoSymlinkComponents(stateRoot).catch((error) => {
    throw new ConfigError(error instanceof Error ? error.message : String(error), {
      cause: error instanceof Error ? error : undefined,
    });
  });
  await ensurePrivateDirectory(stateRoot);

  const configPath = path.join(stateRoot, 'config.json');
  let previous: Buffer | undefined;
  let invalid = false;

  try {
    previous = await readConfigBytes(stateRoot, false);
    try {
      parseConfigBytes(previous, configPath);
    } catch {
      invalid = true;
    }
    await ensurePrivateFile(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT'
      && !(error instanceof ConfigError && error.cause instanceof Error
        && (error.cause as NodeJS.ErrnoException).code === 'ENOENT')) {
      throw error;
    }
  }

  let backupPath: string | undefined;
  if (invalid && previous !== undefined) {
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(stateRoot, `config.invalid.${timestamp}.json`);
    await atomicWriteFile(backupPath, previous);
  }

  await atomicWriteFile(configPath, serializeConfig(DEFAULT_CONFIG));
  await ensurePrivateFile(configPath);

  return {
    config: DEFAULT_CONFIG,
    ...(backupPath === undefined ? {} : { backupPath }),
  };
}

export async function writeRuntimeLock(
  inputStateRoot: string,
  identity: RuntimeIdentity,
): Promise<void> {
  const stateRoot = resolveUserPath(inputStateRoot);
  const parsed = runtimeIdentitySchema.safeParse(identity);
  if (!parsed.success) {
    throw new ConfigError(`Invalid runtime identity: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.statePath !== stateRoot) {
    throw new ConfigError('Runtime identity statePath does not match the active Loom state root.');
  }

  const runtimeDirectory = path.join(stateRoot, 'runtime');
  const directoryStats = await inspectOwnedPath(runtimeDirectory).catch((error) => {
    throw new ConfigError(`Unable to inspect runtime directory ${runtimeDirectory}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  });
  if (!directoryStats.isDirectory() || modeBits(directoryStats.mode) !== 0o700) {
    throw new ConfigError(`Runtime directory must be a private 0700 directory: ${runtimeDirectory}`);
  }

  await atomicWriteFile(
    path.join(runtimeDirectory, 'loom.lock'),
    `${JSON.stringify(parsed.data, null, 2)}\n`,
  );
}

export async function readRuntimeLock(inputStateRoot: string): Promise<RuntimeIdentity> {
  const stateRoot = resolveUserPath(inputStateRoot);
  const lockPath = path.join(stateRoot, 'runtime', 'loom.lock');
  try {
    await assertNoSymlinkComponents(lockPath);
    const stats = await inspectOwnedPath(lockPath);
    if (!stats.isFile() || modeBits(stats.mode) !== 0o600) {
      throw new ConfigError(`Runtime lock must be a private 0600 regular file: ${lockPath}`);
    }

    const raw = JSON.parse(await readFile(lockPath, 'utf8')) as unknown;
    const parsed = runtimeIdentitySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConfigError(`Invalid runtime lock at ${lockPath}: ${z.prettifyError(parsed.error)}`);
    }
    if (parsed.data.statePath !== stateRoot) {
      throw new ConfigError(`Runtime lock statePath does not match ${stateRoot}.`);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError(`Unable to read runtime lock at ${lockPath}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export function runtimeIdentityMatches(
  expected: RuntimeIdentity,
  observed: RuntimeIdentity,
): boolean {
  return expected.pid === observed.pid
    && expected.startTime === observed.startTime
    && expected.executablePath === observed.executablePath
    && expected.launchId === observed.launchId
    && expected.statePath === observed.statePath;
}
