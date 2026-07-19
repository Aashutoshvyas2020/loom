import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const tunnelPidPath = join(scratch, "tunnel.pid");
  writeFileSync(cloudflared, "#!/bin/sh\necho $$ > \"$LOOM_TEST_TUNNEL_PID\"\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n");
  chmodSync(cloudflared, 0o700);
  const launched = spawn(loom, ["launch"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PORT: "47679",
      LOOM_CONFIG_DIR: join(scratch, "config"),
      LOOM_STATE_DIR: join(scratch, "state"),
      LOOM_ALLOWED_ROOTS: scratch,
      LOOM_OAUTH_OWNER_TOKEN: "package-owner-token-that-is-long-enough",
      LOOM_PUBLIC_BASE_URL: "https://loom.example.com",
      LOOM_DISABLE_UPDATE_CHECK: "1",
      LOOM_TEST_TUNNEL_PID: tunnelPidPath,
    },
  });
  let launchOutput = "";
  launched.stdout.on("data", (chunk) => { launchOutput += chunk.toString(); });
  launched.stderr.on("data", (chunk) => { launchOutput += chunk.toString(); });
  for (let attempt = 0; attempt < 500 && !existsSync(tunnelPidPath) && launched.exitCode === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(existsSync(tunnelPidPath), true, `installed package did not launch: ${launchOutput}`);
  launched.kill("SIGTERM");
  const launchExit = await new Promise((resolve) => launched.once("exit", resolve));
  assert.equal(launchExit, 0, `installed package did not shut down cleanly: ${launchOutput}`);
  console.log(`package install and launch passed: ${archive}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
