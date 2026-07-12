import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
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

const launchDir = mkdtempSync(join(tmpdir(), "loom-cli-launch-test-"));
const binDir = join(launchDir, "bin");
const tunnelArgsPath = join(launchDir, "tunnel-args.txt");
const fakeCloudflared = join(binDir, "cloudflared");
mkdirSync(binDir);
writeFileSync(fakeCloudflared, `#!/bin/sh\nprintf '%s' "$*" > "$LOOM_TEST_TUNNEL_ARGS"\n`);
chmodSync(fakeCloudflared, 0o700);

let launchError: unknown;
try {
  execFileSync("node", ["--import", "tsx", "src/cli.ts", "launch"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      PORT: "47676",
      LOOM_CONFIG_DIR: launchDir,
      LOOM_ALLOWED_ROOTS: launchDir,
      LOOM_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
      LOOM_PUBLIC_BASE_URL: "https://loom.example.com",
      LOOM_TEST_TUNNEL_ARGS: tunnelArgsPath,
    },
  });
} catch (error) {
  launchError = error;
}
assert.equal(launchError, undefined, "loom launch should use the default named tunnel");
assert.equal(readFileSync(tunnelArgsPath, "utf8"), "tunnel run loom");

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
    LOOM_ALLOWED_ROOTS: shutdownDir,
    LOOM_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    LOOM_PUBLIC_BASE_URL: "https://loom.example.com",
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
