import { appendFileSync, chmodSync, lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Request } from "express";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";
export type LogFormat = "json" | "pretty";

export interface LoggingConfig {
  level: LogLevel;
  format: LogFormat;
  requests: boolean;
  trustProxy: boolean;
  filePath?: string;
  consoleOutput?: boolean;
}

type LogFields = Record<string, unknown>;
const MAX_LOG_BYTES = 5 * 1_024 * 1_024;
const failedLogPaths = new Set<string>();

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export function shouldLog(config: LoggingConfig, level: Exclude<LogLevel, "silent">): boolean {
  return LEVEL_WEIGHT[config.level] >= LEVEL_WEIGHT[level];
}

export function logEvent(
  config: LoggingConfig,
  level: Exclude<LogLevel, "silent">,
  event: string,
  fields: LogFields = {},
): void {
  if (!shouldLog(config, level)) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  const jsonLine = JSON.stringify(entry);
  const line = config.format === "pretty" ? formatPretty(entry) : jsonLine;
  if (config.consoleOutput !== false) {
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
  if (config.filePath) appendLog(config.filePath, jsonLine);
}

export function prepareLogFile(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Unsafe log path: ${filePath}`);
    if (stats.size >= MAX_LOG_BYTES) {
      rmSync(`${filePath}.1`, { force: true });
      renameSync(filePath, `${filePath}.1`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  appendFileSync(filePath, "", { encoding: "utf8", mode: 0o600, flag: "a" });
  chmodSync(filePath, 0o600);
}

function appendLog(filePath: string, line: string): void {
  try {
    prepareLogFile(filePath);
    appendFileSync(filePath, `${line}\n`, { encoding: "utf8", mode: 0o600, flag: "a" });
    failedLogPaths.delete(filePath);
  } catch (error) {
    if (failedLogPaths.has(filePath)) return;
    failedLogPaths.add(filePath);
    console.error(`loom log write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function requestIp(req: Request, _trustProxy: boolean): string | undefined {
  return req.ip ?? req.socket.remoteAddress;
}

export function requestPath(req: Request): string {
  return req.path || req.url.split("?")[0] || req.url;
}

export function sessionIdPrefix(sessionId: string | undefined): string | undefined {
  return sessionId ? sessionId.slice(0, 8) : undefined;
}

function formatPretty(entry: LogFields): string {
  const ts = String(entry.ts);
  const level = String(entry.level).toUpperCase();
  const event = String(entry.event);
  const rest = Object.entries(entry)
    .filter(([key, value]) => !["ts", "level", "event"].includes(key) && value !== undefined)
    .map(([key, value]) => `${key}=${formatPrettyValue(value)}`)
    .join(" ");

  return rest ? `${ts} ${level} ${event} ${rest}` : `${ts} ${level} ${event}`;
}

function formatPrettyValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}
