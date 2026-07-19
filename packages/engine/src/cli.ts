#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import { join, resolve } from "node:path";
import * as prompts from "@clack/prompts";
import { satisfies } from "semver";
import { loadConfig, normalizePublicBaseUrl } from "./config.js";
import {
  createLoomSkill,
  loomSkillsDir,
  ensureLoomHookAgents,
  generateOwnerToken,
  listLoomSkillNames,
  loadLoomFiles,
  writeLoomAuth,
  writeLoomConfig,
  type LoomUserConfig,
} from "./user-config.js";
import { expandHomePath } from "./roots.js";
import { renderLoomDashboard, type LoomDashboardStats } from "./tui.js";
import { AgentProviderStore, canonicalizeAgentEndpoint } from "./agent-provider.js";
import { logEvent, prepareLogFile } from "./logger.js";
import { inspectExternalDependencies } from "./external-dependencies.js";
import { clearUpdateCache, handleStartupUpdate, runNpmUpdate } from "./update.js";
import { LOOM_VERSION } from "./version.js";

type Command = "serve" | "launch" | "init" | "doctor" | "config" | "skill" | "update" | "help" | "version";
const require = createRequire(import.meta.url);
const SUPPORTED_NODE_RANGE = ">=22 <27";
const TUNNEL_RESTART_LIMIT = 3;
const TUNNEL_STABLE_MS = 60_000;

async function main(argv: string[]): Promise<void> {
  assertSupportedNode();

  const [rawCommand, ...args] = argv;
  const command = normalizeCommand(rawCommand);

  if (command === "serve" || command === "launch") {
    const files = loadLoomFiles();
    if (await handleStartupUpdate(LOOM_VERSION, files.config.autoUpdate === true)) return;
  }

  switch (command) {
    case "serve":
      await ensureConfigured();
      await serve();
      return;
    case "launch":
      await ensureConfigured();
      await launch(args);
      return;
    case "init":
      await runInit({ force: args.includes("--force") });
      return;
    case "doctor":
      await runDoctor();
      return;
    case "config":
      runConfigCommand(args);
      return;
    case "skill":
      runSkillCommand(args);
      return;
    case "update":
      runNpmUpdate();
      clearUpdateCache();
      console.log("Loom updated successfully. Run `loom launch` again.");
      return;
    case "help":
      printHelp();
      return;
    case "version":
      printVersion();
      return;
  }
}

function normalizeCommand(command: string | undefined): Command {
  if (!command || command === "serve" || command === "start") return "serve";
  if (command === "launch") return "launch";
  if (command === "init" || command === "doctor" || command === "config" || command === "skill" || command === "update") return command;
  if (command === "help" || command === "--help" || command === "-h") return "help";
  if (command === "version" || command === "--version" || command === "-v") return "version";
  throw new Error(`Unknown command: ${command}`);
}

async function ensureConfigured(): Promise<void> {
  const files = loadLoomFiles();
  if (files.configExists && files.authExists) return;
  if (process.env.LOOM_OAUTH_OWNER_TOKEN) return;

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      [
        "Loom is not configured and this terminal is non-interactive.",
        "",
        "Run:",
        "  loom init",
        "",
        "Or provide LOOM_OAUTH_OWNER_TOKEN and LOOM_ALLOWED_ROOTS.",
      ].join("\n"),
    );
  }

  await runInit({ force: false });
}

