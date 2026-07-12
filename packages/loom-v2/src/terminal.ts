import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { spawn as spawnPty, type IPty } from "node-pty";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const MAX_COMMAND_BYTES = 16_384;
const MAX_INPUT_BYTES = 100_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_POLL_BYTES = 262_144;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_RETAINED_JOBS = 32;
const MAX_REPO_OUTPUT_BYTES = 262_144;

type JobState = "running" | "exited" | "failed" | "cancelled" | "timed_out";
type Chunk = { stream: "stdout" | "stderr"; start: number; end: number; data: Buffer };
type Job = {
  id: string;
  child: ChildProcess | null;
  pty: IPty | null;
  state: JobState;
  exitCode: number | null;
  signal: NodeJS.Signals | number | null;
  chunks: Chunk[];
  baseCursor: number;
  cursor: number;
  timer?: NodeJS.Timeout;
  termination?: Promise<void>;
  events: EventEmitter;
  interactive: boolean;
};

export interface TerminalStartInput {
  command: string;
  cwd?: string;
  environment?: Record<string, string>;
  timeoutMs?: number;
  interactive?: boolean;
}
export interface TerminalPollInput {
  jobId: string;
  cursor?: number;
  maxBytes?: number;
  waitMs?: number;
  finalOnly?: boolean;
  rawOutput?: boolean;
}
export interface TerminalInputInput { jobId: string; text?: string; closeStdin?: boolean }
export interface TerminalCancelInput { jobId: string }
export interface TerminalRepoInput {
  cwd?: string;
  repoAction: "status" | "diff" | "branches" | "release_check";
  baseRef?: string;
  maxBytes?: number;
}

type DangerousRule = { id: string; pattern: RegExp; reason: string };
const DANGEROUS: DangerousRule[] = [
  { id: "privilege-escalation", pattern: /(^|[;&|]\s*)sudo(?:\s|$)/i, reason: "privilege escalation" },
  { id: "root-home-deletion", pattern: /\brm\s+(?=[^;\n]*(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r))[^;\n]*(?:\s|^)(?:\/|\/\*|~\/?|\$\{?HOME\}?\/?)\s*(?:$|[;&|])/i, reason: "root or home deletion" },
  { id: "host-shutdown", pattern: /\b(?:shutdown|reboot|halt|poweroff)\b/i, reason: "host shutdown" },
  { id: "filesystem-format", pattern: /\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk)\b/i, reason: "filesystem formatting" },
  { id: "disk-erasure", pattern: /\bdiskutil\s+(?:eraseDisk|eraseVolume|partitionDisk|zeroDisk|secureErase)\b/i, reason: "disk erasure" },
  { id: "raw-device-overwrite", pattern: /\bdd\b[^;\n]*\bof=\/dev\//i, reason: "raw device overwrite" },
  { id: "fork-bomb", pattern: /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:\s*&[^}]*\}\s*;?\s*:/, reason: "fork bomb" },
];

export class DangerousCommandError extends Error {
  readonly code = "LOOM_DANGEROUS_COMMAND";
  constructor(
    readonly rule: string,
    readonly reason: string,
    readonly matched: string,
  ) {
    super(`Blocked command by safety rule ${rule}: ${reason}. Matched ${JSON.stringify(matched)}`);
    this.name = "DangerousCommandError";
  }
}

export function assertSafeCommand(command: string): string {
  if (!command.trim()) throw new Error("Terminal command is required");
  if (Buffer.byteLength(command) > MAX_COMMAND_BYTES) throw new Error(`Terminal command exceeds ${MAX_COMMAND_BYTES} bytes`);
  for (const rule of DANGEROUS) {
    const match = rule.pattern.exec(command);
    if (match) throw new DangerousCommandError(rule.id, rule.reason, match[0].slice(0, 160));
  }
  return command;
}

export function cleanTerminalOutput(input: string): string {
  const stripped = stripVTControlCharacters(input);
  const normalized = stripped
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.split("\r").at(-1) ?? "")
    .join("\n");
  let previous = "";
  let output = normalized;
  while (output !== previous) {
    previous = output;
    output = output.replace(/[^\n]\x08/g, "");
  }
  return output.replace(/\x08/g, "");
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

