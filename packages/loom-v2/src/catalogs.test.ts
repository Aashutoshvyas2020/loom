import { chmod, link, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoomMemory } from "./memory.js";
import { LoomSkills } from "./skills.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function temp(name: string) {
  const root = await mkdtemp(join(tmpdir(), `loom-${name}-`));
  roots.push(root);
  return root;
}

describe("LoomSkills", () => {
  it("bundles the default operating methodology and guardrails", async () => {
    const skills = new LoomSkills([]);
    await skills.rescan();
    const listed = skills.list();
    expect(listed.map((skill) => skill.name)).toEqual(expect.arrayContaining([
      "Ponytail", "Using Superpowers", "Caveman", "Cavekit", "Coding Guardrails",
    ]));
    const ponytail = listed.find((skill) => skill.name === "Ponytail")!;
    const activated = await skills.activate(ponytail.id);
    expect(activated.content[0].text).toContain("smallest correct solution");
    const cavekit = listed.find((skill) => skill.name === "Cavekit")!;
    expect((await skills.read(cavekit.id)).content[0].text).toContain("acceptance criteria");
    const guardrails = listed.find((skill) => skill.name === "Coding Guardrails")!;
    expect((await skills.read(guardrails.id)).content[0].text).toContain("Think Before Coding");
    expect(skills.diagnostics()).toMatchObject({ bundled: 5, activated: 1 });
  });

  it("returns compact search results and deterministic collision diagnostics", async () => {
    const first = await temp("skills-a");
    const second = await temp("skills-b");
    for (const [root, marker] of [[first, "winner"], [second, "loser"]] as const) {
      const directory = join(root, "deploy");
      await mkdir(directory);
      await writeFile(join(directory, "SKILL.md"), `---\nname: deploy\ndescription: Deploy apps ${marker}\n---\n# Deploy\n${marker}`);
    }
    const skills = new LoomSkills([first, second]);
    await skills.rescan();
    expect(skills.search("deploy")).toHaveLength(1);
    expect((await skills.read(skills.search("deploy")[0]!.id)).content[0].text).toContain("winner");
    expect(skills.diagnostics()).toMatchObject({ collisions: 1 });
  });
});

