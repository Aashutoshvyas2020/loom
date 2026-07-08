import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export class PathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathPolicyError';
  }
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new PathPolicyError('Path contains malformed Unicode.');
      }
      index += 1;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new PathPolicyError('Path contains malformed Unicode.');
    }
  }
}

export function resolveUserPath(input: string, homeDirectory = homedir()): string {
  if (input.length === 0) {
    throw new PathPolicyError('Path is required.');
  }
  if (input.includes('\0')) {
    throw new PathPolicyError('Path contains a NUL byte.');
  }

  assertWellFormedUnicode(input);

  if (input.startsWith('~/')) {
    return path.resolve(homeDirectory, input.slice(2));
  }

  if (input.startsWith('~')) {
    throw new PathPolicyError('Only ~/ paths are supported.');
  }

  if (!path.isAbsolute(input)) {
    throw new PathPolicyError('Path must be absolute or start with ~/.');
  }

  return path.resolve(input);
}

export async function assertNoSymlinkComponents(targetPath: string): Promise<void> {
  if (!path.isAbsolute(targetPath)) {
    throw new PathPolicyError('Symlink checks require an absolute path.');
  }

  const parsed = path.parse(targetPath);
  const parts = targetPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;

  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]!);

    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new PathPolicyError(`Symbolic-link path component is not allowed: ${current}`);
      }
      if (index < parts.length - 1 && !stats.isDirectory()) {
        throw new PathPolicyError(`Non-directory path component: ${current}`);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return;
      }
      if (error instanceof PathPolicyError) {
        throw error;
      }
      throw new PathPolicyError(`Unable to inspect path component ${current}: ${String(error)}`);
    }
  }
}
