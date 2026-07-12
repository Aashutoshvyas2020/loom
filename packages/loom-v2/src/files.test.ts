import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoomFiles } from "./files.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-files-"));
  roots.push(root);
  return { root, files: new LoomFiles([root]) };
}

describe("LoomFiles", () => {
  it("returns bounded UTF-8 and explicit base64 in model-visible content", async () => {
    const { root, files } = await fixture();
    const path = join(root, "hello.txt");
    await writeFile(path, "hello Loom", "utf8");

    const text = await files.read({ path, offset: 6, length: 4 });
    expect(text.content).toEqual([{ type: "text", text: "Loom" }]);
    expect(text.structuredContent).toMatchObject({ text: "Loom", bytes: 4, totalBytes: 10, truncated: false, encoding: "utf8" });

    const base64 = await files.read({ path, encoding: "base64" });
    expect(base64.content).toEqual([{ type: "text", text: Buffer.from("hello Loom").toString("base64") }]);
    expect(base64.structuredContent.text).toBe(Buffer.from("hello Loom").toString("base64"));
  });

  it("returns an empty page when the offset is exactly EOF", async () => {
    const { root, files } = await fixture();
    const path = join(root, "page.txt");
    await writeFile(path, "abc", "utf8");
    const result = await files.read({ path, offset: 3 });
    expect(result.content).toEqual([{ type: "text", text: "" }]);
    expect(result.structuredContent).toMatchObject({ bytes: 0, offset: 3, truncated: false });
  });

  it("detects a PNG by magic bytes and returns visible image content", async () => {
    const { root, files } = await fixture();
    const path = join(root, "not-an-image.txt");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQtQAAAAASUVORK5CYII=", "base64");
    await writeFile(path, png);

    const result = await files.read({ path });
    expect(result.content).toEqual([{ type: "image", data: png.toString("base64"), mimeType: "image/png" }]);
    expect(result.structuredContent).toMatchObject({ mimeType: "image/png", width: 1, height: 1, bytes: png.length });
  });

  it("rejects reads and mutations outside configured roots", async () => {
    const { files } = await fixture();
    await expect(files.read({ path: "/etc/hosts" })).rejects.toThrow(/outside configured Loom roots/i);
    await expect(files.write({ path: "/tmp/loom-escape.txt", content: "no" })).rejects.toThrow(/outside configured Loom roots/i);
  });

  it("atomically writes and exactly edits with optimistic conflicts", async () => {
    const { root, files } = await fixture();
    const path = join(root, "nested", "note.txt");
    const written = await files.write({ path, content: "one two", createParents: true });
    expect(await readFile(path, "utf8")).toBe("one two");

    await expect(files.edit({ path, oldText: "two", newText: "three", expectedSha256: "0".repeat(64) }))
      .rejects.toThrow(/conflict/i);

    const edited = await files.edit({ path, oldText: "two", newText: "three", expectedSha256: written.structuredContent.sha256 });
    expect(edited.structuredContent).toMatchObject({ replacements: 1 });
    expect(await readFile(path, "utf8")).toBe("one three");
  });

  it("rejects ambiguous edits unless replaceAll is explicit", async () => {
    const { root, files } = await fixture();
    const path = join(root, "repeat.txt");
    await writeFile(path, "x x", "utf8");
    await expect(files.edit({ path, oldText: "x", newText: "y" })).rejects.toThrow(/2 matches/i);
    await files.edit({ path, oldText: "x", newText: "y", replaceAll: true });
    expect(await readFile(path, "utf8")).toBe("y y");
  });
});
