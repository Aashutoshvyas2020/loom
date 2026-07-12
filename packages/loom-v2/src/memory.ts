import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface MemoryRecord { id: string; title: string; content: string; createdAt: string; updatedAt: string }
const MAX_MEMORY_BYTES = 1024 * 1024;
const SECRET = /(?:\bsk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:password|secret|token)\s*[:=]\s*[^\s]{12,})/i;

export class LoomMemory {
  readonly #directory: string;
  readonly #path: string;
  #records: MemoryRecord[] = [];
  #loaded = false;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(stateDirectory: string) {
    this.#directory = stateDirectory;
    this.#path = join(stateDirectory, "memory.json");
  }

  async list(limit = 100): Promise<Array<Omit<MemoryRecord, "content">>> {
    await this.#load();
    return this.#records.slice(0, limit).map(({ content: _content, ...record }) => record);
  }

  async search(query: string, limit = 20): Promise<Array<Omit<MemoryRecord, "content">>> {
    await this.#load();
    const terms = query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}._-]+/gu) ?? [];
    return this.#records
      .filter((record) => terms.every((term) => `${record.title}\n${record.content}`.toLowerCase().includes(term)))
      .slice(0, limit)
      .map(({ content: _content, ...record }) => record);
  }

  async read(id: string): Promise<any> {
    await this.#load();
    const record = this.#records.find((candidate) => candidate.id === id);
    if (!record) throw new Error(`Memory not found: ${id}`);
    const { content, ...metadata } = record;
    return { structuredContent: metadata, content: [{ type: "text", text: content }] };
  }

  async save(title: string, content: string): Promise<MemoryRecord> {
    await this.#load();
    if (!title.trim()) throw new Error("Memory title is required");
    if (Buffer.byteLength(content) > MAX_MEMORY_BYTES) throw new Error(`Memory exceeds ${MAX_MEMORY_BYTES} bytes`);
    if (SECRET.test(content)) throw new Error("Memory contains an obvious secret and was not saved");
    const now = new Date().toISOString();
    const record = { id: `mem_${randomUUID()}`, title: title.trim(), content, createdAt: now, updatedAt: now };
    this.#records.unshift(record);
    await this.#persist();
    return record;
  }

  async delete(id: string): Promise<void> {
    await this.#load();
    const index = this.#records.findIndex((record) => record.id === id);
    if (index === -1) throw new Error(`Memory not found: ${id}`);
    this.#records.splice(index, 1);
    await this.#persist();
  }

  get count(): number { return this.#records.length; }

  async #load(): Promise<void> {
    if (this.#loaded) return;
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    await chmod(this.#directory, 0o700);
    try {
      const value = JSON.parse(await readFile(this.#path, "utf8"));
      this.#records = Array.isArray(value) ? value : [];
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  async #persist(): Promise<void> {
    this.#writeChain = this.#writeChain.then(async () => {
      const temp = `${this.#path}.${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify(this.#records, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, this.#path);
      await chmod(this.#path, 0o600);
    });
    await this.#writeChain;
  }
}
