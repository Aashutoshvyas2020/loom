import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { AuditLogger, type AuditReceipt } from '../audit.js';
import { AtomicFileError, atomicWriteFile } from '../atomic-file.js';
import {
  MAX_FILES_PER_ROOT,
  MAX_TOTAL_INDEXED_BYTES,
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

export class MemoryStoreConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MemoryStoreConfigError';
  }
}

export class MemoryStoreLimitError extends MemoryStoreConfigError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MemoryStoreLimitError';
  }
}

export class MemoryConflictError extends MemoryStoreConfigError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MemoryConflictError';
  }
}

export interface MemoryStoreLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface MemoryStoreServiceOptions {
  memoryDirectory: string;
  audit: AuditLogger;
  limits?: Partial<MemoryStoreLimits>;
  now?: () => Date;
}

export interface SaveMemoryInput {
  title: string;
  content: string;
}

export interface DeleteMemoryInput {
  id: string;
}

export interface SearchMemoryInput {
  query: string;
  limit?: number;
}

export interface ReadMemoryInput {
  id: string;
}

export interface MemoryDiagnostic {
  code:
    | 'invalid_memory_skipped'
    | 'unknown_entry_skipped'
    | 'oversized_memory_skipped'
    | 'unsafe_tombstone_skipped'
    | 'tombstone_cleanup_failed';
  path: string;
  message: string;
}

export interface MemorySummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  contentBytes: number;
  fileBytes: number;
  sha256: string;
}

export interface MemorySnapshot {
  generation: number;
  scannedAt: string | null;
  memories: MemorySummary[];
  diagnostics: MemoryDiagnostic[];
  totalBytes: number;
}

interface InternalMemory extends MemorySummary {
  filePath: string;
  content: string;
  normalizedTitle: string;
  normalizedContent: string;
}

interface ParsedMemory {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  content: string;
}

