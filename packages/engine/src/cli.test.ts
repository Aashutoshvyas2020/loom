import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleStartupUpdate } from "./update.js";

const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
  version: string;
};

for (const flag of ["-v", "--version"]) {
  const output = execFileSync("node", ["--import", "tsx", "src/cli.ts", flag], {
    encoding: "utf8",
    env: { ...process.env, LOOM_CONFIG_DIR: "/tmp/loom-cli-version-test" },
  }).trim();

  assert.equal(output, packageJson.version);
}

const configDir = mkdtempSync(join(tmpdir(), "loom-cli-skill-test-"));
const skillPath = execFileSync("node", ["--import", "tsx", "src/cli.ts", "skill", "init", "browser-control"], {
  encoding: "utf8",
  env: { ...process.env, LOOM_CONFIG_DIR: configDir },
}).trim();

assert.match(skillPath, /Created .+browser-control\/SKILL\.md$/);
assert.equal(existsSync(join(configDir, "skills", "browser-control", "SKILL.md")), true);
assert.equal(existsSync(join(configDir, "hooks", "AGENTS.md")), true);

assert.equal(
  execFileSync("node", ["--import", "tsx", "src/cli.ts", "skill", "list"], {
    encoding: "utf8",
    env: { ...process.env, LOOM_CONFIG_DIR: configDir },
  }).trim(),
  "browser-control: Use when this Loom skill matches the task.",
);

assert.equal(
  execFileSync("node", ["--import", "tsx", "src/cli.ts", "skill", "path"], {
    encoding: "utf8",
    env: { ...process.env, LOOM_CONFIG_DIR: configDir },
  }).trim(),
  join(configDir, "skills"),
);

execFileSync("node", ["--import", "tsx", "src/cli.ts", "config", "set", "autoUpdate", "true"], {
  encoding: "utf8",
  env: { ...process.env, LOOM_CONFIG_DIR: configDir },
});
const persistedConfig = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")) as { autoUpdate?: boolean };
assert.equal(persistedConfig.autoUpdate, true);

const doctorOutput = execFileSync("node", ["--import", "tsx", "src/cli.ts", "doctor"], {
  encoding: "utf8",
  env: {
    ...process.env,
    LOOM_CONFIG_DIR: configDir,
    LOOM_STATE_DIR: configDir,
    LOOM_ALLOWED_ROOTS: configDir,
    LOOM_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  },
});
assert.match(doctorOutput, new RegExp(`Runtime log: ${join(configDir, "loom\\.log")}`));
assert.match(doctorOutput, new RegExp(`Tunnel log: ${join(configDir, "cloudflared\\.log")}`));

const updateDir = mkdtempSync(join(tmpdir(), "loom-cli-update-test-"));
const updateBin = join(updateDir, "bin");
const npmArgsPath = join(updateDir, "npm-args.txt");
const fakeNpm = join(updateBin, "npm");
mkdirSync(updateBin);
writeFileSync(fakeNpm, `#!/bin/sh\nprintf '%s' "$*" > "$LOOM_TEST_NPM_ARGS"\n`);
chmodSync(fakeNpm, 0o700);
const updateOutput = execFileSync("node", ["--import", "tsx", "src/cli.ts", "update"], {
  encoding: "utf8",
  env: {
    ...process.env,
    PATH: `${updateBin}:${process.env.PATH ?? ""}`,
    LOOM_CONFIG_DIR: updateDir,
    LOOM_TEST_NPM_ARGS: npmArgsPath,
  },
});
assert.equal(readFileSync(npmArgsPath, "utf8"), "update -g loommcp-cli");
assert.match(updateOutput, /Loom updated successfully/);

