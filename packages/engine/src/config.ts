import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHomePath } from "./roots.js";
import type { LoggingConfig, LogFormat, LogLevel } from "./logger.js";
import type { OAuthConfig } from "./oauth-provider.js";
import { loomSkillsDir, loadLoomFiles } from "./user-config.js";

const ACCESS_TOKEN_TTL = 60 * 60;
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

export interface ServerConfig {
  host: string;
  port: number;
  oauth: OAuthConfig;
  allowedRoots: string[];
  allowedHosts: string[];
  publicBaseUrl: string;
  stateDir: string;
  skillPaths: string[];
  logging: LoggingConfig;
}

function list(value: string | undefined, fallback: string[]): string[] {
  const entries = value?.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries?.length ? entries : fallback;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid ${name}: ${value}`);
  return parsed;
}

function secret(value: string | undefined): string {
  const result = value?.trim();
  if (!result) throw new Error("LOOM_OAUTH_OWNER_TOKEN is required for Loom OAuth. Run: loom init");
  if (result.length < 16) throw new Error("LOOM_OAUTH_OWNER_TOKEN must be at least 16 characters long.");
  return result;
}

function logLevel(value: string | undefined): LogLevel {
  if (!value || value === "info") return "info";
  if (["silent", "error", "warn", "debug"].includes(value)) return value as LogLevel;
  throw new Error(`Invalid LOOM_LOG_LEVEL: ${value}`);
}

function logFormat(value: string | undefined): LogFormat {
  if (!value || value === "json") return "json";
  if (value === "pretty") return "pretty";
  throw new Error(`Invalid LOOM_LOG_FORMAT: ${value}`);
}

function enabled(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function normalizePublicBaseUrl(value: string): string {
  const parsed = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("HTTPS is required for a public base URL; HTTP is allowed only on loopback.");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const files = loadLoomFiles(env);
  const host = env.HOST ?? files.config.host ?? "127.0.0.1";
  const port = Number(env.PORT ?? files.config.port ?? 7676);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT: ${String(env.PORT ?? files.config.port)}`);

  const localHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const localUrl = `http://${localHost.includes(":") ? `[${localHost}]` : localHost}:${port}`;
  const publicBaseUrl = normalizePublicBaseUrl(env.LOOM_PUBLIC_BASE_URL ?? files.config.publicBaseUrl ?? localUrl);
  const configuredRoots = env.LOOM_ALLOWED_ROOTS
    ? list(env.LOOM_ALLOWED_ROOTS, [])
    : files.config.allowedRoots ?? [];
  const allowedRoots = (configuredRoots.length ? configuredRoots : [process.cwd()]).map((root) => resolve(expandHomePath(root)));
  const derivedHosts = ["localhost", "127.0.0.1", "::1", host, new URL(publicBaseUrl).hostname, ...(files.config.allowedHosts ?? [])];
  const requestedHosts = env.LOOM_ALLOWED_HOSTS ? list(env.LOOM_ALLOWED_HOSTS, []) : derivedHosts;
  const allowedHosts = requestedHosts.includes("*") ? ["*"] : Array.from(new Set(requestedHosts.filter(Boolean)));

  return {
    host,
    port,
    publicBaseUrl,
    allowedRoots,
    allowedHosts,
    stateDir: resolve(expandHomePath(env.LOOM_STATE_DIR ?? files.config.stateDir ?? join(homedir(), ".local", "share", "loom"))),
    skillPaths: Array.from(new Set([loomSkillsDir(env), ...list(env.LOOM_SKILL_PATHS, []).map((path) => resolve(expandHomePath(path)))])),
    oauth: {
      ownerToken: secret(env.LOOM_OAUTH_OWNER_TOKEN ?? files.auth.ownerToken),
      accessTokenTtlSeconds: positiveInteger(env.LOOM_OAUTH_ACCESS_TOKEN_TTL_SECONDS, ACCESS_TOKEN_TTL, "LOOM_OAUTH_ACCESS_TOKEN_TTL_SECONDS"),
      refreshTokenTtlSeconds: positiveInteger(env.LOOM_OAUTH_REFRESH_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL, "LOOM_OAUTH_REFRESH_TOKEN_TTL_SECONDS"),
      scopes: list(env.LOOM_OAUTH_SCOPES, ["loom"]),
      allowedRedirectHosts: list(env.LOOM_OAUTH_ALLOWED_REDIRECT_HOSTS, ["chatgpt.com", "localhost", "127.0.0.1"]),
    },
    logging: {
      level: logLevel(env.LOOM_LOG_LEVEL),
      format: logFormat(env.LOOM_LOG_FORMAT),
      requests: enabled(env.LOOM_LOG_REQUESTS, true),
      trustProxy: enabled(env.LOOM_TRUST_PROXY),
    },
  };
}
