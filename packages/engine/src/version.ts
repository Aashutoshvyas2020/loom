import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function readLoomVersion(startDirectory = dirname(fileURLToPath(import.meta.url))): string {
  let current = startDirectory;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const packageJson = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (packageJson.name === "loommcp-cli" && typeof packageJson.version === "string") {
        return packageJson.version;
      }
    } catch {
      // Keep walking toward the package root.
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error("Unable to locate the loommcp-cli package version.");
}

export const LOOM_VERSION = readLoomVersion();