async function runInit({ force }: { force: boolean }): Promise<void> {
  const files = loadLoomFiles();
  if (!force && files.configExists && files.authExists) {
    prompts.log.info(`Loom is already configured at ${files.dir}`);
    prompts.log.info("Run `loom init --force` to update it.");
    return;
  }

  try {
    prompts.intro("Loom setup");
    const dependencies = inspectExternalDependencies();
    prompts.note(
      dependencies.map((dependency) => dependency.found
        ? `✓ ${dependency.command} — ${dependency.purpose}\n  ${dependency.path}`
        : `✗ ${dependency.command} — ${dependency.purpose}\n  Needed: ${dependency.install}`
      ).join("\n"),
      dependencies.some((dependency) => !dependency.found)
        ? "External dependencies needed"
        : "External dependencies ready",
    );

    const defaultRoots = files.config.allowedRoots?.join(", ") || process.cwd();
    const rootsAnswer = await textPrompt({
      message: `Where are your projects located? Press Enter to use ${defaultRoots}`,
      placeholder: defaultRoots,
      defaultValue: defaultRoots,
      validate: (value) => value?.trim() ? undefined : "Enter at least one project root.",
    });
    const allowedRoots = rootsAnswer
      .split(",")
      .map((root) => resolve(expandHomePath(root.trim())))
      .filter(Boolean);

    const defaultPort = String(files.config.port ?? 7676);
    const portAnswer = await textPrompt({
      message: `Which local port should Loom use? Press Enter to use ${defaultPort}`,
      placeholder: defaultPort,
      defaultValue: defaultPort,
      validate: validatePort,
    });
    const port = Number(portAnswer);

    prompts.note(
      [
        "Loom needs a public base URL so ChatGPT or Claude can reach this MCP server.",
        "Create a tunnel or reverse proxy with Cloudflare Tunnel, ngrok, Pinggy, Tailscale Funnel, or your own HTTPS proxy.",
        "Paste the public origin here, without /mcp.",
        "",
        "Example: https://your-tunnel-host.example.com",
      ].join("\n"),
      "Public URL required",
    );
    const publicBaseUrl = normalizePublicBaseUrl(await textPrompt({
      message: files.config.publicBaseUrl
        ? `What is the public base URL? Press Enter to keep ${files.config.publicBaseUrl}`
        : "What is the public base URL?",
      placeholder: files.config.publicBaseUrl ?? "https://your-tunnel-host.example.com",
      defaultValue: files.config.publicBaseUrl ?? "",
      validate: validateRequiredPublicBaseUrl,
    }));

    const config: LoomUserConfig = {
      host: files.config.host ?? "127.0.0.1",
      port,
      allowedRoots,
      publicBaseUrl,
    };
    const auth = {
      ownerToken: files.auth.ownerToken ?? generateOwnerToken(),
    };

    const configPath = writeLoomConfig(config);
    const authPath = writeLoomAuth(auth);

    const lines = [
      `Config: ${configPath}`,
      `Auth: ${authPath}`,
      `Local MCP URL: http://${config.host}:${config.port}/mcp`,
      ...(publicBaseUrl ? [`Public MCP URL: ${publicBaseUrl}/mcp`] : []),
    ];
    prompts.note(lines.join("\n"), "Loom configured");
    prompts.note(
      [
        `Owner password: ${auth.ownerToken}`,
        "Use this when ChatGPT or Claude asks you to approve Loom access.",
        `Stored at: ${authPath}`,
      ].join("\n"),
      "Owner password",
    );
    prompts.outro("Run `loom launch` to start Loom and its named tunnel.");
  } catch (error) {
    if (error instanceof SetupCancelledError) {
      prompts.cancel("Setup cancelled");
      return;
    }
    throw error;
  }
}

async function serve(): Promise<void> {
  await startServer(process.env, { handleSignals: true });
}