function boundedText(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const data = Buffer.from(value, "utf8");
  if (data.length <= maxBytes) return { text: value, truncated: false };
  return { text: data.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

function stringEnvironment(input: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

async function ensurePtyHelperExecutable(): Promise<void> {
  if (process.platform === "win32") return;
  const packageRoot = dirname(dirname(require.resolve("node-pty")));
  const candidates = [
    join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
    join(packageRoot, "build", "Release", "spawn-helper"),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      await chmod(candidate, 0o755);
      return;
    } catch (error: any) {
      lastError = error;
      if (error?.code === "ENOENT") continue;
    }
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Interactive terminal helper is unavailable${detail}`);
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
      if (job.state !== "running") this.#jobs.delete(id);
    }
    if (this.#jobs.size >= MAX_RETAINED_JOBS) throw new Error(`Loom terminal allows at most ${MAX_RETAINED_JOBS} retained jobs`);
    const command = assertSafeCommand(input.command);
    const cwd = await this.#workingDirectory(input.cwd ?? this.#roots[0]!);
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > DEFAULT_TIMEOUT_MS) throw new Error("Terminal timeout must be 100..300000 ms");
    const interactive = input.interactive ?? false;
    const job: Job = {
      id: `job_${randomUUID()}`,
      child: null,
      pty: null,
      state: "running",
      exitCode: null,
      signal: null,
      chunks: [],
      baseCursor: 0,
      cursor: 0,
      events: new EventEmitter(),
      interactive,
    };
    if (interactive) {
      await ensurePtyHelperExecutable();
      const pty = spawnPty("/bin/sh", ["-lc", command], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd,
        env: stringEnvironment({ ...process.env, ...(input.environment ?? {}) }),
      });
      job.pty = pty;
      pty.onData((data) => this.#append(job, "stdout", Buffer.from(data, "utf8")));
      pty.onExit(({ exitCode, signal }) => {
        clearTimeout(job.timer);
        job.exitCode = exitCode;
        job.signal = signal ?? null;
        if (job.state === "running") job.state = exitCode === 0 ? "exited" : "failed";
        job.events.emit("change");
        job.events.emit("exit");
      });
    } else {
      const child = spawn("/bin/sh", ["-lc", command], {
        cwd,
        env: { ...process.env, ...(input.environment ?? {}) },
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      job.child = child;
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
        job.events.emit("exit");
      });
    }
    this.#jobs.set(job.id, job);
    job.timer = setTimeout(() => {
      if (job.state !== "running") return;
      job.state = "timed_out";
      void this.#terminate(job);
      job.events.emit("change");
    }, timeoutMs);
    job.timer.unref();
    return {
      structuredContent: { jobId: job.id, state: job.state, interactive },
      content: [{ type: "text", text: `Started ${interactive ? "interactive " : ""}terminal job ${job.id}` }],
    };
  }

  async input(input: TerminalInputInput): Promise<any> {
    const job = this.#job(input.jobId);
    if (job.state !== "running") throw new Error(`Terminal job is not running: ${job.id}`);
    const text = input.text ?? "";
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_INPUT_BYTES) throw new Error(`Terminal input exceeds ${MAX_INPUT_BYTES} bytes`);
    if (job.pty) {
      if (text) job.pty.write(text);
      if (input.closeStdin) job.pty.write("\x04");
    } else {
      const stdin = job.child?.stdin;
      if (!stdin || stdin.destroyed) throw new Error(`Terminal stdin is unavailable: ${job.id}`);
      if (text) {
        await new Promise<void>((resolve, reject) => {
          stdin.write(text, (error) => error ? reject(error) : resolve());
        });
      }
      if (input.closeStdin) stdin.end();
    }
    return {
      structuredContent: { jobId: job.id, state: job.state, bytes, stdinClosed: input.closeStdin ?? false },
      content: [{ type: "text", text: `Sent ${bytes} byte${bytes === 1 ? "" : "s"} to ${job.id}${input.closeStdin ? " and closed stdin" : ""}` }],
    };
  }

  async poll(input: TerminalPollInput): Promise<any> {
    const job = this.#job(input.jobId);
    const requestedCursor = input.cursor ?? 0;
    const waitMs = Math.min(60_000, Math.max(0, input.waitMs ?? 0));
    if (waitMs > 0 && job.state === "running" && input.finalOnly) {
      await this.#waitForExit(job, waitMs);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } else if (waitMs > 0 && job.state === "running" && requestedCursor >= job.cursor) {
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
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (input.finalOnly && job.state === "running") {
      return {
        structuredContent: {
          jobId: job.id,
          state: job.state,
          cursor: requestedCursor,
          gap: requestedCursor < job.baseCursor,
          exitCode: job.exitCode,
          signal: job.signal,
          outputWithheld: true,
        },
        content: [{ type: "text", text: "Terminal job is still running; output withheld until completion." }],
      };
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
    const normalize = input.rawOutput ? (value: string) => value : cleanTerminalOutput;
    const stdoutText = normalize(Buffer.concat(stdout).toString("utf8"));
    const stderrText = normalize(Buffer.concat(stderr).toString("utf8"));
    const sections = [stdoutText && `stdout:\n${stdoutText}`, stderrText && `stderr:\n${stderrText}`].filter(Boolean);
    return {
      structuredContent: {
        jobId: job.id,
        state: job.state,
        cursor,
        gap: requestedCursor < job.baseCursor,
        exitCode: job.exitCode,
        signal: job.signal,
        stdout: stdoutText,
        stderr: stderrText,
        cleaned: !input.rawOutput,
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

  async repo(input: TerminalRepoInput): Promise<any> {
    const cwd = await this.#workingDirectory(input.cwd ?? this.#roots[0]!);
    const maxBytes = Math.min(MAX_REPO_OUTPUT_BYTES, Math.max(1, input.maxBytes ?? 64 * 1024));
    const root = (await this.#git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    if (input.repoAction === "diff") {
      const ref = input.baseRef?.trim();
      if (ref && ref.length > 256) throw new Error("Repository baseRef exceeds 256 characters");
      const args = ["diff", ...(ref ? [ref] : []), "--stat", "--", "."];
      const stat = await this.#git(root, args);
      const names = await this.#git(root, ["diff", ...(ref ? [ref] : []), "--name-status", "--", "."]);
      const bounded = boundedText([stat, names].filter(Boolean).join("\n"), maxBytes);
      return {
        structuredContent: { root, repoAction: input.repoAction, baseRef: ref ?? null, truncated: bounded.truncated },
        content: [{ type: "text", text: bounded.text || "No repository diff." }],
      };
    }
    if (input.repoAction === "branches") {
      const branches = await this.#git(root, ["branch", "--all", "--verbose", "--no-abbrev"]);
      const bounded = boundedText(branches, maxBytes);
      return {
        structuredContent: { root, repoAction: input.repoAction, truncated: bounded.truncated },
        content: [{ type: "text", text: bounded.text || "No branches." }],
      };
    }
    const snapshot = await this.#repositorySnapshot(root);
    if (input.repoAction === "status") {
      return {
        structuredContent: snapshot,
        content: [{ type: "text", text: this.#repositorySummary(snapshot) }],
      };
    }
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (snapshot.detached) blockers.push("HEAD is detached");
    if (snapshot.dirty) blockers.push(`${snapshot.changedFiles.length} tracked or untracked file(s) are not committed`);
    if (!snapshot.origin) blockers.push("origin remote is missing");
    if (!snapshot.upstream) blockers.push("current branch has no upstream");
    if (snapshot.behind > 0) blockers.push(`branch is ${snapshot.behind} commit(s) behind upstream`);
    if (snapshot.ahead > 0) warnings.push(`branch is ${snapshot.ahead} commit(s) ahead of upstream`);
    if (!snapshot.packageName || !snapshot.packageVersion) warnings.push("package.json name/version not found at repository root");
    if (snapshot.packagePrivate) blockers.push("package.json is private");
    const expectedTag = snapshot.packageVersion ? `v${snapshot.packageVersion}` : null;
    if (expectedTag && !snapshot.tagsAtHead.includes(expectedTag)) warnings.push(`release tag ${expectedTag} is not at HEAD`);
    const ready = blockers.length === 0;
    return {
      structuredContent: { ...snapshot, repoAction: input.repoAction, ready, blockers, warnings, expectedTag },
      content: [{ type: "text", text: [
        ready ? "Release check passed." : "Release check blocked.",
        ...blockers.map((item) => `BLOCKER: ${item}`),
        ...warnings.map((item) => `WARNING: ${item}`),
        "",
        this.#repositorySummary(snapshot),
      ].join("\n") }],
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
    if (job.pty) {
      try { job.pty.kill(signal); } catch { /* already gone */ }
      return;
    }
    const child = job.child;
    const pid = child?.pid;
    if (!child || !pid) return;
    try { process.kill(-pid, signal); }
    catch {
      try { child.kill(signal); } catch { /* already gone */ }
    }
  }

  #terminate(job: Job): Promise<void> {
    if (job.state === "exited" || job.state === "failed") return Promise.resolve();
    if (job.child && (job.child.exitCode !== null || job.child.signalCode !== null)) return Promise.resolve();
    return job.termination ??= (async () => {
      clearTimeout(job.timer);
      try { job.child?.stdin?.end(); } catch { /* already closed */ }
      this.#signal(job, "SIGTERM");
      if (await this.#waitForExit(job, 1_000)) return;
      this.#signal(job, "SIGKILL");
      if (!await this.#waitForExit(job, 1_000)) throw new Error(`Terminal process group did not exit: ${job.id}`);
    })();
  }

  async #waitForExit(job: Job, timeoutMs: number): Promise<boolean> {
    if (job.state === "exited" || job.state === "failed") return true;
    if (job.child && (job.child.exitCode !== null || job.child.signalCode !== null)) return true;
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        job.events.off("exit", done);
        resolve(true);
      };
      const timer = setTimeout(() => {
        job.events.off("exit", done);
        resolve(false);
      }, timeoutMs);
      job.events.once("exit", done);
      timer.unref();
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

  async #git(cwd: string, args: string[]): Promise<string> {
    try {
      const result = await execFileAsync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_REPO_OUTPUT_BYTES * 4 });
      return result.stdout;
    } catch (error: any) {
      const detail = typeof error?.stderr === "string" ? error.stderr.trim() : error?.message;
      throw new Error(`Git ${args[0] ?? "command"} failed${detail ? `: ${detail}` : ""}`);
    }
  }

  async #gitOptional(cwd: string, args: string[]): Promise<string | null> {
    try { return (await this.#git(cwd, args)).trim() || null; }
    catch { return null; }
  }

  async #repositorySnapshot(root: string): Promise<any> {
    const branch = await this.#gitOptional(root, ["branch", "--show-current"]);
    const head = (await this.#git(root, ["rev-parse", "HEAD"])).trim();
    const status = await this.#git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
    const changedFiles = status.split("\n").filter(Boolean);
    const origin = await this.#gitOptional(root, ["remote", "get-url", "origin"]);
    const upstream = await this.#gitOptional(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = await this.#gitOptional(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
      const [left, right] = counts?.split(/\s+/).map(Number) ?? [];
      ahead = Number.isFinite(left) ? left! : 0;
      behind = Number.isFinite(right) ? right! : 0;
    }
    const tagsAtHead = (await this.#gitOptional(root, ["tag", "--points-at", "HEAD"]))?.split("\n").filter(Boolean) ?? [];
    let packageName: string | null = null;
    let packageVersion: string | null = null;
    let packagePrivate = false;
    try {
      const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
      packageName = typeof packageJson.name === "string" ? packageJson.name : null;
      packageVersion = typeof packageJson.version === "string" ? packageJson.version : null;
      packagePrivate = packageJson.private === true;
    } catch { /* non-package repository */ }
    return {
      root,
      repoAction: "status",
      branch,
      detached: !branch,
      head,
      dirty: changedFiles.length > 0,
      changedFiles,
      origin,
      upstream,
      ahead,
      behind,
      tagsAtHead,
      packageName,
      packageVersion,
      packagePrivate,
    };
  }

  #repositorySummary(snapshot: any): string {
    return [
      `Root: ${snapshot.root}`,
      `Branch: ${snapshot.branch ?? "DETACHED"}`,
      `HEAD: ${snapshot.head}`,
      `Working tree: ${snapshot.dirty ? `${snapshot.changedFiles.length} changed file(s)` : "clean"}`,
      `Origin: ${snapshot.origin ?? "missing"}`,
      `Upstream: ${snapshot.upstream ?? "missing"}`,
      `Ahead/behind: ${snapshot.ahead}/${snapshot.behind}`,
      `Package: ${snapshot.packageName && snapshot.packageVersion ? `${snapshot.packageName}@${snapshot.packageVersion}` : "not found"}`,
      `Tags at HEAD: ${snapshot.tagsAtHead.join(", ") || "none"}`,
    ].join("\n");
  }
}
