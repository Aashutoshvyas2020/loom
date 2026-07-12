import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoomTerminal, assertSafeCommand } from "./terminal.js";

const terminals: LoomTerminal[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(terminals.splice(0).map((terminal) => terminal.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-terminal-"));
  const terminal = new LoomTerminal([root]);
  roots.push(root);
  terminals.push(terminal);
  return { root, terminal };
}

describe("terminal danger rail", () => {
  it("allows ordinary development cleanup but blocks explicit disasters", () => {
    expect(assertSafeCommand("rm -rf ./dist && npm run build")).toBe("rm -rf ./dist && npm run build");
    expect(assertSafeCommand("git clean -fd")).toBe("git clean -fd");
    for (const command of [
      "sudo rm -rf /",
      "rm -rf /",
      "diskutil eraseDisk APFS Empty /dev/disk4",
      "mkfs.ext4 /dev/sda1",
      "dd if=/dev/zero of=/dev/disk0",
      "shutdown -h now",
      ":(){ :|:& };:",
    ]) expect(() => assertSafeCommand(command)).toThrow(/explicitly dangerous/i);
  });
});

describe("LoomTerminal", () => {
  it("starts, waits, and returns real stdout and stderr", async () => {
    const { root, terminal } = await fixture();
    const started = await terminal.start({ command: "printf out; printf err >&2", cwd: root });
    expect(started.structuredContent).toMatchObject({ jobId: expect.stringMatching(/^job_/), state: "running" });
    const result = await terminal.poll({ jobId: started.structuredContent.jobId, waitMs: 2_000 });
    expect(result.content[0].text).toContain("out");
    expect(result.content[0].text).toContain("err");
    expect(result.structuredContent).toMatchObject({ state: "exited", exitCode: 0 });
  });

  it("cancels an owned command and reports the terminal state", async () => {
    const { root, terminal } = await fixture();
    const started = await terminal.start({ command: "sleep 30", cwd: root });
    const cancelled = await terminal.cancel({ jobId: started.structuredContent.jobId });
    expect(cancelled.structuredContent.state).toBe("cancelled");
    const polled = await terminal.poll({ jobId: started.structuredContent.jobId, waitMs: 2_000 });
    expect(polled.structuredContent.state).toBe("cancelled");
  });

  it("times out bounded jobs", async () => {
    const { root, terminal } = await fixture();
    const started = await terminal.start({ command: "sleep 30", cwd: root, timeoutMs: 100 });
    const polled = await terminal.poll({ jobId: started.structuredContent.jobId, waitMs: 2_000 });
    expect(polled.structuredContent.state).toBe("timed_out");
  });

  it("waits for shutdown and kills a TERM-resistant process group", async () => {
    const { root, terminal } = await fixture();
    const pidPath = join(root, "pid");
    await terminal.start({ command: `echo $$ > ${pidPath}; trap '' TERM; while :; do sleep 1; done`, cwd: root });
    let pid = 0;
    for (let attempt = 0; attempt < 50 && pid === 0; attempt += 1) {
      pid = Number(await readFile(pidPath, "utf8").catch(() => "0"));
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(pid).toBeGreaterThan(0);

    try {
      await terminal.close();
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      try { process.kill(-pid, "SIGKILL"); } catch { /* already stopped */ }
    }
  });

  it("kills a TERM-resistant process group even after cancellation changed its state", async () => {
    const { root, terminal } = await fixture();
    const pidPath = join(root, "cancelled.pid");
    const started = await terminal.start({ command: `echo $$ > ${pidPath}; trap '' TERM; while :; do sleep 1; done`, cwd: root });
    let pid = 0;
    for (let attempt = 0; attempt < 50 && pid === 0; attempt += 1) {
      pid = Number(await readFile(pidPath, "utf8").catch(() => "0"));
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(pid).toBeGreaterThan(0);

    try {
      await terminal.cancel({ jobId: started.structuredContent.jobId });
      await terminal.close();
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      try { process.kill(-pid, "SIGKILL"); } catch { /* already stopped */ }
    }
  });

  it("removes timed-out poll listeners", async () => {
    const { root, terminal } = await fixture();
    const started = await terminal.start({ command: "sleep 30", cwd: root });
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);
    try {
      for (let poll = 0; poll < 12; poll += 1) {
        await terminal.poll({ jobId: started.structuredContent.jobId, waitMs: 5 });
      }
      await new Promise((resolve) => setImmediate(resolve));
      expect(warnings.filter((warning) => warning.name === "MaxListenersExceededWarning")).toEqual([]);
    } finally {
      process.off("warning", onWarning);
    }
  });

  it("evicts old completed jobs instead of retaining unbounded history", async () => {
    const { root, terminal } = await fixture();
    let firstJobId = "";
    for (let index = 0; index < 33; index += 1) {
      const started = await terminal.start({ command: "true", cwd: root });
      firstJobId ||= started.structuredContent.jobId;
      await terminal.poll({ jobId: started.structuredContent.jobId, waitMs: 1_000 });
    }
    await expect(terminal.poll({ jobId: firstJobId })).rejects.toThrow(/Unknown terminal job/);
  });
});
