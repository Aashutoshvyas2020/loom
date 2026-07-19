import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { chmod, link, lstat, mkdir, open, rename, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

const MAX_MEMORY_BYTES = 16 * 1024;
const ENTRY_SEPARATOR = "\n§\n";
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 10_000;
const SECRET = new RegExp([
  String.raw`\bsk-[A-Za-z0-9_-]{20,}`,
  String.raw`\bsk-ant-[A-Za-z0-9_-]{20,}`,
  String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}`,
  String.raw`-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----`,
  String.raw`\bgh[opusr]_[A-Za-z0-9]{20,}`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}`,
  String.raw`\bglpat-[A-Za-z0-9_-]{20,}`,
  String.raw`\bxox[baprs]-[A-Za-z0-9-]{20,}`,
  String.raw`\bxapp-[A-Za-z0-9-]{20,}`,
  String.raw`\b(?:npm|hf|gsk)_[A-Za-z0-9_-]{20,}`,
  String.raw`\bdckr_pat_[A-Za-z0-9_-]{20,}`,
  String.raw`\bpypi-[A-Za-z0-9_-]{20,}`,
  String.raw`\b(?:sk|rk)_live_[A-Za-z0-9_-]{20,}`,
  String.raw`\bya29\.[A-Za-z0-9_-]{20,}`,
  String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
  String.raw`\bAIza[A-Za-z0-9_-]{20,}`,
  String.raw`\bnvapi-[A-Za-z0-9_-]{20,}`,
  String.raw`\bBearer\s+[A-Za-z0-9._~+/=-]{12,}`,
  String.raw`\b(?:password|secret|token|api[_-]?key|access[_-]?key)\s*[:=]\s*["']?[^\s"']{12,}`,
].join("|"), "i");

interface MemoryReadResult {
  structuredContent: { text: string; bytes: number };
  content: [{ type: "text"; text: string }];
}

export class LoomMemory {
  readonly #directory: string;
  readonly #path: string;
  readonly #legacyPath: string;
  #text = "";
  #loaded = false;
  #loadPromise?: Promise<void>;
  #operationChain: Promise<void> = Promise.resolve();

  constructor(stateDirectory: string) {
    this.#directory = stateDirectory;
    this.#path = join(stateDirectory, "MEMORY.md");
    this.#legacyPath = join(stateDirectory, "memory.json");
  }

