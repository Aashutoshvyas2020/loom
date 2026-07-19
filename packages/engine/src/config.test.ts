import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";

const configDir = mkdtempSync(join(tmpdir(), "loom-config-test-"));
const baseEnv = {
  LOOM_CONFIG_DIR: configDir,
  LOOM_STATE_DIR: configDir,
  LOOM_ALLOWED_ROOTS: process.cwd(),
  LOOM_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
};

const defaults = loadConfig(baseEnv);
assert.equal(defaults.publicBaseUrl, "http://127.0.0.1:7676");
assert.deepEqual(defaults.allowedHosts, ["localhost", "127.0.0.1", "::1"]);
assert.deepEqual(defaults.oauth.scopes, ["loom"]);
assert.equal(defaults.oauth.accessTokenTtlSeconds, 3600);
assert.deepEqual(defaults.logging, { level: "info", format: "json", requests: true, trustProxy: false, filePath: join(configDir, "loom.log") });

assert.equal(loadConfig({ ...baseEnv, LOOM_PUBLIC_BASE_URL: "https://loom.example.com/" }).publicBaseUrl, "https://loom.example.com");
assert.equal(loadConfig({ ...baseEnv, LOOM_PUBLIC_BASE_URL: "http://localhost:7676" }).publicBaseUrl, "http://localhost:7676");
assert.throws(() => loadConfig({ ...baseEnv, LOOM_PUBLIC_BASE_URL: "http://loom.example.com" }), /HTTPS.*public base URL/i);
assert.throws(() => loadConfig({ ...baseEnv, LOOM_OAUTH_OWNER_TOKEN: "short" }), /at least 16/);
assert.throws(() => loadConfig({ ...baseEnv, LOOM_LOG_LEVEL: "trace" }), /Invalid LOOM_LOG_LEVEL/);
assert.deepEqual(loadConfig({ ...baseEnv, LOOM_ALLOWED_HOSTS: "*" }).allowedHosts, ["*"]);

writeFileSync(join(configDir, "config.json"), JSON.stringify({
  port: 8787,
  allowedRoots: [process.cwd()],
  publicBaseUrl: "https://loom.example.com",
}));
writeFileSync(join(configDir, "auth.json"), JSON.stringify({ ownerToken: "persisted-owner-token-long-enough" }));
const persisted = loadConfig({ LOOM_CONFIG_DIR: configDir });
assert.equal(persisted.port, 8787);
assert.equal(persisted.oauth.ownerToken, "persisted-owner-token-long-enough");
assert.equal(persisted.publicBaseUrl, "https://loom.example.com");
