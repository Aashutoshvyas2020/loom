import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import {
  AUDIT_RETENTION_DAYS,
  AUDIT_START_DEADLINE_MS,
  MAX_AUDIT_FILE_BYTES,
} from './limits.js';
import { PathPolicyError, assertNoSymlinkComponents, resolveUserPath } from './paths.js';

export class AuditUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuditUnavailableError';
  }
}

export interface AuditLoggerOptions {
  auditDirectory: string;
  queueCapacity?: number;
  startDeadlineMs?: number;
  maxFileBytes?: number;
  retentionDays?: number;
  now?: () => Date;
}

export interface AuditReceipt {
  operationId: string;
  operation: string;
  startedAtMs: number;
  timestamp: string;
}

export type AuditFinishStatus = 'ok' | 'error' | 'cancelled' | 'timed-out';

type AuditPhase = 'start' | 'finish' | 'read';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface AuditRecord {
  timestamp: string;
  sequence: number;
  phase: AuditPhase;
  operation: string;
  operationId: string;
  metadata?: JsonValue;
  status?: string;
  durationMs?: number;
}

interface QueueItem {
  record: AuditRecord;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface RequiredAuditOptions {
  auditDirectory: string;
  queueCapacity: number;
  startDeadlineMs: number;
  maxFileBytes: number;
  retentionDays: number;
  now: () => Date;
}

const DEFAULT_QUEUE_CAPACITY = 1_024;
const MAX_METADATA_DEPTH = 8;
const MAX_METADATA_KEYS = 50;
const MAX_METADATA_ARRAY = 50;
const MAX_METADATA_STRING = 512;
const auditFilename = /^(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$/;
const sensitiveKey = /(?:password|passwd|secret|token|authorization|cookie|environment|\benv\b|command|content|output|typed|screenshot|page.?text|body|header)/i;
const tokenLikeValue = /(?:\b(?:Bearer|Basic)\s+\S+|\bsk-[A-Za-z0-9_-]{8,}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)/i;

function currentUserId(): number {
  if (process.getuid === undefined) {
    throw new AuditUnavailableError('Audit ownership checks require a POSIX user ID.');
  }
  return process.getuid();
}

function cleanLabel(value: string, label: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (cleaned.length === 0) {
    throw new AuditUnavailableError(`${label} must not be empty.`);
  }
  return cleaned.slice(0, 128);
}

function sanitizeString(value: string): string {
  if (tokenLikeValue.test(value)) {
    return '[REDACTED]';
  }
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
  return cleaned.length <= MAX_METADATA_STRING
    ? cleaned
    : `${cleaned.slice(0, MAX_METADATA_STRING)}[TRUNCATED]`;
}

function sanitizeMetadata(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): JsonValue {
  if (key !== undefined && sensitiveKey.test(key)) {
    return '[REDACTED]';
  }
  if (depth > MAX_METADATA_DEPTH) {
    return '[REDACTED:DEPTH]';
  }
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'string':
      return sanitizeString(value);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'undefined':
    case 'function':
    case 'symbol':
      return '[UNSUPPORTED]';
    case 'object':
      break;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }
  if (seen.has(value)) {
    return '[REDACTED:CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_METADATA_ARRAY)
      .map((item) => sanitizeMetadata(item, undefined, depth + 1, seen));
    if (value.length > MAX_METADATA_ARRAY) {
      items.push('[TRUNCATED]');
    }
    return items;
  }

  const result: { [key: string]: JsonValue } = {};
  const entries = Object.entries(value).slice(0, MAX_METADATA_KEYS);
  for (const [entryKey, entryValue] of entries) {
    result[entryKey.slice(0, 128)] = sanitizeMetadata(
      entryValue,
      entryKey,
      depth + 1,
      seen,
    );
  }
  if (Object.keys(value).length > MAX_METADATA_KEYS) {
    result.__truncated__ = true;
  }
  return result;
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensurePrivateAuditDirectory(inputPath: string): Promise<string> {
  const auditDirectory = resolveUserPath(inputPath);
  try {
    await assertNoSymlinkComponents(auditDirectory);
    await mkdir(auditDirectory, { recursive: true, mode: 0o700 });
    await assertNoSymlinkComponents(auditDirectory);
    const stats = await lstat(auditDirectory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new AuditUnavailableError(`Audit path must be a real directory: ${auditDirectory}`);
    }
    if (stats.uid !== currentUserId()) {
      throw new AuditUnavailableError(`Audit directory is not owned by the current user: ${auditDirectory}`);
    }
    if ((stats.mode & 0o777) !== 0o700) {
      await chmod(auditDirectory, 0o700);
    }
    return await realpath(auditDirectory);
  } catch (error) {
    if (error instanceof AuditUnavailableError) {
      throw error;
    }
    if (error instanceof PathPolicyError) {
      throw new AuditUnavailableError(error.message, { cause: error });
    }
    throw new AuditUnavailableError(`Unable to initialize audit directory ${auditDirectory}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export class AuditLogger {
  readonly auditDirectory: string;

  private readonly options: RequiredAuditOptions;
  private readonly queue: QueueItem[] = [];
  private readonly idleWaiters: Array<() => void> = [];
  private processing = false;
  private pending = 0;
  private sequence = 0;
  private closed = false;
  private degradedState = false;

  private constructor(options: RequiredAuditOptions) {
    this.options = options;
    this.auditDirectory = options.auditDirectory;
  }

  static async create(options: AuditLoggerOptions): Promise<AuditLogger> {
    const required: RequiredAuditOptions = {
      auditDirectory: await ensurePrivateAuditDirectory(options.auditDirectory),
      queueCapacity: options.queueCapacity ?? DEFAULT_QUEUE_CAPACITY,
      startDeadlineMs: options.startDeadlineMs ?? AUDIT_START_DEADLINE_MS,
      maxFileBytes: options.maxFileBytes ?? MAX_AUDIT_FILE_BYTES,
      retentionDays: options.retentionDays ?? AUDIT_RETENTION_DAYS,
      now: options.now ?? (() => new Date()),
    };

    for (const [name, value] of [
      ['queueCapacity', required.queueCapacity],
      ['startDeadlineMs', required.startDeadlineMs],
      ['maxFileBytes', required.maxFileBytes],
      ['retentionDays', required.retentionDays],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new AuditUnavailableError(`${name} must be a positive safe integer.`);
      }
    }

    const logger = new AuditLogger(required);
    await logger.applyRetention();
    return logger;
  }

  get degraded(): boolean {
    return this.degradedState;
  }

  async recordMutationStart(operation: string, metadata: unknown): Promise<AuditReceipt> {
    if (this.degradedState || this.closed) {
      throw new AuditUnavailableError('Audit is unavailable; mutating operations are disabled.');
    }

    const timestamp = this.options.now();
    const receipt: AuditReceipt = {
      operationId: randomUUID(),
      operation: cleanLabel(operation, 'operation'),
      startedAtMs: timestamp.getTime(),
      timestamp: timestamp.toISOString(),
    };
    const write = this.enqueue({
      timestamp: receipt.timestamp,
      sequence: this.nextSequence(),
      phase: 'start',
      operation: receipt.operation,
      operationId: receipt.operationId,
      metadata: sanitizeMetadata(metadata, undefined, 0, new WeakSet()),
    });

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        write,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new AuditUnavailableError(
              `Audit start was not durable within ${this.options.startDeadlineMs} ms.`,
            ));
          }, this.options.startDeadlineMs);
        }),
      ]);
      return receipt;
    } catch (error) {
      this.degradedState = true;
      throw error instanceof AuditUnavailableError
        ? error
        : new AuditUnavailableError(`Unable to record mutation start: ${String(error)}`, {
          cause: error instanceof Error ? error : undefined,
        });
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  async recordFinish(receipt: AuditReceipt, status: AuditFinishStatus): Promise<boolean> {
    if (this.degradedState || this.closed) {
      return false;
    }
    const completedAt = this.options.now();
    const record: AuditRecord = {
      timestamp: completedAt.toISOString(),
      sequence: this.nextSequence(),
      phase: 'finish',
      operation: cleanLabel(receipt.operation, 'operation'),
      operationId: cleanLabel(receipt.operationId, 'operationId'),
      status: cleanLabel(status, 'status'),
      durationMs: Math.max(0, completedAt.getTime() - receipt.startedAtMs),
    };
    return this.enqueueBestEffort(record);
  }

  async recordRead(operation: string, metadata: unknown): Promise<boolean> {
    if (this.degradedState || this.closed) {
      return false;
    }
    const timestamp = this.options.now();
    return this.enqueueBestEffort({
      timestamp: timestamp.toISOString(),
      sequence: this.nextSequence(),
      phase: 'read',
      operation: cleanLabel(operation, 'operation'),
      operationId: randomUUID(),
      metadata: sanitizeMetadata(metadata, undefined, 0, new WeakSet()),
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.pending === 0) {
      return;
    }
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private async enqueueBestEffort(record: AuditRecord): Promise<boolean> {
    try {
      await this.enqueue(record);
      return true;
    } catch {
      this.degradedState = true;
      return false;
    }
  }

  private enqueue(record: AuditRecord): Promise<void> {
    if (this.closed) {
      return Promise.reject(new AuditUnavailableError('Audit logger is closed.'));
    }
    if (this.degradedState) {
      return Promise.reject(new AuditUnavailableError('Audit logger is degraded.'));
    }
    if (this.pending >= this.options.queueCapacity) {
      this.degradedState = true;
      return Promise.reject(new AuditUnavailableError('Audit queue is saturated.'));
    }

    this.pending += 1;
    const promise = new Promise<void>((resolve, reject) => {
      this.queue.push({ record, resolve, reject });
    });
    void this.processQueue();
    return promise;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await this.writeRecord(item.record);
        item.resolve();
      } catch (error) {
        const unavailable = error instanceof AuditUnavailableError
          ? error
          : new AuditUnavailableError(`Audit write failed: ${String(error)}`, {
            cause: error instanceof Error ? error : undefined,
          });
        this.degradedState = true;
        item.reject(unavailable);
        this.pending -= 1;

        for (const queued of this.queue.splice(0)) {
          queued.reject(unavailable);
          this.pending -= 1;
        }
        break;
      }
      this.pending -= 1;
    }

    this.processing = false;
    if (this.pending === 0) {
      for (const resolve of this.idleWaiters.splice(0)) {
        resolve();
      }
    }
  }

  private async writeRecord(record: AuditRecord): Promise<void> {
    const line = `${JSON.stringify(record)}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (lineBytes > this.options.maxFileBytes) {
      throw new AuditUnavailableError('One audit record exceeds the configured audit-file limit.');
    }

    const day = record.timestamp.slice(0, 10);
    const currentPath = path.join(this.auditDirectory, `${day}.jsonl`);
    await this.rotateIfRequired(currentPath, day, lineBytes);

    const flags = constants.O_WRONLY
      | constants.O_APPEND
      | constants.O_CREAT
      | constants.O_NOFOLLOW;
    const handle = await open(currentPath, flags, 0o600);
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.uid !== currentUserId()) {
        throw new AuditUnavailableError(`Audit target is not a current-user regular file: ${currentPath}`);
      }
      if ((stats.mode & 0o777) !== 0o600) {
        await handle.chmod(0o600);
      }
      await handle.writeFile(line);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(this.auditDirectory);
  }

  private async rotateIfRequired(currentPath: string, day: string, incomingBytes: number): Promise<void> {
    let currentSize = 0;
    try {
      await assertNoSymlinkComponents(currentPath);
      const stats = await lstat(currentPath);
      if (stats.isSymbolicLink() || !stats.isFile() || stats.uid !== currentUserId()) {
        throw new AuditUnavailableError(`Unsafe audit file: ${currentPath}`);
      }
      if ((stats.mode & 0o777) !== 0o600) {
        await chmod(currentPath, 0o600);
      }
      currentSize = stats.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    if (currentSize === 0 || currentSize + incomingBytes <= this.options.maxFileBytes) {
      return;
    }

    let index = 1;
    let rotatedPath: string;
    while (true) {
      rotatedPath = path.join(this.auditDirectory, `${day}.${index}.jsonl`);
      try {
        await lstat(rotatedPath);
        index += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          break;
        }
        throw error;
      }
    }
    await rename(currentPath, rotatedPath);
    await chmod(rotatedPath, 0o600);
    await syncDirectory(this.auditDirectory);
  }

  private async applyRetention(): Promise<void> {
    const cutoff = this.options.now().getTime() - this.options.retentionDays * 24 * 60 * 60 * 1_000;
    for (const name of await readdir(this.auditDirectory)) {
      const match = auditFilename.exec(name);
      if (match === null) {
        continue;
      }
      const filePath = path.join(this.auditDirectory, name);
      const date = Date.parse(`${match[1]}T00:00:00.000Z`);
      if (!Number.isFinite(date)) {
        continue;
      }
      if (date < cutoff) {
        await rm(filePath, { force: true });
        continue;
      }

      const stats = await lstat(filePath);
      if (stats.isSymbolicLink() || !stats.isFile() || stats.uid !== currentUserId()) {
        throw new AuditUnavailableError(`Unsafe retained audit file: ${filePath}`);
      }
      if ((stats.mode & 0o777) !== 0o600) {
        await chmod(filePath, 0o600);
      }
    }
  }
}
