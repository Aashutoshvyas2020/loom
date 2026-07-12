import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { imageResult, textResult } from "./results.js";

const MAX_READ_BYTES = 10 * 1024 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

export interface ReadInput { path: string; offset?: number; length?: number; encoding?: "utf8" | "base64" }
export interface WriteInput { path: string; content: string; createParents?: boolean; expectedSha256?: string }
export interface EditInput { path: string; oldText: string; newText: string; replaceAll?: boolean; expectedSha256?: string }

type FileResult = { structuredContent: Record<string, any>; content: Array<Record<string, any>> };

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function expandPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith(`~${sep}`)) return join(homedir(), path.slice(2));
  if (!isAbsolute(path)) throw new Error("Loom paths must be absolute or start with ~/");
  return resolve(path);
}

function isInside(path: string, root: string): boolean {
  const result = relative(root, path);
  return result === "" || (!result.startsWith(`..${sep}`) && result !== ".." && !isAbsolute(result));
}

function imageInfo(data: Buffer): { mimeType: string; width: number; height: number } | undefined {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: "image/png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  const gif = data.subarray(0, 6).toString("ascii");
  if (data.length >= 10 && (gif === "GIF87a" || gif === "GIF89a")) {
    return { mimeType: "image/gif", width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (data.length >= 30 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    const kind = data.subarray(12, 16).toString("ascii");
    if (kind === "VP8X") {
      return { mimeType: "image/webp", width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    }
    if (kind === "VP8L" && data[20] === 0x2f) {
      const b0 = data[21]!, b1 = data[22]!, b2 = data[23]!, b3 = data[24]!;
      return { mimeType: "image/webp", width: 1 + b0 + ((b1 & 0x3f) << 8), height: 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10) };
    }
    if (kind === "VP8 " && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
      return { mimeType: "image/webp", width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    }
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 8 < data.length) {
      if (data[cursor] !== 0xff) { cursor += 1; continue; }
      const marker = data[cursor + 1]!;
      cursor += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (cursor + 2 > data.length) break;
      const size = data.readUInt16BE(cursor);
      if (size < 2 || cursor + size > data.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { mimeType: "image/jpeg", width: data.readUInt16BE(cursor + 5), height: data.readUInt16BE(cursor + 3) };
      }
      cursor += size;
    }
  }
  return undefined;
}

export class LoomFiles {
  readonly #roots: string[];
  readonly #reads = new Map<string, { sha256: string; toolCallCount: number }>();

  constructor(allowedRoots: string[]) {
    if (allowedRoots.length === 0) throw new Error("At least one Loom root is required");
    this.#roots = allowedRoots.map(expandPath);
  }

  async read(input: ReadInput, toolCallCount?: number): Promise<FileResult> {
    const requested = expandPath(input.path);
    const canonical = await realpath(requested);
    const projectRoot = await this.#assertCanonicalAllowed(canonical);
    const handle = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) throw new Error("Loom can only read regular files");
      if (stats.size > MAX_READ_BYTES) throw new Error(`File exceeds ${MAX_READ_BYTES} byte read limit`);
      const data = await handle.readFile();
      const digest = sha256(data);
      const readKey = `${projectRoot}\0${canonical}`;
      const previous = this.#reads.get(readKey);
      if (toolCallCount !== undefined && previous?.sha256 === digest && toolCallCount - previous.toolCallCount <= 10) {
        return {
          structuredContent: { unchanged: true, sha256: digest },
          content: [{ type: "text", text: "File has not changed since last read." }],
        };
      }
      if (toolCallCount !== undefined) this.#reads.set(readKey, { sha256: digest, toolCallCount });
      const image = imageInfo(data);
      if (image) {
        return imageResult({
          data: data.toString("base64"),
          ...image,
          sha256: digest,
          bytes: data.length,
        }) as FileResult;
      }

      const offset = input.offset ?? 0;
      if (!Number.isInteger(offset) || offset < 0 || offset > data.length) throw new Error("Read offset is outside the file");
      const length = input.length ?? Math.min(MAX_READ_BYTES, data.length - offset);
      if (!Number.isInteger(length) || length < (input.length === undefined ? 0 : 1) || length > MAX_READ_BYTES) throw new Error("Invalid read length");
      const chunk = data.subarray(offset, Math.min(data.length, offset + length));
      const encoding = input.encoding ?? "utf8";
      const value = encoding === "base64"
        ? chunk.toString("base64")
        : new TextDecoder("utf-8", { fatal: true }).decode(chunk);
      return textResult({
        text: value,
        bytes: chunk.length,
        totalBytes: data.length,
        offset,
        truncated: offset + chunk.length < data.length,
        encoding,
        sha256: digest,
      }) as FileResult;
    } finally {
      await handle.close();
    }
  }

  async write(input: WriteInput): Promise<FileResult> {
    const content = Buffer.from(input.content, "utf8");
    if (content.length > MAX_WRITE_BYTES) throw new Error(`Write exceeds ${MAX_WRITE_BYTES} byte limit`);
    const target = await this.#mutationPath(input.path, input.createParents ?? false);
    await this.#checkConflict(target, input.expectedSha256);
    const temp = join(dirname(target), `.loom-${randomUUID()}.tmp`);
    const handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, target);
      await chmod(target, 0o600);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    const digest = sha256(content);
    return { structuredContent: { bytes: content.length, sha256: digest }, content: [{ type: "text", text: `Wrote ${content.length} bytes` }] };
  }

  async edit(input: EditInput): Promise<FileResult> {
    const target = await this.#mutationPath(input.path, false);
    const current = await this.read({ path: target });
    if (current.structuredContent.encoding !== "utf8") throw new Error("Loom edits require a UTF-8 text file");
    const currentText = String(current.content[0]?.text ?? "");
    if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== current.structuredContent.sha256) {
      throw new Error("Edit conflict: expected SHA-256 does not match current file");
    }
    let matches = 0;
    let cursor = 0;
    while ((cursor = currentText.indexOf(input.oldText, cursor)) !== -1) { matches += 1; cursor += input.oldText.length; }
    if (matches === 0) throw new Error("Edit text was not found");
    if (matches > 1 && !input.replaceAll) throw new Error(`Edit is ambiguous: ${matches} matches found`);
    const next = input.replaceAll ? currentText.split(input.oldText).join(input.newText) : currentText.replace(input.oldText, input.newText);
    const result = await this.write({ path: target, content: next, expectedSha256: current.structuredContent.sha256 });
    return {
      structuredContent: { ...result.structuredContent, replacements: input.replaceAll ? matches : 1 },
      content: [{ type: "text", text: `Replaced ${input.replaceAll ? matches : 1} occurrence${matches === 1 ? "" : "s"}` }],
    };
  }

  async #assertCanonicalAllowed(path: string): Promise<string> {
    for (const root of this.#roots) {
      try {
        const canonicalRoot = await realpath(root);
        if (isInside(path, canonicalRoot)) return canonicalRoot;
      } catch { /* try next configured root */ }
    }
    throw new Error("Path is outside configured Loom roots");
  }

  async #mutationPath(inputPath: string, createParents: boolean): Promise<string> {
    const target = expandPath(inputPath);
    const root = this.#roots.find((candidate) => isInside(target, candidate));
    if (!root) throw new Error("Path is outside configured Loom roots");
    const rootCanonical = await realpath(root);
    if (!isInside(target, root)) throw new Error("Path is outside configured Loom roots");
    const parent = dirname(target);
    const pieces = relative(root, parent).split(sep).filter(Boolean);
    let current = rootCanonical;
    for (const piece of pieces) {
      current = join(current, piece);
      try {
        const stats = await lstat(current);
        if (stats.isSymbolicLink()) throw new Error(`Mutation path contains a symbolic link: ${current}`);
        if (!stats.isDirectory()) throw new Error(`Mutation parent is not a directory: ${current}`);
      } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
        if (!createParents) throw error;
        await mkdir(current, { mode: 0o700 });
      }
    }
    try {
      const stats = await lstat(target);
      if (stats.isSymbolicLink()) throw new Error("Loom will not mutate a symbolic link");
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    return target;
  }

  async #checkConflict(path: string, expectedSha256: string | undefined): Promise<void> {
    if (!expectedSha256) return;
    try {
      const current = await this.read({ path });
      if (current.structuredContent.sha256 !== expectedSha256.toLowerCase()) throw new Error("Write conflict: expected SHA-256 does not match current file");
    } catch (error: any) {
      if (error?.code === "ENOENT") throw new Error("Write conflict: target does not exist");
      throw error;
    }
  }
}
