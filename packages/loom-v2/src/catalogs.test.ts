import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  it("bundles and activates Ponytail, Using Superpowers, and Caveman", async () => {
    const skills = new LoomSkills([]);
    await skills.rescan();
    const listed = skills.list();
    expect(listed.map((skill) => skill.name)).toEqual(expect.arrayContaining(["Ponytail", "Using Superpowers", "Caveman"]));
    const ponytail = listed.find((skill) => skill.name === "Ponytail")!;
    const activated = await skills.activate(ponytail.id);
    expect(activated.content[0].text).toContain("smallest correct solution");
    expect(skills.diagnostics()).toMatchObject({ bundled: 3, activated: 1 });
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
  it("saves, lists, searches, reads, and deletes Loom-owned memory", async () => {
    const state = await temp("memory");
    const memory = new LoomMemory(state);
    const saved = await memory.save("Release", "Run verification before publishing");
    expect(await memory.list()).toMatchObject([{ id: saved.id, title: "Release" }]);
    expect(await memory.search("verification")).toMatchObject([{ id: saved.id }]);
    expect((await memory.read(saved.id)).content[0].text).toContain("publishing");
    await memory.delete(saved.id);
    expect(await memory.list()).toEqual([]);
  });

  it("rejects obvious secrets", async () => {
    const memory = new LoomMemory(await temp("memory-secret"));
    await expect(memory.save("Nope", "token sk-abcdefghijklmnopqrstuvwxyz123456")).rejects.toThrow(/secret/i);
  });
});
