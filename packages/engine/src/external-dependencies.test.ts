import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectExternalDependencies } from "./external-dependencies.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("external dependency inspection", () => {
  it("reports Bash, cloudflared, and pbcopy with actionable status", async () => {
    const bin = await mkdtemp(join(tmpdir(), "loom-dependencies-"));
    roots.push(bin);
    const bash = join(bin, "bash");
    await writeFile(bash, "#!/bin/sh\nexit 0\n");
    await chmod(bash, 0o700);

    expect(inspectExternalDependencies({ PATH: bin })).toEqual([
      expect.objectContaining({ command: "bash", found: true, path: bash, purpose: expect.stringMatching(/terminal/i), install: expect.any(String) }),
      expect.objectContaining({ command: "cloudflared", found: false, purpose: expect.stringMatching(/tunnel/i), install: expect.any(String) }),
      expect.objectContaining({ command: "pbcopy", found: false, purpose: expect.stringMatching(/clipboard/i), install: expect.any(String) }),
    ]);
  });
});
