import { stripVTControlCharacters } from 'node:util';

export type OutputSource = 'stdout' | 'stderr';
export type OutputState = 'running' | 'completed' | 'cancelled' | 'timed-out';

export interface OutputSegment {
  source: OutputSource;
  text: string;
}

export interface OutputSnapshot {
  totalBytes: number;
  retainedHead: string;
  retainedTail: string;
  truncated: boolean;
  firstAvailableCursor: number;
  state: OutputState;
  exitCode: number | null;
  signal: string | null;
}

export interface OutputRead {
  requestedCursor: number;
  availableFrom: number;
  nextCursor: number;
  gap: boolean;
  segments: OutputSegment[];
  totalBytes: number;
  truncated: boolean;
  state: OutputState;
  exitCode: number | null;
  signal: string | null;
}

interface StoredSegment {
  source: OutputSource;
  start: number;
  end: number;
  bytes: Buffer;
}

const unsafeControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function codePointByteLength(character: string): number {
  return Buffer.byteLength(character, 'utf8');
}

function prefixAtUtf8Boundary(bytes: Buffer, maximumBytes: number): Buffer {
  if (bytes.byteLength <= maximumBytes) {
    return bytes;
  }

  let used = 0;
  let characters = '';
  for (const character of bytes.toString('utf8')) {
    const length = codePointByteLength(character);
    if (used + length > maximumBytes) {
      break;
    }
    characters += character;
    used += length;
  }
  return Buffer.from(characters);
}

function bytesToDropAtUtf8Boundary(bytes: Buffer, minimumBytes: number): number {
  if (minimumBytes <= 0) {
    return 0;
  }
  if (minimumBytes >= bytes.byteLength) {
    return bytes.byteLength;
  }

  let dropped = 0;
  for (const character of bytes.toString('utf8')) {
    dropped += codePointByteLength(character);
    if (dropped >= minimumBytes) {
      return dropped;
    }
  }
  return bytes.byteLength;
}

function alignToUtf8Boundary(bytes: Buffer, offset: number): number {
  let aligned = Math.max(0, Math.min(offset, bytes.byteLength));
  while (aligned < bytes.byteLength && (bytes[aligned]! & 0xc0) === 0x80) {
    aligned += 1;
  }
  return aligned;
}

function sanitizeChunk(chunk: string | Uint8Array): Buffer {
  const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
  let text: string;

  try {
    if (bytes.includes(0)) {
      throw new TypeError('NUL byte');
    }
    text = fatalUtf8Decoder.decode(bytes);
  } catch {
    return Buffer.from(`[binary output suppressed: ${bytes.byteLength} bytes]\n`);
  }

  return Buffer.from(stripVTControlCharacters(text).replace(unsafeControls, ''));
}

export class BoundedOutput {
  readonly maximumBytes: number;
  readonly headLimitBytes: number;
  readonly tailLimitBytes: number;

  private readonly headParts: Buffer[] = [];
  private readonly tailSegments: StoredSegment[] = [];
  private headBytes = 0;
  private tailBytes = 0;
  private headClosed = false;
  private total = 0;
  private wasTruncated = false;
  private currentState: OutputState = 'running';
  private currentExitCode: number | null = null;
  private currentSignal: string | null = null;