const updateCheckDir = mkdtempSync(join(tmpdir(), "loom-cli-update-check-test-"));
const updateNotices: string[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => { updateNotices.push(args.map(String).join(" ")); };
try {
  assert.equal(await handleStartupUpdate("1.0.0", false, {
    ...process.env,
    LOOM_CONFIG_DIR: updateCheckDir,
    LOOM_UPDATE_REGISTRY_URL: "data:application/json,%7B%22version%22%3A%229.0.0%22%7D",
  }), false);
} finally {
  console.error = originalConsoleError;
}
assert.match(updateNotices.join("\n"), /npm update -g loommcp-cli/);

const autoUpdateDir = mkdtempSync(join(tmpdir(), "loom-cli-auto-update-test-"));
const autoUpdateArgsPath = join(autoUpdateDir, "npm-args.txt");
assert.equal(await handleStartupUpdate("1.0.0", true, {
  ...process.env,
  PATH: `${updateBin}:${process.env.PATH ?? ""}`,
  LOOM_CONFIG_DIR: autoUpdateDir,
  LOOM_TEST_NPM_ARGS: autoUpdateArgsPath,
  LOOM_UPDATE_REGISTRY_URL: "data:application/json,%7B%22version%22%3A%229.0.0%22%7D",
}), true);
assert.equal(readFileSync(autoUpdateArgsPath, "utf8"), "update -g loommcp-cli");

const launchDir = mkdtempSync(join(tmpdir(), "loom-cli-launch-test-"));
const binDir = join(launchDir, "bin");
const tunnelArgsPath = join(launchDir, "tunnel-args.txt");
const fakeCloudflared = join(binDir, "cloudflared");
mkdirSync(binDir);
writeFileSync(fakeCloudflared, `#!/bin/sh\nprintf '%s' "$*" > "$LOOM_TEST_TUNNEL_ARGS"\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n`);
chmodSync(fakeCloudflared, 0o700);
const argsLaunch = spawn("node", ["--import", "tsx", "src/cli.ts", "launch"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    PORT: "47676",
    LOOM_CONFIG_DIR: launchDir,
    LOOM_STATE_DIR: launchDir,
    LOOM_ALLOWED_ROOTS: launchDir,
    LOOM_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    LOOM_PUBLIC_BASE_URL: "https://loom.example.com",
    LOOM_DISABLE_UPDATE_CHECK: "1",
    LOOM_TEST_TUNNEL_ARGS: tunnelArgsPath,
  },
});
let argsLaunchOutput = "";
argsLaunch.stdout?.on("data", (chunk) => { argsLaunchOutput += chunk.toString(); });
argsLaunch.stderr?.on("data", (chunk) => { argsLaunchOutput += chunk.toString(); });
for (let attempt = 0; attempt < 500 && !existsSync(tunnelArgsPath) && argsLaunch.exitCode === null; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
assert.equal(existsSync(tunnelArgsPath), true, `loom launch should use the default named tunnel: ${argsLaunchOutput}`);
argsLaunch.kill("SIGTERM");
const argsLaunchExit = await new Promise<number | null>((resolve) => argsLaunch.once("exit", resolve));
assert.equal(argsLaunchExit, 0, `loom launch should shut down cleanly: ${argsLaunchOutput}`);
assert.doesNotMatch(argsLaunchOutput, /Raw mode is not supported/, "non-interactive launch must not render the TUI");
assert.doesNotMatch(argsLaunchOutput, /"event":"server_started"/, "launch diagnostics belong in the private log, not behind the dashboard");
assert.equal(readFileSync(tunnelArgsPath, "utf8"), `tunnel --loglevel info --logfile ${join(launchDir, "cloudflared.log")} run loom`);

const shutdownDir = mkdtempSync(join(tmpdir(), "loom-cli-shutdown-test-"));
const shutdownBin = join(shutdownDir, "bin");
const shutdownTunnel = join(shutdownBin, "cloudflared");
const shutdownPidPath = join(shutdownDir, "tunnel.pid");
mkdirSync(shutdownBin);
writeFileSync(shutdownTunnel, `#!/bin/sh\necho $$ > "$LOOM_TEST_TUNNEL_PID"\ntrap '' TERM\nwhile :; do sleep 1; done\n`);
chmodSync(shutdownTunnel, 0o700);

const launched = spawn("node", ["--import", "tsx", "src/cli.ts", "launch"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PATH: `${shutdownBin}:${process.env.PATH ?? ""}`,
    PORT: "47677",
    LOOM_CONFIG_DIR: shutdownDir,
    LOOM_STATE_DIR: shutdownDir,
    LOOM_ALLOWED_ROOTS: shutdownDir,
    LOOM_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    LOOM_PUBLIC_BASE_URL: "https://loom.example.com",
    LOOM_DISABLE_UPDATE_CHECK: "1",
    LOOM_TEST_TUNNEL_PID: shutdownPidPath,
  },
});
let launchStderr = "";
launched.stderr?.on("data", (chunk) => { launchStderr += chunk.toString(); });
for (let attempt = 0; attempt < 500 && !existsSync(shutdownPidPath) && launched.exitCode === null; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
assert.equal(existsSync(shutdownPidPath), true, `fake tunnel should start: ${launchStderr}`);
launched.kill("SIGTERM");
const launchedExit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
  launched.once("exit", (code, signal) => resolve({ code, signal }));
});
assert.deepEqual(launchedExit, { code: 0, signal: null }, "launcher shutdown should succeed after forced tunnel cleanup");
const tunnelPid = Number(readFileSync(shutdownPidPath, "utf8"));
assert.throws(() => process.kill(tunnelPid, 0), "tunnel process should be gone");

