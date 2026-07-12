import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const MAX_COMMAND_BYTES = 16_384;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_POLL_BYTES = 262_144;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_RETAINED_JOBS = 32;

type JobState = "running" | "exited" | "failed" | "cancelled" | "timed_out";
type Chunk = { stream: "stdout" | "stderr"; start: number; end: number; data: Buffer };
type Job = {
  id: string;
  child: ChildProcess;
  state: JobState;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  chunks: Chunk[];
  baseCursor: number;
  cursor: number;
  timer?: NodeJS.Timeout;
  termination?: Promise<void>;
  events: EventEmitter;
};

export interface TerminalStartInput { command: string; cwd?: string; environment?: Record<string, string>; timeoutMs?: number }
export interface TerminalPollInput { jobId: string; cursor?: number; maxBytes?: number; waitMs?: number }
export interface TerminalCancelInput { jobId: string }

const DANGEROUS: Array<[RegExp, string]> = [
  [/(^|[;&|]\s*)sudo(?:\s|$)/i, "privilege escalation"],
  [/\brm\s+(?=[^;\n]*(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r))[^;\n]*(?:\s|^)(?:\/|\/\*|~\/?|\$\{?HOME\}?\/?)\s*(?:$|[;&|])/i, "root or home deletion"],
  [/\b(?:shutdown|reboot|halt|poweroff)\b/i, "host shutdown"],
  [/\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk)\b/i, "filesystem formatting"],
  [/\bdiskutil\s+(?:eraseDisk|eraseVolume|partitionDisk|zeroDisk|secureErase)\b/i, "disk erasure"],
  [/\bdd\b[^;\n]*\bof=\/dev\//i, "raw device overwrite"],
  [/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:\s*&[^}]*\}\s*;?\s*:/, "fork bomb"],
];

export function assertSafeCommand(command: string): string {
  if (!command.trim()) throw new Error("Terminal command is required");
  if (Buffer.byteLength(command) > MAX_COMMAND_BYTES) throw new Error(`Terminal command exceeds ${MAX_COMMAND_BYTES} bytes`);
  const match = DANGEROUS.find(([pattern]) => pattern.test(command));
  if (match) throw new Error(`Blocked explicitly dangerous command: ${match[1]}`);
  return command;
}

function expandPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  if (!isAbsolute(path)) throw new Error("Terminal cwd must be absolute or start with ~/");
  return path;
}

