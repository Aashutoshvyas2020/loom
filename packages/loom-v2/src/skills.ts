import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { BUNDLED_SKILLS } from "./bundled-skills.js";

export interface LoomSkillSummary { id: string; name: string; description: string; bundled: boolean; source: string }
type LoomSkill = LoomSkillSummary & { content: string };

function compact(skill: LoomSkill): LoomSkillSummary {
  const { content: _content, ...summary } = skill;
  return summary;
}

function frontmatter(content: string, fallback: string): { name: string; description: string } {
  const block = content.startsWith("---\n") ? content.slice(4, content.indexOf("\n---\n", 4)) : "";
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") || fallback;
  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "Local skill";
  return { name, description };
}

function key(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

export class LoomSkills {
  readonly #roots: string[];
  readonly #skills = new Map<string, LoomSkill>();
  readonly #active = new Set<string>();
  #collisions = 0;
  #malformed = 0;

  constructor(roots: string[]) {
    this.#roots = roots;
  }

  async rescan(): Promise<void> {
    this.#skills.clear();
    this.#collisions = 0;
    this.#malformed = 0;
    for (const skill of BUNDLED_SKILLS) {
      this.#skills.set(key(skill.name), { ...skill, bundled: true, source: "loom" });
    }
    for (const root of this.#roots) await this.#scan(root, root, 0);
    for (const id of [...this.#active]) {
      if (![...this.#skills.values()].some((skill) => skill.id === id)) this.#active.delete(id);
    }
  }

  list(limit = 100): LoomSkillSummary[] {
    return [...this.#skills.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit).map(compact);
  }

  search(query: string, limit = 20): LoomSkillSummary[] {
    const terms = query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}._-]+/gu) ?? [];
    if (terms.length === 0) return [];
    return [...this.#skills.values()]
      .filter((skill) => terms.every((term) => `${skill.name}\n${skill.description}`.toLowerCase().includes(term)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
      .map(compact);
  }

  async read(id: string): Promise<any> {
    const skill = this.#find(id);
    return { structuredContent: { ...compact(skill), active: this.#active.has(skill.id) }, content: [{ type: "text", text: skill.content }] };
  }

  async activate(id: string): Promise<any> {
    const skill = this.#find(id);
    this.#active.add(skill.id);
    return { structuredContent: { ...compact(skill), active: true }, content: [{ type: "text", text: skill.content }] };
  }

  diagnostics() {
    const values = [...this.#skills.values()];
    return {
      total: values.length,
      bundled: values.filter((skill) => skill.bundled).length,
      external: values.filter((skill) => !skill.bundled).length,
      collisions: this.#collisions,
      malformed: this.#malformed,
      activated: this.#active.size,
    };
  }

  #find(id: string): LoomSkill {
    const skill = [...this.#skills.values()].find((candidate) => candidate.id === id || key(candidate.name) === key(id));
    if (!skill) throw new Error(`Skill not found: ${id}`);
    return skill;
  }

  async #scan(root: string, directory: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { return; }
    const skillFile = entries.find((entry) => entry.isFile() && entry.name === "SKILL.md");
    if (skillFile) {
      try {
        const path = join(directory, skillFile.name);
        const content = (await readFile(path, "utf8")).slice(0, 256 * 1024);
        const metadata = frontmatter(content, basename(directory));
        const normalized = key(metadata.name);
        if (!normalized) { this.#malformed += 1; return; }
        if (this.#skills.has(normalized)) { this.#collisions += 1; return; }
        const hash = createHash("sha256").update(path).digest("hex").slice(0, 12);
        this.#skills.set(normalized, { id: `skill:${normalized}:${hash}`, ...metadata, bundled: false, source: root, content });
      } catch { this.#malformed += 1; }
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue;
      await this.#scan(root, join(directory, entry.name), depth + 1);
    }
  }
}