async function launch(args: string[]): Promise<void> {
  const tunnelName = args[0]?.trim() || "loom";

  const config = loadConfig({ ...process.env, LOOM_TRUST_PROXY: "1" });
  if (new URL(config.publicBaseUrl).hostname.endsWith(".trycloudflare.com")) {
    throw new Error("Refusing Quick Tunnel URL. Configure a named Cloudflare Tunnel hostname first.");
  }

  const ownerToken = loadLoomFiles().auth.ownerToken?.trim() ?? process.env.LOOM_OAUTH_OWNER_TOKEN;
  const server = await startServer({ ...process.env, LOOM_TRUST_PROXY: "1" }, { handleSignals: false, quiet: true });
  const tunnelLogPath = join(config.stateDir, "cloudflared.log");

  let stopping = false;
  let tunnel: ChildProcess | undefined;
  let agentProviderConfigured = server.stats().agentProviderConfigured;
  let shutdownPromise: Promise<void> | undefined;
  let dashboard: ReturnType<typeof renderLoomDashboard> | undefined;
  const shutdown = () => shutdownPromise ??= (async () => {
    stopping = true;
    await Promise.all([server.close(), tunnel ? stopChild(tunnel, "cloudflared") : Promise.resolve()]);
  })();
  const renderDashboard = () => {
    if (!input.isTTY || !output.isTTY) return;
    dashboard = renderLoomDashboard({
      endpoint: new URL("/mcp", config.publicBaseUrl).toString(),
      ownerPassword: ownerToken,
      startedAt: Date.now(),
      getStats: () => ({ ...server.stats(), agentProviderConfigured }),
      onConfigureAgent: async () => {
        dashboard?.unmount();
        try {
          agentProviderConfigured = await configureAgentProvider(config.stateDir);
        } finally {
          if (!stopping) renderDashboard();
        }
      },
      onOpenLogs: async () => {
        const logPaths = [config.logging.filePath, tunnelLogPath].filter((path): path is string => Boolean(path));
        await Promise.all(logPaths.map(openLogFile));
      },
      onQuit: shutdown,
    });
  };

  renderDashboard();

  const stopFromSignal = () => { void shutdown().finally(() => dashboard?.unmount()); };
  process.once("SIGINT", stopFromSignal);
  process.once("SIGTERM", stopFromSignal);
  process.once("SIGHUP", stopFromSignal);

  let consecutiveFailures = 0;
  const runTunnel = async (): Promise<void> => {
    while (!stopping) {
      const startedAt = Date.now();
      prepareLogFile(tunnelLogPath);
      tunnel = spawn("cloudflared", ["tunnel", "--loglevel", "info", "--logfile", tunnelLogPath, "run", tunnelName], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      logEvent(config.logging, "info", "tunnel_started", { tunnelName, pid: tunnel.pid, logPath: tunnelLogPath });
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolvePromise) => {
        let settled = false;
        const finish = (value: { code: number | null; signal: NodeJS.Signals | null; error?: Error }) => {
          if (settled) return;
          settled = true;
          resolvePromise(value);
        };
        tunnel?.once("error", (error) => finish({ code: null, signal: null, error }));
        tunnel?.once("exit", (code, signal) => finish({ code, signal }));
      });
      tunnel = undefined;
      if (stopping) return;
      consecutiveFailures = Date.now() - startedAt >= TUNNEL_STABLE_MS ? 1 : consecutiveFailures + 1;
      logEvent(config.logging, "warn", "tunnel_exited", {
        tunnelName,
        code: result.code,
        signal: result.signal,
        error: result.error?.message,
        consecutiveFailures,
      });
      if (consecutiveFailures > TUNNEL_RESTART_LIMIT) {
        throw new Error(result.error?.message ?? `cloudflared exited with code ${result.code ?? result.signal}`);
      }
      const delayMs = 250 * 2 ** (consecutiveFailures - 1);
      logEvent(config.logging, "warn", "tunnel_restarting", { tunnelName, attempt: consecutiveFailures + 1, delayMs });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
    }
  };
  try {
    await runTunnel();
  } finally {
    if (stopping) await shutdownPromise;
    else {
      dashboard?.unmount();
      await server.close();
    }
  }
}

async function stopChild(child: ChildProcess, name: string): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 2_000)) return;
  child.kill("SIGKILL");
  if (!await waitForExit(child, 2_000)) throw new Error(`${name} did not exit`);
}

async function openLogFile(filePath: string): Promise<void> {
  prepareLogFile(filePath);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("/usr/bin/open", [filePath], { stdio: "ignore" });
    child.once("spawn", resolvePromise);
    child.once("error", reject);
    child.unref();
  });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off("exit", done); resolve(false); }, timeoutMs);
    child.once("exit", done);
  });
}