  constructor(maximumBytes: number) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 2) {
      throw new RangeError('maximumBytes must be a safe integer of at least 2.');
    }

    this.maximumBytes = maximumBytes;
    this.headLimitBytes = Math.floor(maximumBytes / 2);
    this.tailLimitBytes = maximumBytes - this.headLimitBytes;
  }

  append(source: OutputSource, chunk: string | Uint8Array): void {
    if (this.currentState !== 'running') {
      throw new Error(`Cannot append output after state became ${this.currentState}.`);
    }

    const bytes = sanitizeChunk(chunk);
    if (bytes.byteLength === 0) {
      return;
    }

    this.captureHead(bytes);

    const start = this.total;
    this.total += bytes.byteLength;
    this.tailSegments.push({
      source,
      start,
      end: this.total,
      bytes,
    });
    this.tailBytes += bytes.byteLength;

    if (this.total > this.maximumBytes) {
      this.wasTruncated = true;
      this.trimTail();
    }
  }

  read(requestedCursor: number, maximumBytes = Number.MAX_SAFE_INTEGER): OutputRead {
    if (!Number.isSafeInteger(requestedCursor) || requestedCursor < 0) {
      throw new RangeError('requestedCursor must be a nonnegative safe integer.');
    }
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new RangeError('maximumBytes must be a positive safe integer.');
    }

    const availableFrom = this.firstAvailableCursor();
    const initialCursor = Math.min(Math.max(requestedCursor, availableFrom), this.total);
    let nextCursor = initialCursor;
    let remaining = maximumBytes;
    let gap = requestedCursor < availableFrom;
    const segments: OutputSegment[] = [];

    for (const segment of this.tailSegments) {
      if (segment.end <= nextCursor || remaining <= 0) {
        continue;
      }

      const rawOffset = Math.max(0, nextCursor - segment.start);
      const alignedOffset = alignToUtf8Boundary(segment.bytes, rawOffset);
      if (alignedOffset !== rawOffset) {
        gap = true;
      }

      const available = segment.bytes.subarray(alignedOffset);
      let selected = prefixAtUtf8Boundary(available, remaining);
      if (selected.byteLength === 0 && available.byteLength > 0) {
        const firstCharacter = [...available.toString('utf8')][0];
        selected = Buffer.from(firstCharacter ?? '');
      }
      if (selected.byteLength === 0) {
        continue;
      }

      segments.push({ source: segment.source, text: selected.toString('utf8') });
      nextCursor = segment.start + alignedOffset + selected.byteLength;
      remaining = Math.max(0, remaining - selected.byteLength);
    }

    return {
      requestedCursor,
      availableFrom,
      nextCursor,
      gap,
      segments,
      totalBytes: this.total,
      truncated: this.wasTruncated,
      state: this.currentState,
      exitCode: this.currentExitCode,
      signal: this.currentSignal,
    };
  }

  snapshot(): OutputSnapshot {
    return {
      totalBytes: this.total,
      retainedHead: Buffer.concat(this.headParts).toString('utf8'),
      retainedTail: Buffer.concat(this.tailSegments.map((segment) => segment.bytes)).toString('utf8'),
      truncated: this.wasTruncated,
      firstAvailableCursor: this.firstAvailableCursor(),
      state: this.currentState,
      exitCode: this.currentExitCode,
      signal: this.currentSignal,
    };
  }

  complete(exitCode: number | null, signal: string | null): void {
    this.currentState = 'completed';
    this.currentExitCode = exitCode;
    this.currentSignal = signal;
  }

  cancel(signal: string | null): void {
    this.currentState = 'cancelled';
    this.currentExitCode = null;
    this.currentSignal = signal;
  }

  timeout(signal: string | null): void {
    this.currentState = 'timed-out';
    this.currentExitCode = null;
    this.currentSignal = signal;
  }

  private captureHead(bytes: Buffer): void {
    if (this.headClosed) {
      return;
    }

    const remaining = this.headLimitBytes - this.headBytes;
    if (remaining <= 0) {
      this.headClosed = true;
      return;
    }

    const prefix = prefixAtUtf8Boundary(bytes, remaining);
    if (prefix.byteLength > 0) {
      this.headParts.push(prefix);
      this.headBytes += prefix.byteLength;
    }
    if (prefix.byteLength < bytes.byteLength || this.headBytes >= this.headLimitBytes) {
      this.headClosed = true;
    }
  }

  private trimTail(): void {
    let excess = this.tailBytes - this.tailLimitBytes;
    while (excess > 0 && this.tailSegments.length > 0) {
      const first = this.tailSegments[0]!;
      if (excess >= first.bytes.byteLength) {
        this.tailSegments.shift();
        this.tailBytes -= first.bytes.byteLength;
        excess -= first.bytes.byteLength;
        continue;
      }

      const dropped = bytesToDropAtUtf8Boundary(first.bytes, excess);
      first.bytes = first.bytes.subarray(dropped);
      first.start += dropped;
      this.tailBytes -= dropped;
      excess -= dropped;
      if (first.bytes.byteLength === 0) {
        this.tailSegments.shift();
      }
    }
  }

  private firstAvailableCursor(): number {
    return this.tailSegments[0]?.start ?? this.total;
  }
}
