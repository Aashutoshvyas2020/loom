import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHomePath } from "./roots.js";

export interface LoomUserConfig {
  host?: string;
  port?: number;
  allowedRoots?: string[];
  publicBaseUrl?: string | null;
  allowedHosts?: string[];
  stateDir?: string;
  autoUpdate?: boolean;
}

export interface LoomAuthConfig {
  ownerToken?: string;
}

export interface LoomFiles {
  dir: string;
  configPath: string;
  authPath: string;
  configExists: boolean;
  authExists: boolean;
  config: LoomUserConfig;
  auth: LoomAuthConfig;
}

export function loomConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(expandHomePath(env.LOOM_CONFIG_DIR ?? join(homedir(), ".loom")));
}

export function loomConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(loomConfigDir(env), "config.json");
}

export function loomAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(loomConfigDir(env), "auth.json");
}

export function loomSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(loomConfigDir(env), "skills");
}

export function loomHooksDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(loomConfigDir(env), "hooks");
}

export function loomHookAgentsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(loomHooksDir(env), "AGENTS.md");
}

export function listLoomSkillNames(env: NodeJS.ProcessEnv = process.env): string[] {
  const dir = loomSkillsDir(env);
  if (!existsSync(dir)) return [];

  return findSkillFiles(dir)
    .map(readSkillLabel)
    .sort();
}

export function loadLoomFiles(env: NodeJS.ProcessEnv = process.env): LoomFiles {
  const dir = loomConfigDir(env);
  const configPath = join(dir, "config.json");
  const authPath = join(dir, "auth.json");
  const configExists = existsSync(configPath);
  const authExists = existsSync(authPath);

  return {
    dir,
    configPath,
    authPath,
    configExists,
    authExists,
    config: configExists ? readJsonFile<LoomUserConfig>(configPath) : {},
    auth: authExists ? readJsonFile<LoomAuthConfig>(authPath) : {},
  };
}

export function writeLoomConfig(
  config: LoomUserConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const filePath = loomConfigPath(env);
  mkdirSync(loomConfigDir(env), { recursive: true });
  writeJsonFile(filePath, config, 0o600);
  return filePath;
}

export function writeLoomAuth(
  auth: LoomAuthConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const filePath = loomAuthPath(env);
  mkdirSync(loomConfigDir(env), { recursive: true });
  writeJsonFile(filePath, auth, 0o600);
  return filePath;
}

export function generateOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createLoomSkill(name: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new Error("Skill name must use letters, numbers, dot, dash, or underscore.");
  }

  const filePath = join(loomSkillsDir(env), name, "SKILL.md");
  if (existsSync(filePath)) return filePath;

  mkdirSync(join(loomSkillsDir(env), name), { recursive: true });
  writeFileSync(
    filePath,
    [
      "---",
      `name: ${name}`,
      "description: Use when this Loom skill matches the task.",
      "---",
      "",
      `# ${name}`,
      "",
      "Add instructions here.",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  return filePath;
}

export function ensureLoomHookAgents(env: NodeJS.ProcessEnv = process.env): string {
  const filePath = loomHookAgentsPath(env);
  if (existsSync(filePath)) return filePath;

  mkdirSync(loomHooksDir(env), { recursive: true });
  writeFileSync(
    filePath,
    [
      "# Loom Agent Instructions",
      "",
      "- Use Loom as the local coding workspace.",
      "- Prefer project instructions and task-specific skills when present.",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  return filePath;
}

function readJsonFile<T>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${filePath}: ${reason}`);
  }
}

function findSkillFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findSkillFiles(path));
    if (entry.isFile() && entry.name === "SKILL.md") files.push(path);
  }
  return files;
}

function readSkillLabel(filePath: string): string {
  const content = readFileSync(filePath, "utf8");
  const name = frontmatterValue(content, "name") ?? filePath.split("/").at(-2) ?? "unnamed";
  const description = frontmatterValue(content, "description");
  return description ? `${name}: ${description}` : name;
}

function frontmatterValue(content: string, key: string): string | undefined {
  const lines = content.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) return undefined;

  const value = lines[index].slice(key.length + 1).trim();
  if (value !== ">" && value !== "|") return value.replace(/^["']|["']$/g, "").trim();

  const block: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (!line.startsWith(" ") && line.trim() !== "") break;
    const trimmed = line.trim();
    if (trimmed) block.push(trimmed);
  }
  return block.join(" ");
}

function writeJsonFile(filePath: string, value: unknown, mode: number): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", { mode });
}
