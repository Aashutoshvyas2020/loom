import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { AuditLogger, type AuditReceipt } from '../audit.js';
import {
  AtomicFileConflictError,
  AtomicFileError,
  atomicWriteFile,
} from '../atomic-file.js';
import {
  MAX_EDIT_WINDOW_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_WRITE_BYTES,
} from '../limits.js';
import {
  PathPolicyError,
  assertNoSymlinkComponents,
  resolveUserPath,
} from '../paths.js';
import type {
  LoomToolDispatcher,
  LoomToolName,
} from './register.js';

export class FileToolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FileToolError';
  }
}

export class FileEditConflictError extends FileToolError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FileEditConflictError';
  }
}

export interface FileToolServiceOptions {
  audit: AuditLogger;
}

export interface ReadFileInput {
  path: string;
  offset?: number;
  length?: number;
  encoding?: 'utf8' | 'base64';
}

export interface WriteFileInput {
  path: string;
  content: string;
  createParents?: boolean;
  expectedSha256?: string;
}

export interface EditFileInput {
  path: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
  expectedSha256?: string;
}

interface FileSnapshot {
  path: string;
  bytes: Buffer;
  sha256: string;
}

interface ImageType {
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function resolveFilePath(inputPath: string): string {
  try {
    return resolveUserPath(inputPath);
  } catch (error) {
    if (error instanceof PathPolicyError) {
      throw new FileToolError(error.message, { cause: error });
    }
    throw error;
  }
}

function validateNonnegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new FileToolError(`${name} must be a nonnegative safe integer.`);
  }
}

function validatePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new FileToolError(`${name} must be a positive safe integer.`);
  }
}

function validateOptionalSha256(value: string | undefined): void {
  if (value !== undefined && !SHA256_PATTERN.test(value)) {
    throw new FileToolError('expectedSha256 must be a 64-character hexadecimal SHA-256 digest.');
  }
}

function detectImage(bytes: Buffer): ImageType | null {
  if (bytes.byteLength >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png' };
  }
  if (bytes.byteLength >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg' };
  }
  if (bytes.byteLength >= 6) {
    const signature = bytes.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return { mimeType: 'image/gif' };
    }
  }
  if (bytes.byteLength >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp' };
  }
  return null;
}

interface SnapshotIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

function sameSnapshotIdentity(before: SnapshotIdentity, after: SnapshotIdentity): boolean {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeNs === after.mtimeNs
    && before.ctimeNs === after.ctimeNs;
}