interface StableMemoryFile {
  memory: InternalMemory;
  identity: FileIdentity;
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

const DEFAULT_LIMITS: MemoryStoreLimits = {
  maxFiles: MAX_FILES_PER_ROOT,
  maxFileBytes: MAX_WRITE_BYTES,
  maxTotalBytes: MAX_TOTAL_INDEXED_BYTES,
};

const MEMORY_ID_PATTERN = /^mem_[A-Za-z0-9_-]{32}$/;
const MEMORY_FILENAME_PATTERN = /^(mem_[A-Za-z0-9_-]{32})\.md$/;
const TOMBSTONE_PATTERN = /^\.loom-delete-[A-Za-z0-9_-]+\.tmp$/;
const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function currentUserId(): number {
  if (process.getuid === undefined) {
    throw new MemoryStoreConfigError('Memory ownership checks require a POSIX user ID.');
  }
  return process.getuid();
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function nestedErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && typeof current.code === 'string') {
      return current.code;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function validateLimit(
  name: keyof MemoryStoreLimits,
  value: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new MemoryStoreConfigError(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

function normalizeLimits(input: Partial<MemoryStoreLimits> | undefined): MemoryStoreLimits {
  const limits = { ...DEFAULT_LIMITS, ...input };
  return {
    maxFiles: validateLimit('maxFiles', limits.maxFiles, MAX_FILES_PER_ROOT),
    maxFileBytes: validateLimit('maxFileBytes', limits.maxFileBytes, MAX_WRITE_BYTES),
    maxTotalBytes: validateLimit(
      'maxTotalBytes',
      limits.maxTotalBytes,
      MAX_TOTAL_INDEXED_BYTES,
    ),
  };
}

function validateMemoryId(id: string): void {
  if (!MEMORY_ID_PATTERN.test(id)) {
    throw new MemoryStoreConfigError('Memory ID is malformed.');
  }
}

function validateSaveInput(input: SaveMemoryInput): void {
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    throw new MemoryStoreConfigError('Memory title must not be empty.');
  }
  if (input.title.length > 512 || Buffer.byteLength(input.title) > 2_048) {
    throw new MemoryStoreLimitError('Memory title exceeds its fixed limit.');
  }
  if (typeof input.content !== 'string') {
    throw new MemoryStoreConfigError('Memory content must be a string.');
  }
  if (Buffer.byteLength(input.content) > MAX_WRITE_BYTES) {
    throw new MemoryStoreLimitError(`Memory content exceeds ${MAX_WRITE_BYTES} bytes.`);
  }
}

function validIsoTimestamp(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function serializeMemory(
  id: string,
  title: string,
  createdAt: string,
  updatedAt: string,
  content: string,
): Buffer {
  const header = [
    '---',
    'loom-memory-version: 1',
    `id: ${id}`,
    `title-json: ${JSON.stringify(title)}`,
    `created-at: ${createdAt}`,
    `updated-at: ${updatedAt}`,
    '---',
    '',
    '',
  ].join('\n');
  return Buffer.from(`${header}${content}`);
}

function parseMemory(text: string, filenameId: string): ParsedMemory {
  if (!text.startsWith('---\n')) {
    throw new MemoryStoreConfigError('Memory file is missing its versioned header.');
  }
  const boundary = text.indexOf('\n---\n\n', 4);
  if (boundary < 0) {
    throw new MemoryStoreConfigError('Memory file header is not terminated correctly.');
  }
  const headerLines = text.slice(4, boundary).split('\n');
  const fields = new Map<string, string>();
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      throw new MemoryStoreConfigError('Memory header contains a malformed field.');
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (fields.has(key)) {
      throw new MemoryStoreConfigError(`Memory header repeats field ${key}.`);
    }
    fields.set(key, value);
  }
  const expectedFields = [
    'loom-memory-version',
    'id',
    'title-json',
    'created-at',
    'updated-at',
  ];
  if (fields.size !== expectedFields.length
    || expectedFields.some((key) => !fields.has(key))) {
    throw new MemoryStoreConfigError('Memory header fields are incomplete or unsupported.');
  }
  if (fields.get('loom-memory-version') !== '1') {
    throw new MemoryStoreConfigError('Memory file version is unsupported.');
  }
  const id = fields.get('id')!;
  if (id !== filenameId || !MEMORY_ID_PATTERN.test(id)) {
    throw new MemoryStoreConfigError('Memory ID does not match its filename.');
  }

  let title: unknown;
  try {
    title = JSON.parse(fields.get('title-json')!);
  } catch (error) {
    throw new MemoryStoreConfigError('Memory title JSON is invalid.', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (typeof title !== 'string'
    || title.trim() === ''
    || title.length > 512
    || Buffer.byteLength(title) > 2_048) {
    throw new MemoryStoreConfigError('Memory title is invalid.');
  }

  const createdAt = fields.get('created-at')!;
  const updatedAt = fields.get('updated-at')!;
  if (!validIsoTimestamp(createdAt) || !validIsoTimestamp(updatedAt)) {
    throw new MemoryStoreConfigError('Memory timestamps must be canonical ISO-8601 values.');
  }
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new MemoryStoreConfigError('Memory updated-at precedes created-at.');
  }

  return {
    id,
    title,
    createdAt,
    updatedAt,
    content: text.slice(boundary + '\n---\n\n'.length),
  };
}

function immutableSnapshot(snapshot: MemorySnapshot): MemorySnapshot {
  for (const memory of snapshot.memories) {
    Object.freeze(memory);
  }
  for (const diagnostic of snapshot.diagnostics) {
    Object.freeze(diagnostic);
  }
  Object.freeze(snapshot.memories);
  Object.freeze(snapshot.diagnostics);
  return Object.freeze(snapshot);
}

function toolResult(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function finishAudit(
  audit: AuditLogger,
  receipt: AuditReceipt,
  status: 'ok' | 'error',
): Promise<void> {
  await audit.recordFinish(receipt, status);
}

export class MemoryStoreService {
  readonly memoryDirectory: string;

  private readonly audit: AuditLogger;
  private readonly limits: MemoryStoreLimits;
  private readonly now: () => Date;
  private currentSnapshot: MemorySnapshot = immutableSnapshot({
    generation: 0,
    scannedAt: null,
    memories: [],
    diagnostics: [],
    totalBytes: 0,
  });
  private currentMemories = new Map<string, InternalMemory>();
  private currentEntryCount = 0;
  private operationChain: Promise<void> = Promise.resolve();

  constructor(options: MemoryStoreServiceOptions) {
    try {
      this.memoryDirectory = resolveUserPath(options.memoryDirectory);
    } catch (error) {
      throw new MemoryStoreConfigError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      );
    }
    this.audit = options.audit;
    this.limits = normalizeLimits(options.limits);
    this.now = options.now ?? (() => new Date());
  }

  getSnapshot(): MemorySnapshot {
    return structuredClone(this.currentSnapshot);
  }

  rescan(): Promise<CallToolResult> {
    return this.exclusive(async () => {
      const snapshot = await this.scanAndPublish();
      await this.audit.recordRead('memory.rescan', {
        generation: snapshot.generation,
        memories: snapshot.memories.length,
        diagnostics: snapshot.diagnostics.length,
        totalBytes: snapshot.totalBytes,
      });
      return toolResult('Memory store rescanned.', {
        generation: snapshot.generation,
        memories: snapshot.memories.length,
        diagnostics: snapshot.diagnostics,
        totalBytes: snapshot.totalBytes,
      });
    });
  }

  async list(): Promise<CallToolResult> {
    await this.initializeIfNeeded();
    const snapshot = this.getSnapshot();
    await this.audit.recordRead('memory.list', {
      generation: snapshot.generation,
      memories: snapshot.memories.length,
    });
    return toolResult(JSON.stringify(snapshot.memories, null, 2), {
      generation: snapshot.generation,
      scannedAt: snapshot.scannedAt,
      memories: snapshot.memories,
      diagnostics: snapshot.diagnostics,
      totalBytes: snapshot.totalBytes,
    });
  }

  async search(input: SearchMemoryInput): Promise<CallToolResult> {
    await this.initializeIfNeeded();
    if (typeof input.query !== 'string' || input.query.trim() === '' || input.query.length > 4_096) {
      throw new MemoryStoreConfigError('Memory search query must contain 1-4096 characters.');
    }
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
      throw new MemoryStoreConfigError('Memory search limit must be an integer from 1 to 100.');
    }

    const query = input.query.toLocaleLowerCase('en-US').trim();
    const tokens = [...new Set(query.split(/\s+/).filter(Boolean))];
    const results = [...this.currentMemories.values()]
      .map((memory) => ({ memory, score: this.scoreMemory(memory, query, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || lexicalCompare(left.memory.id, right.memory.id))
      .slice(0, limit)
      .map(({ memory, score }) => ({ ...this.summary(memory), score }));

    await this.audit.recordRead('memory.search', {
      generation: this.currentSnapshot.generation,
      queryBytes: Buffer.byteLength(input.query),
      results: results.length,
    });
    return toolResult(JSON.stringify(results, null, 2), {
      generation: this.currentSnapshot.generation,
      memories: results,
    });
  }

  async read(input: ReadMemoryInput): Promise<CallToolResult> {
    await this.initializeIfNeeded();
    validateMemoryId(input.id);
    const memory = this.currentMemories.get(input.id);
    if (memory === undefined) {
      throw new MemoryStoreConfigError(`Unknown memory ID: ${input.id}`);
    }
    await this.audit.recordRead('memory.read', {
      generation: this.currentSnapshot.generation,
      id: memory.id,
      contentBytes: memory.contentBytes,
    });
    return toolResult(memory.content, { ...this.summary(memory) });
  }

  save(input: SaveMemoryInput): Promise<CallToolResult> {
    validateSaveInput(input);
    return this.exclusive(async () => {
      await this.initializeWithinLock();
      const timestamp = this.now().toISOString();
      const id = await this.createUnusedId();
      const bytes = serializeMemory(id, input.title, timestamp, timestamp, input.content);
      if (bytes.byteLength > this.limits.maxFileBytes) {
        throw new MemoryStoreLimitError(
          `Serialized memory exceeds ${this.limits.maxFileBytes} bytes.`,
        );
      }
      if (this.currentEntryCount + 1 > this.limits.maxFiles) {
        throw new MemoryStoreLimitError(`Memory store exceeds ${this.limits.maxFiles} files.`);
      }
      if (this.currentSnapshot.totalBytes + bytes.byteLength > this.limits.maxTotalBytes) {
        throw new MemoryStoreLimitError(
          `Memory store exceeds ${this.limits.maxTotalBytes} indexed bytes.`,
        );
      }

      const filePath = path.join(this.memoryDirectory, `${id}.md`);
      const receipt = await this.audit.recordMutationStart('memory.save', {
        id,
        titleBytes: Buffer.byteLength(input.title),
        contentBytes: Buffer.byteLength(input.content),
        fileBytes: bytes.byteLength,
      });

      try {
        const written = await atomicWriteFile(filePath, bytes);
        const memory = this.internalMemory(
          {
            id,
            title: input.title,
            createdAt: timestamp,
            updatedAt: timestamp,
            content: input.content,
          },
          filePath,
          bytes.byteLength,
          written.sha256,
        );
        const next = new Map(this.currentMemories);
        next.set(id, memory);
        this.publish(
          next,
          this.currentSnapshot.diagnostics,
          this.currentSnapshot.totalBytes + bytes.byteLength,
          this.currentEntryCount + 1,
        );
        await finishAudit(this.audit, receipt, 'ok');
        return toolResult('Memory saved.', { ...this.summary(memory) });
      } catch (error) {
        await finishAudit(this.audit, receipt, 'error');
        if (error instanceof MemoryStoreConfigError) {
          throw error;
        }
        if (error instanceof AtomicFileError || error instanceof PathPolicyError) {
          throw new MemoryStoreConfigError(error.message, { cause: error });
        }
        throw new MemoryStoreConfigError(`Unable to save memory: ${String(error)}`, {
          cause: error instanceof Error ? error : undefined,
        });
      }
    });
  }

  delete(input: DeleteMemoryInput): Promise<CallToolResult> {
    validateMemoryId(input.id);
    return this.exclusive(async () => {
      await this.initializeWithinLock();
      const receipt = await this.audit.recordMutationStart('memory.delete', { id: input.id });
      try {
        const memory = this.currentMemories.get(input.id);
        if (memory === undefined) {
          throw new MemoryStoreConfigError(`Unknown memory ID: ${input.id}`);
        }
        const current = await this.readStableMemoryFile(memory.filePath, memory.id);
        if (current.memory.sha256 !== memory.sha256) {
          throw new MemoryConflictError(
            `Memory changed on disk; rescan before deleting ${memory.id}.`,
          );
        }
        const beforeRename = await lstat(memory.filePath, { bigint: true });
        if (!sameIdentity(current.identity, beforeRename)) {
          throw new MemoryConflictError(
            `Memory changed before deletion; rescan before deleting ${memory.id}.`,
          );
        }

        const tombstone = path.join(
          this.memoryDirectory,
          `.loom-delete-${memory.id}-${randomBytes(12).toString('base64url')}.tmp`,
        );
        await rename(memory.filePath, tombstone);
        await syncDirectory(this.memoryDirectory);

        const next = new Map(this.currentMemories);
        next.delete(memory.id);
        this.publish(
          next,
          this.currentSnapshot.diagnostics,
          this.currentSnapshot.totalBytes - memory.fileBytes,
          Math.max(0, this.currentEntryCount - 1),
        );

        await rm(tombstone, { force: true }).catch(() => undefined);
        await syncDirectory(this.memoryDirectory).catch(() => undefined);
        await finishAudit(this.audit, receipt, 'ok');
        return toolResult('Memory deleted.', { id: memory.id });
      } catch (error) {
        await finishAudit(this.audit, receipt, 'error');
        if (error instanceof MemoryStoreConfigError) {
          throw error;
        }
        throw new MemoryStoreConfigError(`Unable to delete memory: ${String(error)}`, {
          cause: error instanceof Error ? error : undefined,
        });
      }
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationChain.then(operation, operation);
    this.operationChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async initializeIfNeeded(): Promise<void> {
    if (this.currentSnapshot.generation > 0) {
      return;
    }
    await this.exclusive(async () => this.initializeWithinLock());
  }

  private async initializeWithinLock(): Promise<void> {
    if (this.currentSnapshot.generation === 0) {
      await this.scanAndPublish();
    }
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await assertNoSymlinkComponents(this.memoryDirectory);
      await mkdir(this.memoryDirectory, { recursive: true, mode: 0o700 });
      await assertNoSymlinkComponents(this.memoryDirectory);
      const stats = await lstat(this.memoryDirectory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new MemoryStoreConfigError(
          `Memory path must be a real directory: ${this.memoryDirectory}`,
        );
      }
      if (stats.uid !== currentUserId()) {
        throw new MemoryStoreConfigError(
          `Memory directory is not owned by the current user: ${this.memoryDirectory}`,
        );
      }
      if ((stats.mode & 0o777) !== 0o700) {
        await chmod(this.memoryDirectory, 0o700);
      }
    } catch (error) {
      if (error instanceof MemoryStoreConfigError) {
        throw error;
      }
      if (error instanceof PathPolicyError) {
        throw new MemoryStoreConfigError(error.message, { cause: error });
      }
      throw new MemoryStoreConfigError(
        `Unable to initialize memory directory ${this.memoryDirectory}: ${String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  private async recoverTombstone(
    entryName: string,
    diagnostics: MemoryDiagnostic[],
  ): Promise<void> {
    const tombstonePath = path.join(this.memoryDirectory, entryName);
    let stats;
    try {
      stats = await lstat(tombstonePath, { bigint: true });
      if (stats.isSymbolicLink()
        || !stats.isFile()
        || stats.uid !== BigInt(currentUserId())
        || (Number(stats.mode) & 0o777) !== 0o600) {
        diagnostics.push({
          code: 'unsafe_tombstone_skipped',
          path: entryName,
          message: 'Delete tombstone failed ownership, type, or permission verification.',
        });
        return;
      }
      await assertNoSymlinkComponents(tombstonePath);
    } catch (error) {
      diagnostics.push({
        code: 'tombstone_cleanup_failed',
        path: entryName,
        message: `Unable to verify delete tombstone: ${String(error)}`,
      });
      return;
    }

    let receipt: AuditReceipt;
    try {
      receipt = await this.audit.recordMutationStart('memory.tombstone_cleanup', {
        path: entryName,
        bytes: Number(stats.size),
      });
    } catch (error) {
      diagnostics.push({
        code: 'tombstone_cleanup_failed',
        path: entryName,
        message: `Audit prevented delete tombstone cleanup: ${String(error)}`,
      });
      return;
    }

    try {
      await rm(tombstonePath);
      await syncDirectory(this.memoryDirectory);
      await finishAudit(this.audit, receipt, 'ok');
    } catch (error) {
      await finishAudit(this.audit, receipt, 'error');
      diagnostics.push({
        code: 'tombstone_cleanup_failed',
        path: entryName,
        message: `Unable to remove delete tombstone: ${String(error)}`,
      });
    }
  }

  private async scanAndPublish(): Promise<MemorySnapshot> {
    await this.ensureDirectory();
    let entries;
    try {
      entries = await readdir(this.memoryDirectory, { withFileTypes: true });
      await assertNoSymlinkComponents(this.memoryDirectory);
    } catch (error) {
      throw new MemoryStoreConfigError(`Unable to scan memory directory: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
    entries.sort((left, right) => lexicalCompare(left.name, right.name));

    const countedEntries = entries.filter((entry) => !TOMBSTONE_PATTERN.test(entry.name));
    if (countedEntries.length > this.limits.maxFiles) {
      throw new MemoryStoreLimitError(`Memory store exceeds ${this.limits.maxFiles} files.`);
    }

    const next = new Map<string, InternalMemory>();
    const diagnostics: MemoryDiagnostic[] = [];
    let totalBytes = 0;

    for (const entry of entries) {
      if (TOMBSTONE_PATTERN.test(entry.name)) {
        await this.recoverTombstone(entry.name, diagnostics);
        continue;
      }
      const entryPath = path.join(this.memoryDirectory, entry.name);
      const stats = await lstat(entryPath, { bigint: true });
      if (stats.isSymbolicLink()) {
        throw new MemoryStoreConfigError(
          `Symbolic links are forbidden in the Loom memory directory: ${entry.name}`,
        );
      }
      const match = MEMORY_FILENAME_PATTERN.exec(entry.name);
      if (!stats.isFile() || match === null) {
        diagnostics.push({
          code: 'unknown_entry_skipped',
          path: entry.name,
          message: 'Entry is not a Loom-owned memory file.',
        });
        continue;
      }
      if (stats.size > BigInt(this.limits.maxFileBytes)) {
        diagnostics.push({
          code: 'oversized_memory_skipped',
          path: entry.name,
          message: `Memory file exceeds ${this.limits.maxFileBytes} bytes.`,
        });
        continue;
      }

      let stable: StableMemoryFile;
      try {
        stable = await this.readStableMemoryFile(entryPath, match[1]!);
      } catch (error) {
        if (error instanceof MemoryConflictError) {
          throw error;
        }
        diagnostics.push({
          code: 'invalid_memory_skipped',
          path: entry.name,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (next.has(stable.memory.id)) {
        throw new MemoryStoreConfigError(`Duplicate memory ID: ${stable.memory.id}`);
      }
      if (totalBytes + stable.memory.fileBytes > this.limits.maxTotalBytes) {
        throw new MemoryStoreLimitError(
          `Memory store exceeds ${this.limits.maxTotalBytes} indexed bytes.`,
        );
      }
      totalBytes += stable.memory.fileBytes;
      next.set(stable.memory.id, stable.memory);
    }

    diagnostics.sort((left, right) => {
      const target = lexicalCompare(left.path, right.path);
      return target !== 0 ? target : lexicalCompare(left.code, right.code);
    });
    return this.publish(next, diagnostics, totalBytes, countedEntries.length);
  }

  private publish(
    memories: Map<string, InternalMemory>,
    diagnostics: MemoryDiagnostic[],
    totalBytes: number,
    entryCount: number,
  ): MemorySnapshot {
    const sorted = [...memories.values()].sort((left, right) => lexicalCompare(left.id, right.id));
    const snapshot = immutableSnapshot({
      generation: this.currentSnapshot.generation + 1,
      scannedAt: this.now().toISOString(),
      memories: sorted.map((memory) => this.summary(memory)),
      diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic })),
      totalBytes,
    });
    this.currentMemories = new Map(sorted.map((memory) => [memory.id, memory]));
    this.currentSnapshot = snapshot;
    this.currentEntryCount = entryCount;
    return snapshot;
  }

  private async createUnusedId(): Promise<string> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const id = `mem_${randomBytes(24).toString('base64url')}`;
      if (this.currentMemories.has(id)) {
        continue;
      }
      try {
        await lstat(path.join(this.memoryDirectory, `${id}.md`));
      } catch (error) {
        if (nestedErrorCode(error) === 'ENOENT') {
          return id;
        }
        throw error;
      }
    }
    throw new MemoryStoreConfigError('Unable to allocate a unique memory ID.');
  }

  private async readStableMemoryFile(
    filePath: string,
    expectedId: string,
  ): Promise<StableMemoryFile> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await assertNoSymlinkComponents(filePath);
      const discovered = await lstat(filePath, { bigint: true });
      if (discovered.isSymbolicLink() || !discovered.isFile()) {
        throw new MemoryStoreConfigError(`Memory is not a regular file: ${filePath}`);
      }
      if (discovered.uid !== BigInt(currentUserId())) {
        throw new MemoryStoreConfigError(`Memory is not owned by the current user: ${filePath}`);
      }
      if (discovered.size > BigInt(this.limits.maxFileBytes)) {
        throw new MemoryStoreLimitError(
          `Memory exceeds ${this.limits.maxFileBytes} bytes: ${filePath}`,
        );
      }
      if ((Number(discovered.mode) & 0o777) !== 0o600) {
        await chmod(filePath, 0o600);
      }

      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()
        || before.dev !== discovered.dev
        || before.ino !== discovered.ino) {
        throw new MemoryConflictError(`Memory changed before read: ${filePath}`);
      }
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      await assertNoSymlinkComponents(filePath);
      const pathname = await lstat(filePath, { bigint: true });
      if (!pathname.isFile()
        || !sameIdentity(before, after)
        || before.dev !== pathname.dev
        || before.ino !== pathname.ino
        || bytes.byteLength !== Number(before.size)) {
        throw new MemoryConflictError(`Memory changed during read: ${filePath}`);
      }

      let text: string;
      try {
        text = fatalUtf8Decoder.decode(bytes);
      } catch (error) {
        throw new MemoryStoreConfigError('Memory file is not valid UTF-8.', {
          cause: error instanceof Error ? error : undefined,
        });
      }
      const parsed = parseMemory(text, expectedId);
      return {
        memory: this.internalMemory(parsed, filePath, bytes.byteLength, sha256(bytes)),
        identity: before,
      };
    } catch (error) {
      if (error instanceof MemoryStoreConfigError) {
        throw error;
      }
      if (error instanceof PathPolicyError) {
        throw new MemoryStoreConfigError(error.message, { cause: error });
      }
      throw new MemoryStoreConfigError(`Unable to read memory ${filePath}: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private internalMemory(
    parsed: ParsedMemory,
    filePath: string,
    fileBytes: number,
    digest: string,
  ): InternalMemory {
    return {
      id: parsed.id,
      title: parsed.title,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      contentBytes: Buffer.byteLength(parsed.content),
      fileBytes,
      sha256: digest,
      filePath,
      content: parsed.content,
      normalizedTitle: parsed.title.toLocaleLowerCase('en-US'),
      normalizedContent: parsed.content.toLocaleLowerCase('en-US'),
    };
  }

  private summary(memory: InternalMemory): MemorySummary {
    return {
      id: memory.id,
      title: memory.title,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      contentBytes: memory.contentBytes,
      fileBytes: memory.fileBytes,
      sha256: memory.sha256,
    };
  }

  private scoreMemory(memory: InternalMemory, query: string, tokens: string[]): number {
    let score = 0;
    if (memory.id.toLocaleLowerCase('en-US') === query) {
      score += 1_200;
    }
    if (memory.normalizedTitle === query) {
      score += 1_000;
    }
    for (const token of tokens) {
      if (memory.normalizedTitle.includes(token)) {
        score += 120;
      }
      if (memory.normalizedContent.includes(token)) {
        score += 8;
      }
      if (memory.id.toLocaleLowerCase('en-US').includes(token)) {
        score += 10;
      }
    }
    return score;
  }
}

export function createMemoryToolDispatcher(
  service: MemoryStoreService,
  fallback: LoomToolDispatcher,
): LoomToolDispatcher {
  return async (name: LoomToolName, arguments_: Record<string, unknown>) => {
    if (name !== 'loom_memory') {
      return fallback(name, arguments_);
    }

    switch (arguments_.action) {
      case 'list':
        return service.list();
      case 'search':
        return service.search(arguments_ as unknown as SearchMemoryInput);
      case 'read':
        return service.read(arguments_ as unknown as ReadMemoryInput);
      case 'save':
        return service.save(arguments_ as unknown as SaveMemoryInput);
      case 'delete':
        return service.delete(arguments_ as unknown as DeleteMemoryInput);
      case 'rescan':
        return service.rescan();
      default:
        throw new MemoryStoreConfigError(`Unsupported loom_memory action: ${String(arguments_.action)}`);
    }
  };
}
