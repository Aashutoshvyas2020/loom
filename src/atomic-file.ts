import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import { MAX_WRITE_BYTES } from './limits.js';
import { PathPolicyError, assertNoSymlinkComponents, resolveUserPath } from './paths.js';

export class AtomicFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AtomicFileError';
  }
}

export class AtomicFileConflictError extends AtomicFileError {
  constructor(message: string) {
    super(message);
    this.name = 'AtomicFileConflictError';
  }
}

export interface AtomicWriteOptions {
  createParents?: boolean;
  expectedSha256?: string;
}

export interface AtomicWriteResult {
  sha256: string;
  bytes: number;
}

interface TargetIdentity {
  exists: boolean;
  device?: bigint;
  inode?: bigint;
  size?: bigint;
  modifiedNs?: bigint;
  mode?: number;
  sha256?: string;
}

const pathLocks = new Map<string, Promise<void>>();

function digest(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function inspectTarget(targetPath: string, includeHash: boolean): Promise<TargetIdentity> {
  try {
    const stats = await lstat(targetPath, { bigint: true });
    if (stats.isSymbolicLink()) {
      throw new AtomicFileError(`Symbolic-link target is not allowed: ${targetPath}`);
    }
    if (!stats.isFile()) {
      throw new AtomicFileError(`Atomic replacement requires a regular file: ${targetPath}`);
    }

    return {
      exists: true,
      device: stats.dev,
      inode: stats.ino,
      size: stats.size,
      modifiedNs: stats.mtimeNs,
      mode: Number(stats.mode & 0o777n),
      ...(includeHash ? { sha256: digest(await readFile(targetPath)) } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
}

function sameIdentity(before: TargetIdentity, after: TargetIdentity): boolean {
  if (before.exists !== after.exists) {
    return false;
  }
  if (!before.exists) {
    return true;
  }

  return before.device === after.device
    && before.inode === after.inode
    && before.size === after.size
    && before.modifiedNs === after.modifiedNs
    && before.sha256 === after.sha256;
}

async function withPathLock<T>(targetPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = pathLocks.get(targetPath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  pathLocks.set(targetPath, queued);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (pathLocks.get(targetPath) === queued) {
      pathLocks.delete(targetPath);
    }
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function atomicWriteFile(
  inputPath: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const targetPath = resolveUserPath(inputPath);
  const bytes = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);

  if (bytes.byteLength > MAX_WRITE_BYTES) {
    throw new AtomicFileError(`Content exceeds ${MAX_WRITE_BYTES} bytes.`);
  }
  if (options.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(options.expectedSha256)) {
    throw new AtomicFileError('expectedSha256 must be a 64-character hexadecimal SHA-256 digest.');
  }

  return withPathLock(targetPath, async () => {
    const parentPath = path.dirname(targetPath);
    let temporaryPath: string | undefined;
    let replaced = false;

    try {
      await assertNoSymlinkComponents(targetPath);
      if (options.createParents) {
        await mkdir(parentPath, { recursive: true, mode: 0o700 });
        await assertNoSymlinkComponents(targetPath);
      }

      const includeHash = options.expectedSha256 !== undefined;
      const before = await inspectTarget(targetPath, includeHash);
      if (options.expectedSha256 !== undefined && before.sha256 !== options.expectedSha256.toLowerCase()) {
        throw new AtomicFileConflictError(`File changed before replacement: ${targetPath}`);
      }

      const mode = before.mode ?? 0o600;
      temporaryPath = path.join(
        parentPath,
        `.${path.basename(targetPath)}.loom-${process.pid}-${randomUUID()}.tmp`,
      );

      const handle = await open(temporaryPath, 'wx', mode);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }

      await assertNoSymlinkComponents(targetPath);
      const after = await inspectTarget(targetPath, includeHash);
      if (!sameIdentity(before, after)) {
        throw new AtomicFileConflictError(`File changed during replacement: ${targetPath}`);
      }

      await rename(temporaryPath, targetPath);
      replaced = true;
      await syncDirectory(parentPath);

      return {
        sha256: digest(bytes),
        bytes: bytes.byteLength,
      };
    } catch (error) {
      if (error instanceof AtomicFileError) {
        throw error;
      }
      if (error instanceof PathPolicyError) {
        throw new AtomicFileError(error.message, { cause: error });
      }
      throw new AtomicFileError(`Atomic write failed for ${targetPath}: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    } finally {
      if (temporaryPath !== undefined && !replaced) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  });
}
