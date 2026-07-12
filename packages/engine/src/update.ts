import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gt, valid } from "semver";
import { loomConfigDir } from "./user-config.js";

const PACKAGE_NAME = "loommcp-cli";
const CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

type UpdateCache = {
  checkedAt: number;
  latestVersion?: string;
};

export async function handleStartupUpdate(
  currentVersion: string,
  autoUpdate: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (env.LOOM_DISABLE_UPDATE_CHECK === "1") return false;

  const latestVersion = await getLatestVersion(env);
  if (!latestVersion || !valid(currentVersion) || !gt(latestVersion, currentVersion)) return false;

  if (!autoUpdate) {
    console.error(
      [
        `Update available: Loom ${currentVersion} → ${latestVersion}`,
        "Run: npm update -g loommcp-cli",
      ].join("\n"),
    );
    return false;
  }

  console.log(`Updating Loom ${currentVersion} → ${latestVersion}…`);
  try {
    runNpmUpdate(env);
    clearUpdateCache(env);
    console.log("Loom updated successfully. Run `loom launch` again.");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Automatic update failed: ${message}`);
    console.error("Continuing with the installed version.");
    return false;
  }
}

export function runNpmUpdate(env: NodeJS.ProcessEnv = process.env): void {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["update", "-g", PACKAGE_NAME], {
    env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm update exited with status ${result.status ?? "unknown"}`);
  }
}

export function clearUpdateCache(env: NodeJS.ProcessEnv = process.env): void {
  rmSync(updateCachePath(env), { force: true });
}

async function getLatestVersion(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const cached = readUpdateCache(env);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached.latestVersion && valid(cached.latestVersion) ? cached.latestVersion : undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  timeout.unref();
  try {
    const response = await fetch(env.LOOM_UPDATE_REGISTRY_URL ?? DEFAULT_REGISTRY_URL, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      writeUpdateCache({ checkedAt: Date.now() }, env);
      return undefined;
    }

    const payload = await response.json() as {
      version?: unknown;
      "dist-tags"?: { latest?: unknown };
    };
    const latestVersion = typeof payload.version === "string"
      ? payload.version
      : typeof payload["dist-tags"]?.latest === "string"
        ? payload["dist-tags"].latest
        : undefined;
    if (!latestVersion || !valid(latestVersion)) {
      writeUpdateCache({ checkedAt: Date.now() }, env);
      return undefined;
    }

    writeUpdateCache({ checkedAt: Date.now(), latestVersion }, env);
    return latestVersion;
  } catch {
    writeUpdateCache({ checkedAt: Date.now() }, env);
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function updateCachePath(env: NodeJS.ProcessEnv): string {
  return join(loomConfigDir(env), "update-check.json");
}

function readUpdateCache(env: NodeJS.ProcessEnv): UpdateCache | undefined {
  try {
    const value = JSON.parse(readFileSync(updateCachePath(env), "utf8")) as Partial<UpdateCache>;
    if (typeof value.checkedAt !== "number") return undefined;
    if (value.latestVersion !== undefined && typeof value.latestVersion !== "string") return undefined;
    return value.latestVersion === undefined
      ? { checkedAt: value.checkedAt }
      : { checkedAt: value.checkedAt, latestVersion: value.latestVersion };
  } catch {
    return undefined;
  }
}

function writeUpdateCache(cache: UpdateCache, env: NodeJS.ProcessEnv): void {
  const dir = loomConfigDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(updateCachePath(env), JSON.stringify(cache, null, 2) + "\n", { mode: 0o600 });
}
