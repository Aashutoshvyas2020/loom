import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const scratch = mkdtempSync(join(tmpdir(), "loom-package-"));

try {
  const archive = execFileSync("npm", ["pack", "--silent", "--pack-destination", scratch], { cwd: root, encoding: "utf8" }).trim().split("\n").at(-1);
  assert(archive, "npm pack did not return an archive");
  const archivePath = join(scratch, archive);
  const entries = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
  assert.match(entries, /^package\/dist\/cli\.js$/m);
  assert.doesNotMatch(entries, /^package\/(?:src|packages)\//m);
  assert.doesNotMatch(entries, /^package\/node_modules\/@loom-local\//m);

  const prefix = join(scratch, "install");
  execFileSync("npm", ["install", "--loglevel=error", "--prefix", prefix, archivePath], { stdio: "pipe" });
  const loom = join(prefix, "node_modules", ".bin", "loom");
  assert.equal(execFileSync(loom, ["--version"], { encoding: "utf8" }).trim(), version);

  const bin = join(scratch, "bin");
  mkdirSync(bin);
  const cloudflared = join(bin, "cloudflared");
  writeFileSync(cloudflared, "#!/bin/sh\nexit 0\n");
  chmodSync(cloudflared, 0o700);
  execFileSync(loom, ["launch"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PORT: "47679",
      LOOM_CONFIG_DIR: join(scratch, "config"),
      LOOM_STATE_DIR: join(scratch, "state"),
      LOOM_ALLOWED_ROOTS: scratch,
      LOOM_OAUTH_OWNER_TOKEN: "package-owner-token-that-is-long-enough",
      LOOM_PUBLIC_BASE_URL: "https://loom.example.com",
    },
  });
  console.log(`package install and launch passed: ${archive}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