async function startServer(
  env: NodeJS.ProcessEnv,
  options: { handleSignals: boolean; quiet?: boolean },
): Promise<{ close(): Promise<void>; stats(): LoomDashboardStats }> {
  const sqliteStatus = checkSqliteNative();
  if (sqliteStatus !== "ok") {
    throw new Error(
      [
        "better-sqlite3 could not load for this Node runtime.",
        sqliteStatus,
        "",
        "Try reinstalling or rebuilding dependencies under the active Node version:",
        "  npm rebuild better-sqlite3",
      ].join("\n"),
    );
  }

  const { createServer } = await import("./server.js");
  const config = loadConfig(env);
  if (options.quiet) config.logging.consoleOutput = false;
  const { app, close, stats } = createServer(config);
  const httpServer = app.listen(config.port, config.host);
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const listening = () => {
        httpServer.off("error", failed);
        resolvePromise();
      };
      const failed = (error: Error) => {
        httpServer.off("listening", listening);
        reject(error);
      };
      httpServer.once("listening", listening);
      httpServer.once("error", failed);
    });
  } catch (error) {
    logEvent(config.logging, "error", "server_listen_failed", { host: config.host, port: config.port, error: error instanceof Error ? error.message : String(error) });
    await close().catch(() => undefined);
    throw error;
  }
  logEvent(config.logging, "info", "server_started", { host: config.host, port: config.port, publicBaseUrl: config.publicBaseUrl });
  if (!options.quiet) {
    console.log(`loom listening on http://${config.host}:${config.port}/mcp`);
    console.log(`public base url: ${config.publicBaseUrl}`);
    console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log(`allowed hosts: ${config.allowedHosts.join(", ")}`);
    if (config.allowedHosts.includes("*")) console.warn("warning: Host header allowlist is disabled");
    console.log("auth: Owner password approval required");
    console.log(`logging: ${config.logging.level} ${config.logging.format} ${config.logging.filePath}`);
  }

  let closing: Promise<void> | undefined;
  const closeServer = () => closing ??= new Promise<void>((resolvePromise, reject) => {
    if (!httpServer.listening) return resolvePromise();
    httpServer.close((error) => error ? reject(error) : resolvePromise());
    httpServer.closeAllConnections();
  }).then(close).then(() => {
    logEvent(config.logging, "info", "server_stopped", { host: config.host, port: config.port });
  });
  const shutdown = () => { void closeServer().catch((error) => {
    logEvent(config.logging, "error", "server_shutdown_failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }); };
  if (options.handleSignals) {
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("SIGHUP", shutdown);
  }

  return {
    stats,
    close: closeServer,
  };
}

async function runDoctor(): Promise<void> {
  const files = loadLoomFiles();
  console.log(`Config dir: ${files.dir}`);
  console.log(`Config file: ${files.configExists ? files.configPath : "missing"}`);
  console.log(`Auth file: ${files.authExists ? files.authPath : "missing"}`);
  console.log(`Node: ${process.version} (${nodeVersionStatus()})`);
  console.log(`Node ABI: ${process.versions.modules}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Git: ${checkGitAvailable()}`);
  for (const dependency of inspectExternalDependencies()) {
    console.log(`${dependency.command}: ${dependency.found ? dependency.path : `missing — ${dependency.install}`}`);
  }
  console.log(`SQLite native dependency: ${checkSqliteNative()}`);

  try {
    const config = loadConfig();
    console.log(`Local MCP URL: http://${config.host}:${config.port}/mcp`);
    console.log(`Public MCP URL: ${new URL("/mcp", config.publicBaseUrl).toString()}`);
    console.log(`Allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log(`Allowed hosts: ${config.allowedHosts.join(", ")}`);
    console.log(`Runtime log: ${config.logging.filePath}`);
    console.log(`Tunnel log: ${join(config.stateDir, "cloudflared.log")}`);
  } catch (error) {
    console.log(`Config status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function configureAgentProvider(stateDirectory: string): Promise<boolean> {
  const store = new AgentProviderStore({ stateDirectory });
  const current = await store.read();
  prompts.intro("Loom agent setup");
  const endpoint = await textPrompt({
    message: current ? `Provider endpoint (Enter keeps ${current.endpoint})` : "Provider endpoint",
    placeholder: current?.endpoint ?? "https://provider.example/v1",
    defaultValue: current?.endpoint ?? "",
    validate: (value) => {
      try {
        canonicalizeAgentEndpoint(value?.trim() ?? "");
        return undefined;
      } catch { return "Use HTTPS, or HTTP on loopback, with a /v1-compatible path."; }
    },
  });
  const apiKey = await passwordPrompt(current ? "Provider API key (Enter keeps the saved key)" : "Provider API key", current?.apiKey ?? "");
  const model = await textPrompt({
    message: current ? `Default model (Enter keeps ${current.model})` : "Default model",
    placeholder: current?.model ?? "coding-model",
    defaultValue: current?.model ?? "",
    validate: (value) => value?.trim() ? undefined : "Enter a model name.",
  });
  const status = await store.configure({ endpoint, apiKey, model });
  prompts.note(`Endpoint: ${status.endpoint}\nModel: ${status.model}\nAPI key: stored privately`, "Agent provider configured");
  prompts.outro("Press e again to update it.");
  return status.configured;
}

function runConfigCommand(args: string[]): void {
  const [subcommand, key, ...rest] = args;
  const files = loadLoomFiles();

  if (!subcommand || subcommand === "get") {
    console.log(JSON.stringify(files.config, null, 2));
    return;
  }

  if (subcommand !== "set") {
    throw new Error(`Unknown config command: ${subcommand}`);
  }

  const value = rest.join(" ").trim();
  if (key === "publicBaseUrl") {
    if (!value) throw new Error("Missing publicBaseUrl value.");
    writeLoomConfig({
      ...files.config,
      publicBaseUrl: normalizeOptionalPublicBaseUrl(value),
    });
    console.log(`Updated ${files.configPath}`);
    return;
  }

  if (key === "autoUpdate") {
    if (value !== "true" && value !== "false") {
      throw new Error("autoUpdate must be `true` or `false`.");
    }
    writeLoomConfig({
      ...files.config,
      autoUpdate: value === "true",
    });
    console.log(`Updated ${files.configPath}`);
    return;
  }

  throw new Error("Supported config keys: publicBaseUrl, autoUpdate.");
}

function runSkillCommand(args: string[]): void {
  const [subcommand, name] = args;

  if (!subcommand || subcommand === "list") {
    for (const skillName of listLoomSkillNames()) console.log(skillName);
    return;
  }

  if (subcommand === "path") {
    console.log(loomSkillsDir());
    return;
  }

  if (subcommand === "init") {
    if (!name) throw new Error("Usage: loom skill init <name>");
    ensureLoomHookAgents();
    console.log(`Created ${createLoomSkill(name)}`);
    return;
  }

  throw new Error(`Unknown skill command: ${subcommand}`);
}

function printHelp(): void {
  console.log(
    [
      "Loom",
      "",
      "Usage:",
      "  loom                 Run first-time setup if needed, then start the server",
      "  loom serve           Start the server",
      "  loom launch          Start the server and default Cloudflare Tunnel",
      "  loom launch <name>   Start with a different named Cloudflare Tunnel",
      "  loom init            Create or update ~/.loom/config.json and auth.json",
      "  loom doctor          Show config, runtime, and native dependency status",
      "  loom config get      Print persisted config",
      "  loom config set publicBaseUrl <url|null>",
      "  loom config set autoUpdate <true|false>",
      "  loom skill init <n>  Create ~/.loom/skills/<n>/SKILL.md",
      "  loom skill list      List Loom skills",
      "  loom skill path      Print the Loom skills directory",
      "  loom update          Update the global npm package",
      "  loom -v, --version   Print the installed version",
      "",
      "Named tunnel:",
      "  loom launch",
    ].join("\n"),
  );
}

function printVersion(): void {
  console.log(LOOM_VERSION);
}

function normalizeOptionalPublicBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "none") return null;

  return normalizePublicBaseUrl(trimmed);
}

type TextPromptOptions = Omit<Parameters<typeof prompts.text>[0], "validate"> & {
  defaultValue: string;
  validate?: (value: string | undefined) => string | Error | undefined;
};

async function textPrompt(options: TextPromptOptions): Promise<string> {
  const result = await prompts.text({
    ...options,
    validate: (value) => options.validate?.(value?.trim() ? value : options.defaultValue),
  });
  if (prompts.isCancel(result)) throw new SetupCancelledError();
  const value = String(result).trim();
  return value || options.defaultValue;
}

async function passwordPrompt(message: string, defaultValue: string): Promise<string> {
  const result = await prompts.password({
    message,
    mask: "*",
    validate: (value) => value?.trim() || defaultValue ? undefined : "Enter an API key.",
  });
  if (prompts.isCancel(result)) throw new SetupCancelledError();
  return String(result).trim() || defaultValue;
}

function validatePort(value: string | undefined): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? undefined
    : "Enter a port between 1 and 65535.";
}

function validateRequiredPublicBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "Enter the public URL from your tunnel or reverse proxy.";
  if (trimmed.endsWith("/mcp")) return "Enter the base URL only, without /mcp.";
  return validatePublicBaseUrl(trimmed);
}

function validatePublicBaseUrl(value: string): string | undefined {
  try {
    normalizePublicBaseUrl(value);
    return undefined;
  } catch {
    return "Use HTTPS for public URLs. HTTP is allowed only for localhost.";
  }
}

function assertSupportedNode(): void {
  if (satisfies(process.versions.node, SUPPORTED_NODE_RANGE)) return;

  throw new Error(
    [
      `Loom requires Node ${SUPPORTED_NODE_RANGE}.`,
      `Current Node: ${process.version}`,
      "",
      "Install Node 22 LTS or use a version manager such as nvm, fnm, or mise.",
    ].join("\n"),
  );
}

function nodeVersionStatus(): string {
  return satisfies(process.versions.node, SUPPORTED_NODE_RANGE)
    ? `supported ${SUPPORTED_NODE_RANGE}`
    : `unsupported, requires ${SUPPORTED_NODE_RANGE}`;
}

class SetupCancelledError extends Error {}

function checkSqliteNative(): string {
  try {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    return "ok";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function checkGitAvailable(): string {
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    return execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `unavailable (${message})`;
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