async function readSnapshot(inputPath: string): Promise<FileSnapshot> {
  const resolvedPath = resolveFilePath(inputPath);
  const parentPath = path.dirname(resolvedPath);
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    await assertNoSymlinkComponents(parentPath);
    const inputIdentityBefore = await lstat(resolvedPath, { bigint: true });
    if (!inputIdentityBefore.isFile() && !inputIdentityBefore.isSymbolicLink()) {
      throw new FileToolError(`File reads require a regular file: ${resolvedPath}`);
    }

    const canonicalPath = await realpath(resolvedPath);
    await assertNoSymlinkComponents(canonicalPath);
    handle = await open(
      canonicalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new FileToolError(`File reads require a regular file: ${resolvedPath}`);
    }
    if (before.size > BigInt(MAX_WRITE_BYTES)) {
      throw new FileToolError(`File exceeds the ${MAX_WRITE_BYTES}-byte read limit: ${resolvedPath}`);
    }

    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    await assertNoSymlinkComponents(parentPath);
    const inputIdentityAfter = await lstat(resolvedPath, { bigint: true });
    const canonicalPathAfter = await realpath(resolvedPath);
    await assertNoSymlinkComponents(canonicalPathAfter);
    const pathnameIdentity = await lstat(canonicalPathAfter, { bigint: true });
    if (canonicalPathAfter !== canonicalPath
      || !sameSnapshotIdentity(inputIdentityBefore, inputIdentityAfter)
      || !pathnameIdentity.isFile()
      || !sameSnapshotIdentity(before, after)
      || before.dev !== pathnameIdentity.dev
      || before.ino !== pathnameIdentity.ino
      || bytes.byteLength !== Number(before.size)) {
      throw new FileToolError(`File changed while it was being read: ${resolvedPath}`);
    }

    return {
      path: resolvedPath,
      bytes,
      sha256: sha256(bytes),
    };
  } catch (error) {
    if (error instanceof FileToolError) {
      throw error;
    }
    if (error instanceof PathPolicyError) {
      throw new FileToolError(error.message, { cause: error });
    }
    throw new FileToolError(`Unable to read ${resolvedPath}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function textResult(
  text: string,
  metadata: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: metadata,
  };
}

async function finishAudit(
  audit: AuditLogger,
  receipt: AuditReceipt,
  status: 'ok' | 'error',
): Promise<void> {
  await audit.recordFinish(receipt, status);
}

function wrapMutationError(error: unknown, operation: 'write' | 'edit'): never {
  if (error instanceof FileToolError) {
    throw error;
  }
  if (error instanceof AtomicFileConflictError) {
    if (operation === 'edit') {
      throw new FileEditConflictError(error.message, { cause: error });
    }
    throw new FileToolError(error.message, { cause: error });
  }
  if (error instanceof AtomicFileError || error instanceof PathPolicyError) {
    throw new FileToolError(error.message, { cause: error });
  }
  throw new FileToolError(`File ${operation} failed: ${String(error)}`, {
    cause: error instanceof Error ? error : undefined,
  });
}

function countNonoverlappingMatches(text: string, search: string): number {
  let count = 0;
  let cursor = 0;
  while (cursor <= text.length) {
    const index = text.indexOf(search, cursor);
    if (index < 0) {
      break;
    }
    count += 1;
    cursor = index + search.length;
  }
  return count;
}

export class FileToolService {
  private readonly audit: AuditLogger;

  constructor(options: FileToolServiceOptions) {
    this.audit = options.audit;
  }

  async read(input: ReadFileInput): Promise<CallToolResult> {
    const offset = input.offset ?? 0;
    const encoding = input.encoding ?? 'utf8';
    validateNonnegativeSafeInteger(offset, 'offset');
    if (input.length !== undefined) {
      validatePositiveSafeInteger(input.length, 'length');
      if (input.length > MAX_WRITE_BYTES) {
        throw new FileToolError(`length exceeds the ${MAX_WRITE_BYTES}-byte read limit.`);
      }
    }

    const snapshot = await readSnapshot(input.path);
    if (offset > snapshot.bytes.byteLength) {
      throw new FileToolError(`offset ${offset} exceeds file size ${snapshot.bytes.byteLength}.`);
    }

    const image = detectImage(snapshot.bytes);
    if (image !== null) {
      if (offset !== 0 || input.length !== undefined) {
        throw new FileToolError('Image reads must return the complete image; offset and length are unsupported.');
      }
      if (snapshot.bytes.byteLength > MAX_SCREENSHOT_BYTES) {
        throw new FileToolError(`Image exceeds the ${MAX_SCREENSHOT_BYTES}-byte image limit.`);
      }
      const metadata = {
        path: snapshot.path,
        kind: 'image',
        mimeType: image.mimeType,
        encoding: 'base64',
        sha256: snapshot.sha256,
        fileBytes: snapshot.bytes.byteLength,
        offset: 0,
        returnedBytes: snapshot.bytes.byteLength,
        nextOffset: null,
        truncated: false,
      };
      await this.audit.recordRead('file.read', metadata);
      return {
        content: [{
          type: 'image',
          data: snapshot.bytes.toString('base64'),
          mimeType: image.mimeType,
        }],
        structuredContent: metadata,
      };
    }

    const maximumEnd = input.length === undefined
      ? snapshot.bytes.byteLength
      : Math.min(snapshot.bytes.byteLength, offset + input.length);
    const selected = snapshot.bytes.subarray(offset, maximumEnd);
    const truncated = maximumEnd < snapshot.bytes.byteLength;
    const nextOffset = truncated ? maximumEnd : null;

    let kind: 'text' | 'binary';
    let output: string;
    let mimeType: string;
    if (encoding === 'base64') {
      kind = 'binary';
      output = selected.toString('base64');
      mimeType = 'application/octet-stream';
    } else {
      try {
        fatalUtf8Decoder.decode(snapshot.bytes);
        output = fatalUtf8Decoder.decode(selected);
      } catch (error) {
        throw new FileToolError(
          'File is not valid UTF-8, or the requested byte range splits a UTF-8 code point. Retry with encoding="base64".',
          { cause: error instanceof Error ? error : undefined },
        );
      }
      kind = 'text';
      mimeType = 'text/plain; charset=utf-8';
    }

    const metadata = {
      path: snapshot.path,
      kind,
      mimeType,
      encoding,
      sha256: snapshot.sha256,
      fileBytes: snapshot.bytes.byteLength,
      offset,
      returnedBytes: selected.byteLength,
      nextOffset,
      truncated,
    };
    await this.audit.recordRead('file.read', metadata);
    return textResult(output, metadata);
  }

  async write(input: WriteFileInput): Promise<CallToolResult> {
    if (typeof input.content !== 'string') {
      throw new FileToolError('content must be a string.');
    }
    const content = Buffer.from(input.content);
    if (content.byteLength > MAX_WRITE_BYTES) {
      throw new FileToolError(`Content exceeds the ${MAX_WRITE_BYTES}-byte write limit.`);
    }
    validateOptionalSha256(input.expectedSha256);
    const resolvedPath = resolveFilePath(input.path);
    const receipt = await this.audit.recordMutationStart('file.write', {
      path: resolvedPath,
      bytes: content.byteLength,
      createParents: input.createParents === true,
      expectedSha256Provided: input.expectedSha256 !== undefined,
    });

    try {
      const written = await atomicWriteFile(resolvedPath, content, {
        ...(input.createParents === undefined ? {} : { createParents: input.createParents }),
        ...(input.expectedSha256 === undefined ? {} : { expectedSha256: input.expectedSha256 }),
      });
      await finishAudit(this.audit, receipt, 'ok');
      return textResult('File written atomically.', {
        path: resolvedPath,
        bytes: written.bytes,
        sha256: written.sha256,
      });
    } catch (error) {
      await finishAudit(this.audit, receipt, 'error');
      wrapMutationError(error, 'write');
    }
  }

  async edit(input: EditFileInput): Promise<CallToolResult> {
    if (typeof input.oldText !== 'string' || input.oldText.length === 0) {
      throw new FileToolError('oldText must be a non-empty string.');
    }
    if (typeof input.newText !== 'string') {
      throw new FileToolError('newText must be a string.');
    }
    if (Buffer.byteLength(input.oldText) > MAX_EDIT_WINDOW_BYTES
      || Buffer.byteLength(input.newText) > MAX_EDIT_WINDOW_BYTES) {
      throw new FileToolError(`Edit oldText and newText must each be at most ${MAX_EDIT_WINDOW_BYTES} bytes.`);
    }
    validateOptionalSha256(input.expectedSha256);

    const snapshot = await readSnapshot(input.path);
    let source: string;
    try {
      source = fatalUtf8Decoder.decode(snapshot.bytes);
    } catch (error) {
      throw new FileToolError('Exact edits require a valid UTF-8 text file.', {
        cause: error instanceof Error ? error : undefined,
      });
    }

    const receipt = await this.audit.recordMutationStart('file.edit', {
      path: snapshot.path,
      fileBytes: snapshot.bytes.byteLength,
      oldTextBytes: Buffer.byteLength(input.oldText),
      newTextBytes: Buffer.byteLength(input.newText),
      replaceAll: input.replaceAll === true,
      expectedSha256Provided: input.expectedSha256 !== undefined,
    });

    try {
      if (input.expectedSha256 !== undefined
        && snapshot.sha256 !== input.expectedSha256.toLowerCase()) {
        throw new FileEditConflictError(`File hash does not match expectedSha256: ${snapshot.path}`);
      }

      const replacements = countNonoverlappingMatches(source, input.oldText);
      if (replacements === 0) {
        throw new FileEditConflictError('oldText was not found exactly in the target file.');
      }
      if (replacements > 1 && input.replaceAll !== true) {
        throw new FileEditConflictError(
          `oldText matched ${replacements} locations; set replaceAll=true to replace every match.`,
        );
      }

      const updated = input.replaceAll === true
        ? source.split(input.oldText).join(input.newText)
        : source.replace(input.oldText, input.newText);
      const updatedBytes = Buffer.from(updated);
      if (updatedBytes.byteLength > MAX_WRITE_BYTES) {
        throw new FileToolError(`Edited file exceeds the ${MAX_WRITE_BYTES}-byte write limit.`);
      }

      const written = await atomicWriteFile(snapshot.path, updatedBytes, {
        expectedSha256: snapshot.sha256,
      });
      await finishAudit(this.audit, receipt, 'ok');
      return textResult('File edited atomically.', {
        path: snapshot.path,
        replacements: input.replaceAll === true ? replacements : 1,
        bytes: written.bytes,
        previousSha256: snapshot.sha256,
        sha256: written.sha256,
      });
    } catch (error) {
      await finishAudit(this.audit, receipt, 'error');
      wrapMutationError(error, 'edit');
    }
  }
}

export function createFileToolDispatcher(
  service: FileToolService,
  fallback: LoomToolDispatcher,
): LoomToolDispatcher {
  return async (name: LoomToolName, arguments_: Record<string, unknown>) => {
    switch (name) {
      case 'loom_read':
        return service.read(arguments_ as unknown as ReadFileInput);
      case 'loom_write':
        return service.write(arguments_ as unknown as WriteFileInput);
      case 'loom_edit':
        return service.edit(arguments_ as unknown as EditFileInput);
      default:
        return fallback(name, arguments_);
    }
  };
}