describe("LoomMemory", () => {
  it("maintains one private global MEMORY.md", async () => {
    const state = await temp("memory");
    const memory = new LoomMemory(state);

    expect(await memory.snapshot()).toBe("");
    expect(await memory.read()).toEqual({
      structuredContent: { text: "", bytes: 0 },
      content: [{ type: "text", text: "Memory is empty." }],
    });

    await memory.add("Use npm run verify before publishing.");
    await memory.add("Loom package name is loommcp-cli.");
    expect(memory.count).toBe(2);
    await memory.replace("npm run verify", "npm run verify:release");
    await memory.remove("Loom package name is loommcp-cli.");

    const text = "Use npm run verify:release before publishing.";
    expect(await memory.snapshot()).toBe(text);
    expect(await memory.read()).toEqual({
      structuredContent: { text, bytes: Buffer.byteLength(text) },
      content: [{ type: "text", text }],
    });
    expect(await readFile(join(state, "MEMORY.md"), "utf8")).toBe(`${text}\n`);
    expect((await stat(state)).mode & 0o777).toBe(0o700);
    expect((await stat(join(state, "MEMORY.md"))).mode & 0o777).toBe(0o600);
  });

  it("rejects ambiguous edits and unsafe content", async () => {
    const memory = new LoomMemory(await temp("memory-guards"));
    await memory.add("same\n§\nsame");

    await expect(memory.replace("same", "new")).rejects.toThrow(/multiple/i);
    await expect(memory.remove("same")).rejects.toThrow(/multiple/i);
    await expect(memory.replace("missing", "new")).rejects.toThrow(/not found/i);
    await expect(memory.remove("missing")).rejects.toThrow(/not found/i);
    await expect(memory.add("token sk-abcdefghijklmnopqrstuvwxyz123456")).rejects.toThrow(/secret/i);
    await expect(memory.add("contains\0nul")).rejects.toThrow(/NUL/i);
  });

  it("rejects common credentials", async () => {
    const memory = new LoomMemory(await temp("memory-credentials"));
    const credentials = [
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "AKIAABCDEFGHIJKLMNOP",
      "-----BEGIN PRIVATE KEY-----",
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      "gho_abcdefghijklmnopqrstuvwxyz1234567890",
      "ghu_abcdefghijklmnopqrstuvwxyz1234567890",
      "ghs_abcdefghijklmnopqrstuvwxyz1234567890",
      "ghr_abcdefghijklmnopqrstuvwxyz1234567890",
      "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      "glpat-abcdefghijklmnopqrstuvwxyz123456",
      ["xoxb-", "123456789012-123456789012-abcdefghijklmnopqrstuvwx"].join(""),
      "xapp-1-A1234567890-1234567890123-abcdefghijklmnopqrstuvwxyz123456",
      "npm_abcdefghijklmnopqrstuvwxyz1234567890",
      "hf_abcdefghijklmnopqrstuvwxyz1234567890",
      "gsk_abcdefghijklmnopqrstuvwxyz1234567890",
      "dckr_pat_abcdefghijklmnopqrstuvwxyz1234567890",
      "pypi-AgEIcHabcdefghijklmnopqrstuvwxyz1234567890",
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890",
      ["sk_live_", "abcdefghijklmnopqrstuvwxyz1234567890"].join(""),
      "ya29.abcdefghijklmnopqrstuvwxyz1234567890",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIzNDU2",
      "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
      "nvapi-abcdefghijklmnopqrstuvwxyz123456",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      "api_key=abcdefghijklmnopqrstuvwxyz123456",
      "access_key: abcdefghijklmnopqrstuvwxyz123456",
    ];

    for (const credential of credentials) {
      await expect(memory.add(credential)).rejects.toThrow(/secret/i);
    }
  });

  it("rejects a symlinked memory state directory", async () => {
    const root = await temp("memory-directory-symlink");
    const target = join(root, "target");
    const state = join(root, "state");
    await mkdir(target);
    await writeFile(join(target, "MEMORY.md"), "arbitrary target\n");
    await symlink(target, state);

    await expect(new LoomMemory(state).snapshot()).rejects.toThrow(/unsafe memory state/i);
  });

  it("rejects a symlink anywhere in the memory directory path", async () => {
    const root = await temp("memory-parent-symlink");
    const target = join(root, "target");
    const linkedParent = join(root, "linked-parent");
    await mkdir(target);
    await symlink(target, linkedParent);

    await expect(new LoomMemory(join(linkedParent, "memory")).snapshot()).rejects.toThrow(/unsafe memory state/i);
    await expect(stat(join(target, "memory"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a memory parent replaced by a symlink after loading", async () => {
    const root = await temp("memory-parent-swap");
    const state = join(root, "memory");
    const original = join(root, "memory-original");
    const target = join(root, "target");
    const memory = new LoomMemory(state);
    await memory.add("Existing fact");
    await mkdir(target);
    await rename(state, original);
    await symlink(target, state);

    await expect(memory.add("Redirected fact")).rejects.toThrow(/unsafe memory state/i);
    await expect(stat(join(target, "MEMORY.md"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(original, "MEMORY.md"), "utf8")).toBe("Existing fact\n");
  });

  it("rejects writable memory path ancestors", async () => {
    const root = await temp("memory-writable-ancestor");
    const unsafeParent = join(root, "unsafe-parent");
    await mkdir(unsafeParent);
    await chmod(unsafeParent, 0o777);

    await expect(new LoomMemory(join(unsafeParent, "memory")).snapshot()).rejects.toThrow(/unsafe memory state/i);
    await expect(stat(join(unsafeParent, "memory"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked MEMORY.md", async () => {
    const state = await temp("memory-file-symlink");
    const target = join(state, "arbitrary.txt");
    await writeFile(target, "arbitrary target\n");
    await symlink(target, join(state, "MEMORY.md"));

    await expect(new LoomMemory(state).snapshot()).rejects.toThrow(/unsafe memory state/i);
  });

  it("rejects a symlinked legacy memory.json", async () => {
    const state = await temp("memory-legacy-symlink");
    const target = join(state, "arbitrary.json");
    await writeFile(target, JSON.stringify([{ title: "Stolen", content: "Arbitrary target" }]));
    await symlink(target, join(state, "memory.json"));

    await expect(new LoomMemory(state).snapshot()).rejects.toThrow(/unsafe memory state/i);
    await expect(stat(join(state, "MEMORY.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("enforces the 16 KiB total limit", async () => {
    const memory = new LoomMemory(await temp("memory-limit"));
    await memory.add("x".repeat(16_384));
    await expect(memory.add("y")).rejects.toThrow(/16384/);
    expect(Buffer.byteLength(await memory.snapshot())).toBe(16_384);
  });

  it("serializes concurrent mutations without losing entries", async () => {
    const memory = new LoomMemory(await temp("memory-mutations-concurrent"));
    const entries = Array.from({ length: 24 }, (_, index) => `Durable fact ${index}`);

    await Promise.all(entries.map((entry) => memory.add(entry)));

    expect(new Set((await memory.snapshot()).split("\n§\n"))).toEqual(new Set(entries));
    expect(memory.count).toBe(entries.length);
  });

  it("serializes mutations across independent memory instances", async () => {
    const state = await temp("memory-mutations-cross-instance");
    const first = new LoomMemory(state);
    const second = new LoomMemory(state);
    await Promise.all([first.snapshot(), second.snapshot()]);

    await Promise.all([
      first.add("Fact from runtime one"),
      second.add("Fact from runtime two"),
    ]);

    expect(new Set((await new LoomMemory(state).snapshot()).split("\n§\n"))).toEqual(new Set([
      "Fact from runtime one",
      "Fact from runtime two",
    ]));
  });

  it("migrates legacy memory.json once", async () => {
    const state = await temp("memory-migration");
    const legacy = join(state, "memory.json");
    await writeFile(legacy, JSON.stringify([
      { title: "Release", content: "Verify tarball install." },
      { title: "Package", content: "Use loommcp-cli." },
    ]));

    const memory = new LoomMemory(state);
    const migrated = "## Release\nVerify tarball install.\n§\n## Package\nUse loommcp-cli.";
    expect(await memory.snapshot()).toBe(migrated);
    expect(await readFile(join(state, "MEMORY.md"), "utf8")).toBe(`${migrated}\n`);
    await expect(stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(state, "memory.json.migrated"))).resolves.toBeDefined();

    expect(await new LoomMemory(state).snapshot()).toBe(migrated);
  });

  it("serializes concurrent initial migration", async () => {
    const state = await temp("memory-migration-concurrent");
    const legacy = join(state, "memory.json");
    await writeFile(legacy, JSON.stringify([{ title: "Release", content: "Verify tarball install." }]));
    const memory = new LoomMemory(state);
    const migrated = "## Release\nVerify tarball install.";

    const snapshots = await Promise.all(Array.from({ length: 8 }, () => memory.snapshot()));

    expect(snapshots).toEqual(Array(8).fill(migrated));
    await expect(stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(state, "memory.json.migrated"))).resolves.toBeDefined();
  });

  it("never overwrites an existing legacy archive", async () => {
    const state = await temp("memory-migration-archive");
    const legacy = join(state, "memory.json");
    const archive = join(state, "memory.json.migrated");
    const legacyText = JSON.stringify([{ title: "Current", content: "Keep current memory." }]);
    const archiveText = JSON.stringify([{ title: "Archive", content: "Keep archived memory." }]);
    await writeFile(legacy, legacyText);
    await writeFile(archive, archiveText);

    await expect(new LoomMemory(state).snapshot()).rejects.toThrow(/archive.*already exists/i);
    expect(await readFile(legacy, "utf8")).toBe(legacyText);
    expect(await readFile(archive, "utf8")).toBe(archiveText);
    await expect(stat(join(state, "MEMORY.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resumes an interrupted hard-linked migration", async () => {
    const state = await temp("memory-migration-resume");
    const legacy = join(state, "memory.json");
    const archive = join(state, "memory.json.migrated");
    const legacyText = JSON.stringify([{ title: "Release", content: "Verify tarball install." }]);
    await writeFile(legacy, legacyText);
    await link(legacy, archive);

    const memory = new LoomMemory(state);
    const migrated = "## Release\nVerify tarball install.";
    expect(await memory.snapshot()).toBe(migrated);
    expect(await readFile(join(state, "MEMORY.md"), "utf8")).toBe(`${migrated}\n`);
    await expect(stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(archive, "utf8")).toBe(legacyText);
  });

  it("normalizes existing separator entries without rewriting clean memory", async () => {
    const state = await temp("memory-normalization");
    const path = join(state, "MEMORY.md");
    await writeFile(path, "\n§\nAlpha\n§\n\n§\nBeta\n§\n\n", { mode: 0o600 });
    const dirtyInode = (await stat(path)).ino;
    const memory = new LoomMemory(state);
    const normalized = "Alpha\n§\nBeta";

    expect(await memory.snapshot()).toBe(normalized);
    expect(memory.count).toBe(2);
    expect(await readFile(path, "utf8")).toBe(`${normalized}\n`);
    const cleanInode = (await stat(path)).ino;
    expect(cleanInode).not.toBe(dirtyInode);

    expect(await new LoomMemory(state).snapshot()).toBe(normalized);
    expect((await stat(path)).ino).toBe(cleanInode);
  });

  it("leaves oversized legacy memory intact", async () => {
    const state = await temp("memory-migration-limit");
    const legacy = join(state, "memory.json");
    await writeFile(legacy, JSON.stringify([{ title: "Large", content: "x".repeat(16_384) }]));

    await expect(new LoomMemory(state).snapshot()).rejects.toThrow(/16384/);
    await expect(stat(legacy)).resolves.toBeDefined();
    await expect(stat(join(state, "MEMORY.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