  get count(): number { return this.#text ? this.#text.split(ENTRY_SEPARATOR).length : 0; }

  async snapshot(): Promise<string> {
    await this.#load();
    return this.#serialize(() => withMemoryLock(this.#directory, async () => {
      const current = await this.#readStored();
      this.#text = current.text;
      return this.#text;
    }));
  }

  async read(): Promise<MemoryReadResult> {
    const text = await this.snapshot();
    return {
      structuredContent: { text, bytes: Buffer.byteLength(text) },
      content: [{ type: "text", text: text || "Memory is empty." }],
    };
  }

  async add(content: string): Promise<void> {
    const entry = requiredText(content);
    await this.#load();
    await this.#update((text) => text ? `${text}${ENTRY_SEPARATOR}${entry}` : entry);
  }

  async replace(oldText: string, newText: string): Promise<void> {
    const oldValue = requiredText(oldText);
    const newValue = newText.trim();
    await this.#load();
    await this.#update((text) => {
      const first = text.indexOf(oldValue);
      if (first === -1) throw new Error("Memory text not found");
      if (text.indexOf(oldValue, first + 1) !== -1) throw new Error("Memory text occurs multiple times");
      return `${text.slice(0, first)}${newValue}${text.slice(first + oldValue.length)}`;
    });
  }

  async remove(oldText: string): Promise<void> {
    await this.replace(oldText, "");
  }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    const pending = this.#loadPromise ??= this.#loadOnce();
    try {
      await pending;
    } catch (error) {
      if (this.#loadPromise === pending) this.#loadPromise = undefined;
      throw error;
    }
  }

  async #loadOnce(): Promise<void> {
    await ensurePrivateStateDirectory(this.#directory);
    await withMemoryLock(this.#directory, () => this.#loadLocked());
    this.#loaded = true;
  }

  async #loadLocked(): Promise<void> {
    const current = await this.#readStored();
    if (current.exists) {
      this.#text = current.text;
      return;
    }

    let legacy: unknown;
    try {
      legacy = JSON.parse(await readPrivateFile(this.#legacyPath));
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        this.#text = "";
        return;
      }
      throw error;
    }
    if (!Array.isArray(legacy)) throw new Error("Legacy memory.json must contain an array of records");
    const entries = legacy.map((record, index) => renderLegacyRecord(record, index)).filter(Boolean);
    const archivePath = `${this.#legacyPath}.migrated`;
    let createdArchive = false;
    try {
      await link(this.#legacyPath, archivePath);
      createdArchive = true;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const [legacyStat, archiveStat] = await Promise.all([lstat(this.#legacyPath), lstat(archivePath)]);
      const uid = currentUserId();
      if (!legacyStat.isFile() || !archiveStat.isFile() || legacyStat.uid !== uid || archiveStat.uid !== uid) {
        throw unsafeMemoryState("legacy memory files must be regular current-user files");
      }
      if (legacyStat.dev !== archiveStat.dev || legacyStat.ino !== archiveStat.ino) {
        throw new Error("Legacy memory archive already exists: memory.json.migrated");
      }
    }
    try {
      await this.#set(entries.join(ENTRY_SEPARATOR));
    } catch (error) {
      if (createdArchive) await unlink(archivePath).catch(() => undefined);
      throw error;
    }
    await unlink(this.#legacyPath);
  }

  async #update(update: (text: string) => string): Promise<void> {
    await this.#serialize(() => withMemoryLock(this.#directory, async () => {
      const current = await this.#readStored();
      await this.#set(update(current.text));
    }));
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.#operationChain.then(operation);
    this.#operationChain = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async #readStored(): Promise<{ exists: boolean; text: string }> {
    try {
      const stored = await readPrivateFile(this.#path);
      const text = stored.endsWith("\n") ? stored.slice(0, -1) : stored;
      const normalized = normalize(text);
      validate(normalized);
      if (normalized !== text) await this.#set(normalized);
      return { exists: true, text: normalized };
    } catch (error: any) {
      if (error?.code === "ENOENT") return { exists: false, text: "" };
      throw error;
    }
  }

  async #set(text: string): Promise<void> {
    const normalized = normalize(text);
    validate(normalized);
    await ensurePrivateStateDirectory(this.#directory);
    const temp = `${this.#path}.${randomUUID()}.tmp`;
    await writeFile(temp, normalized ? `${normalized}\n` : "", { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, this.#path);
    this.#text = normalized;
  }
}

async function withMemoryLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  await ensurePrivateStateDirectory(directory);
  const lockPath = join(directory, ".MEMORY.md.lock");
  const lock = await acquireMemoryLock(lockPath);
  try {
    return await operation();
  } finally {
    await releaseMemoryLock(lockPath, lock);
  }
}

async function acquireMemoryLock(path: string): Promise<{ handle: FileHandle; stats: Stats }> {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw unsafeMemoryState("memory storage requires O_NOFOLLOW support");
  }
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    let handle: FileHandle | undefined;
    try {
      handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`);
      await handle.chmod(0o600);
      return { handle, stats: await handle.stat() };
    } catch (error: any) {
      if (handle) {
        await handle.close().catch(() => undefined);
        await unlink(path).catch(() => undefined);
      }
      if (error?.code !== "EEXIST") throw unsafeMemoryState("cannot acquire memory lock", error);
      if (await removeStaleMemoryLock(path)) continue;
      if (Date.now() >= deadline) throw unsafeMemoryState("timed out waiting for memory lock");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
  }
}

async function removeStaleMemoryLock(path: string): Promise<boolean> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.uid !== currentUserId()) {
    throw unsafeMemoryState("memory lock must be a regular current-user file");
  }
  let pid: number | undefined;
  try {
    const parsed = JSON.parse(await readPrivateFile(path)) as { pid?: unknown };
    if (typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0) pid = parsed.pid;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const staleByAge = Date.now() - stats.mtimeMs > LOCK_STALE_MS;
  if (!staleByAge && (pid === undefined || processIsAlive(pid))) return false;
  const current = await lstat(path);
  if (current.dev !== stats.dev || current.ino !== stats.ino) return false;
  await unlink(path);
  return true;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code !== "ESRCH";
  }
}

async function releaseMemoryLock(path: string, lock: { handle: FileHandle; stats: Stats }): Promise<void> {
  await lock.handle.close();
  try {
    const current = await lstat(path);
    if (current.dev !== lock.stats.dev || current.ino !== lock.stats.ino) {
      throw unsafeMemoryState("memory lock changed while held");
    }
    await unlink(path);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function currentUserId(): number {
  if (process.getuid === undefined) throw unsafeMemoryState("memory storage requires a POSIX user ID");
  return process.getuid();
}

function unsafeMemoryState(message: string, cause?: unknown): Error {
  return new Error(`Unsafe memory state: ${message}`, { cause: cause instanceof Error ? cause : undefined });
}

function assertPrivateDirectory(stats: Stats): void {
  if (stats.isSymbolicLink() || !stats.isDirectory() || stats.uid !== currentUserId()) {
    throw unsafeMemoryState("memory directory must be a real current-user directory");
  }
}

export async function ensurePrivateStateDirectory(directory: string): Promise<void> {
  try {
    await ensureSafeDirectoryPath(directory);
    const stats = await lstat(directory);
    assertPrivateDirectory(stats);
    if ((stats.mode & 0o777) !== 0o700) await chmod(directory, 0o700);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unsafe memory state:")) throw error;
    throw unsafeMemoryState("cannot create private memory directory", error);
  }
}

async function ensureSafeDirectoryPath(directory: string): Promise<void> {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  let current = root;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    let stats: Stats;
    try {
      stats = await lstat(current);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      stats = await lstat(current);
    }
    if (stats.isSymbolicLink()) {
      const parent = await lstat(dirname(current));
      const trustedSystemLink = stats.uid === 0 && parent.uid === 0 && (parent.mode & 0o022) === 0;
      const target = trustedSystemLink ? await stat(current) : undefined;
      if (!target || !target.isDirectory()) {
        throw unsafeMemoryState("memory directory path must not contain untrusted symbolic links");
      }
      assertSafeAncestor(target);
    } else if (!stats.isDirectory()) {
      throw unsafeMemoryState("memory directory path components must be directories");
    } else {
      assertSafeAncestor(stats);
    }
  }
}

function assertSafeAncestor(stats: Stats): void {
  const mode = stats.mode & 0o7777;
  const ownedByTrustedUser = stats.uid === 0 || stats.uid === currentUserId();
  const writableByOthers = (mode & 0o022) !== 0;
  const protectedSystemTemp = stats.uid === 0 && (mode & 0o1000) !== 0;
  if (!ownedByTrustedUser || (writableByOthers && !protectedSystemTemp)) {
    throw unsafeMemoryState("memory directory ancestors must have trusted ownership and permissions");
  }
}

async function readPrivateFile(path: string): Promise<string> {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw unsafeMemoryState("memory storage requires O_NOFOLLOW support");
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: any) {
    if (error?.code === "ENOENT") throw error;
    throw unsafeMemoryState("cannot safely open memory file", error);
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.uid !== currentUserId()) throw unsafeMemoryState("memory file must be a regular current-user file");
    if ((stats.mode & 0o777) !== 0o600) await handle.chmod(0o600);
    return await handle.readFile("utf8");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unsafe memory state:")) throw error;
    throw unsafeMemoryState("cannot safely read memory file", error);
  } finally {
    await handle.close();
  }
}

function requiredText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error("Memory text is required");
  return text;
}

function normalize(text: string): string {
  return text.split(ENTRY_SEPARATOR).filter(Boolean).join(ENTRY_SEPARATOR);
}

function validate(text: string): void {
  if (text.includes("\0")) throw new Error("Memory contains NUL");
  if (SECRET.test(text)) throw new Error("Memory contains an obvious secret and was not saved");
  if (Buffer.byteLength(text) > MAX_MEMORY_BYTES) throw new Error(`Memory exceeds ${MAX_MEMORY_BYTES} bytes`);
}

export function assertSafeMemoryText(text: string): void {
  validate(text);
}

function renderLegacyRecord(value: unknown, index: number): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid legacy memory record at index ${index}`);
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.content !== "string") throw new Error(`Invalid legacy memory record at index ${index}`);
  const title = record.title.trim();
  if (!title) return record.content;
  return record.content ? `## ${title}\n${record.content}` : `## ${title}`;
}