const occupiedDir = mkdtempSync(join(tmpdir(), "loom-cli-occupied-test-"));
const occupiedBin = join(occupiedDir, "bin");
const occupiedMarker = join(occupiedDir, "tunnel-started");
mkdirSync(occupiedBin);
writeFileSync(join(occupiedBin, "cloudflared"), `#!/bin/sh\nprintf started > "$LOOM_TEST_TUNNEL_MARKER"\n`);
chmodSync(join(occupiedBin, "cloudflared"), 0o700);
const occupiedServer = createHttpServer();
await new Promise<void>((resolve) => occupiedServer.listen(0, "127.0.0.1", resolve));
const occupiedPort = (occupiedServer.address() as AddressInfo).port;
const occupiedLaunch = spawn("node", ["--import", "tsx", "src/cli.ts", "launch"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PATH: `${occupiedBin}:${process.env.PATH ?? ""}`,
    PORT: String(occupiedPort),
    LOOM_CONFIG_DIR: occupiedDir,
    LOOM_STATE_DIR: occupiedDir,
    LOOM_ALLOWED_ROOTS: occupiedDir,
    LOOM_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    LOOM_PUBLIC_BASE_URL: "https://loom.example.com",
    LOOM_DISABLE_UPDATE_CHECK: "1",
    LOOM_TEST_TUNNEL_MARKER: occupiedMarker,
  },
});
const occupiedExit = await new Promise<number | null>((resolve) => occupiedLaunch.once("exit", resolve));
await new Promise<void>((resolve, reject) => occupiedServer.close((error) => error ? reject(error) : resolve()));
assert.notEqual(occupiedExit, 0, "occupied local port should fail launch");
assert.equal(existsSync(occupiedMarker), false, "port ownership must be proven before cloudflared starts");

const retryDir = mkdtempSync(join(tmpdir(), "loom-cli-tunnel-retry-test-"));
const retryBin = join(retryDir, "bin");
const retryCountPath = join(retryDir, "tunnel-count");
mkdirSync(retryBin);
writeFileSync(join(retryBin, "cloudflared"), `#!/bin/sh\ncount=0\nif [ -f "$LOOM_TEST_TUNNEL_COUNT" ]; then read count < "$LOOM_TEST_TUNNEL_COUNT"; fi\ncount=$((count + 1))\nprintf '%s' "$count" > "$LOOM_TEST_TUNNEL_COUNT"\nif [ "$count" -eq 1 ]; then exit 1; fi\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n`);
chmodSync(join(retryBin, "cloudflared"), 0o700);
const portProbe = createHttpServer();
await new Promise<void>((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const retryPort = (portProbe.address() as AddressInfo).port;
await new Promise<void>((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));
const retryLaunch = spawn("node", ["--import", "tsx", "src/cli.ts", "launch"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PATH: `${retryBin}:${process.env.PATH ?? ""}`,
    PORT: String(retryPort),
    LOOM_CONFIG_DIR: retryDir,
    LOOM_STATE_DIR: retryDir,
    LOOM_ALLOWED_ROOTS: retryDir,
    LOOM_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    LOOM_PUBLIC_BASE_URL: "https://loom.example.com",
    LOOM_DISABLE_UPDATE_CHECK: "1",
    LOOM_TEST_TUNNEL_COUNT: retryCountPath,
  },
});
let retryHealthy = false;
for (let attempt = 0; attempt < 300 && retryLaunch.exitCode === null; attempt += 1) {
  if (existsSync(retryCountPath) && Number(readFileSync(retryCountPath, "utf8")) >= 2) {
    try {
      retryHealthy = (await fetch(`http://127.0.0.1:${retryPort}/healthz`)).ok;
      if (retryHealthy) break;
    } catch { /* server is still starting */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
}
if (retryLaunch.exitCode === null) retryLaunch.kill("SIGTERM");
await new Promise<void>((resolve) => retryLaunch.exitCode === null ? retryLaunch.once("exit", () => resolve()) : resolve());
assert.equal(Number(readFileSync(retryCountPath, "utf8")), 2, "one transient cloudflared exit should restart once");
assert.equal(retryHealthy, true, "local server must stay healthy while cloudflared restarts");