function isInside(path: string, root: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

export class LoomTerminal {
  readonly #roots: string[];
  readonly #jobs = new Map<string, Job>();
  #closed = false;

  constructor(allowedRoots: string[]) {
    if (allowedRoots.length === 0) throw new Error("At least one Loom root is required");
    this.#roots = allowedRoots.map(expandPath);
  }

  get activeJobs(): number {
    return [...this.#jobs.values()].filter((job) => job.state === "running").length;
  }

  async start(input: TerminalStartInput): Promise<any> {
    if (this.#closed) throw new Error("Loom terminal is shutting down");
    for (const [id, job] of this.#jobs) {
      if (this.#jobs.size < MAX_RETAINED_JOBS) break;
      if (job.child.exitCode !== null || job.child.signalCode !== null) this.#jobs.delete(id);
    }
    if (this.#jobs.size >= MAX_RETAINED_JOBS) throw new Error(`Loom terminal allows at most ${MAX_RETAINED_JOBS} retained jobs`);
    const command = assertSafeCommand(input.command);
    const cwd = await this.#workingDirectory(input.cwd ?? this.#roots[0]!);
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > DEFAULT_TIMEOUT_MS) throw new Error("Terminal timeout must be 100..300000 ms");
    const child = spawn("/bin/sh", ["-lc", command], {
      cwd,
      env: { ...process.env, ...(input.environment ?? {}) },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const job: Job = {
      id: `job_${randomUUID()}`,
      child,
      state: "running",
      exitCode: null,
      signal: null,
      chunks: [],
      baseCursor: 0,
      cursor: 0,
      events: new EventEmitter(),
    };
    this.#jobs.set(job.id, job);
    child.stdout!.on("data", (data: Buffer) => this.#append(job, "stdout", data));
    child.stderr!.on("data", (data: Buffer) => this.#append(job, "stderr", data));
    child.once("error", () => {
      if (job.state === "running") job.state = "failed";
      job.events.emit("change");
    });
    child.once("exit", (code, signal) => {
      clearTimeout(job.timer);
      job.exitCode = code;
      job.signal = signal;
      if (job.state === "running") job.state = code === 0 ? "exited" : "failed";
      job.events.emit("change");
    });
    job.timer = setTimeout(() => {
      if (job.state !== "running") return;
      job.state = "timed_out";
      void this.#terminate(job);
      job.events.emit("change");
    }, timeoutMs);
    job.timer.unref();
    return {
      structuredContent: { jobId: job.id, state: job.state },
      content: [{ type: "text", text: `Started terminal job ${job.id}` }],
    };
  }

  async poll(input: TerminalPollInput): Promise<any> {
    const job = this.#job(input.jobId);
    const requestedCursor = input.cursor ?? 0;
    const waitMs = Math.min(60_000, Math.max(0, input.waitMs ?? 0));
    if (waitMs > 0 && job.state === "running" && requestedCursor >= job.cursor) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          job.events.off("change", finish);
          resolve();
        };
        const timer = setTimeout(finish, waitMs);
        job.events.once("change", finish);
        timer.unref();
      });
      // Let stdout, stderr, and a rapid natural exit from one shell turn settle.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const maxBytes = Math.min(MAX_POLL_BYTES, Math.max(1, input.maxBytes ?? 64 * 1024));
    let cursor = Math.max(requestedCursor, job.baseCursor);
    let remaining = maxBytes;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    for (const chunk of job.chunks) {
      if (chunk.end <= cursor || remaining === 0) continue;
      const start = Math.max(0, cursor - chunk.start);
      const take = chunk.data.subarray(start, start + remaining);
      (chunk.stream === "stdout" ? stdout : stderr).push(take);
      remaining -= take.length;
      cursor = Math.max(cursor, chunk.start + start + take.length);
      if (take.length < chunk.data.length - start) break;
    }
    const stdoutText = Buffer.concat(stdout).toString("utf8");
    const stderrText = Buffer.concat(stderr).toString("utf8");
    const sections = [stdoutText && `stdout:\n${stdoutText}`, stderrText && `stderr:\n${stderrText}`].filter(Boolean);
    return {
      structuredContent: {
        jobId: job.id,
        state: job.state,
        cursor,
        gap: requestedCursor < job.baseCursor,
        exitCode: job.exitCode,
        signal: job.signal,
      },
      content: [{ type: "text", text: sections.join("\n") || `${job.state}; no new output` }],
    };
  }

  async cancel(input: TerminalCancelInput): Promise<any> {
    const job = this.#job(input.jobId);
    if (job.state === "running") {
      job.state = "cancelled";
      clearTimeout(job.timer);
      job.events.emit("change");
    }
    await this.#terminate(job);
    return {
      structuredContent: { jobId: job.id, state: job.state },
      content: [{ type: "text", text: `Terminal job ${job.id}: ${job.state}` }],
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all([...this.#jobs.values()].map((job) => this.#terminate(job)));
  }

  #job(id: string): Job {
    const job = this.#jobs.get(id);
    if (!job) throw new Error(`Unknown terminal job: ${id}`);
    return job;
  }

  #append(job: Job, stream: Chunk["stream"], input: Buffer): void {
    const data = Buffer.from(input);
    const chunk = { stream, start: job.cursor, end: job.cursor + data.length, data };
    job.cursor = chunk.end;
    job.chunks.push(chunk);
    let retained = job.cursor - job.baseCursor;
    while (retained > MAX_OUTPUT_BYTES && job.chunks.length > 0) {
      const removed = job.chunks.shift()!;
      job.baseCursor = removed.end;
      retained = job.cursor - job.baseCursor;
    }
    job.events.emit("change");
  }

  #signal(job: Job, signal: NodeJS.Signals): void {
    const pid = job.child.pid;
    if (!pid) return;
    try { process.kill(-pid, signal); }
    catch {
      try { job.child.kill(signal); } catch { /* already gone */ }
    }
  }

  #terminate(job: Job): Promise<void> {
    if (job.child.exitCode !== null || job.child.signalCode !== null) return Promise.resolve();
    return job.termination ??= (async () => {
      clearTimeout(job.timer);
      this.#signal(job, "SIGTERM");
      if (await this.#waitForExit(job, 1_000)) return;
      this.#signal(job, "SIGKILL");
      if (!await this.#waitForExit(job, 1_000)) throw new Error(`Terminal process group did not exit: ${job.id}`);
    })();
  }

  async #waitForExit(job: Job, timeoutMs: number): Promise<boolean> {
    if (job.child.exitCode !== null || job.child.signalCode !== null) return true;
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { job.child.off("exit", done); resolve(false); }, timeoutMs);
      job.child.once("exit", done);
    });
  }

  async #workingDirectory(input: string): Promise<string> {
    const cwd = await realpath(expandPath(input));
    for (const root of this.#roots) {
      try {
        if (isInside(cwd, await realpath(root))) return cwd;
      } catch { /* try next root */ }
    }
    throw new Error("Terminal cwd is outside configured Loom roots");
  }
}
