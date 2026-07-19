import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, prepareLogFile, type LoggingConfig } from "./logger.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runtime logging", () => {
  it("persists private JSON logs and rotates at the bounded limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-log-"));
    roots.push(root);
    const filePath = join(root, "loom.log");
    const config: LoggingConfig = { level: "info", format: "json", requests: true, trustProxy: false, filePath };
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    logEvent(config, "info", "server_started", { port: 7676 });
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ event: "server_started", port: 7676 });
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);

    await writeFile(filePath, Buffer.alloc(5 * 1_024 * 1_024), { mode: 0o600 });
    logEvent(config, "warn", "tunnel_restarting", { attempt: 2 });
    expect((await stat(`${filePath}.1`)).size).toBe(5 * 1_024 * 1_024);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ event: "tunnel_restarting", attempt: 2 });

    const tunnelPath = join(root, "cloudflared.log");
    prepareLogFile(tunnelPath);
    expect((await stat(tunnelPath)).mode & 0o777).toBe(0o600);
  });
});
