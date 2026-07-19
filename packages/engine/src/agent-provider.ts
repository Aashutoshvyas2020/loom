import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, open, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ensurePrivateStateDirectory } from "@loom-local/loom-v2";

const MAX_ENDPOINT_BYTES = 4_096;
const MAX_API_KEY_BYTES = 16 * 1_024;
const MAX_MODEL_BYTES = 512;
const MAX_RESPONSE_BYTES = 2 * 1_024 * 1_024;
const MAX_ERROR_BYTES = 4_096;
const MAX_TOOL_CALLS_PER_RESPONSE = 16;
const MAX_TOOL_ARGUMENT_BYTES = 256 * 1_024;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface AgentProviderConfig {
  version: 1;
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface AgentProviderStatus {
  configured: boolean;
  endpoint: string | null;
  model: string | null;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: AgentToolCall[] }
  | { role: "tool"; text: string; toolCallId: string; name: string };

export interface AgentCompletionInput {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  timeoutMs: number;
  signal: AbortSignal;
}

export interface AgentCompletionResult {
  text: string;
  toolCalls: AgentToolCall[];
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface AgentProviderClientOptions {
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export class AgentProviderError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly attempts: number;

  constructor(
    message: string,
    options: ErrorOptions & {
      code?: string;
      status?: number;
      retryable?: boolean;
      attempts?: number;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AgentProviderError";
    this.code = options.code ?? "provider_error";
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.attempts = options.attempts ?? 1;
  }
}

function currentUserId(): number {
  if (process.getuid === undefined) throw new AgentProviderError("Provider storage requires a POSIX user ID.", { code: "unsupported_platform" });
  return process.getuid();
}

function isLoopback(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

export function canonicalizeAgentEndpoint(value: string): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > MAX_ENDPOINT_BYTES) {
    throw new AgentProviderError("Provider endpoint must contain 1-4096 bytes.", { code: "invalid_endpoint" });
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new AgentProviderError("Provider endpoint must be a valid URL.", { code: "invalid_endpoint", cause: error });
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new AgentProviderError("Provider endpoint must use HTTPS; loopback HTTP is allowed for local servers.", { code: "invalid_endpoint" });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AgentProviderError("Provider endpoint must not contain credentials, query parameters, or fragments.", { code: "invalid_endpoint" });
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname !== "" && pathname !== "/v1" && !pathname.endsWith("/v1")) {
    throw new AgentProviderError("Provider endpoint must be a server root or an API path ending in /v1.", { code: "invalid_endpoint" });
  }
  return `${url.origin}${pathname || "/v1"}`;
}

function validateSecret(value: string, name: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > maximumBytes || /[\u0000\r\n]/.test(value)) {
    throw new AgentProviderError(`${name} must contain 1-${maximumBytes} bytes without NULs or line breaks.`, { code: `invalid_${name === "API key" ? "api_key" : "model"}` });
  }
  return value;
}

function validateConfig(input: { endpoint: string; apiKey: string; model: string }): AgentProviderConfig {
  return {
    version: 1,
    endpoint: canonicalizeAgentEndpoint(input.endpoint),
    apiKey: validateSecret(input.apiKey, "API key", MAX_API_KEY_BYTES),
    model: validateSecret(input.model, "model", MAX_MODEL_BYTES),
  };
}

async function assertNotSymlink(inputPath: string): Promise<void> {
  try {
    if ((await lstat(inputPath)).isSymbolicLink()) throw new AgentProviderError(`Provider path is a symbolic link: ${inputPath}`, { code: "unsafe_provider_state" });
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  try {
    await ensurePrivateStateDirectory(directory);
  } catch (error) {
    throw new AgentProviderError("Provider state directory is unsafe.", { code: "unsafe_provider_state", cause: error instanceof Error ? error : undefined });
  }
}

async function assertPrivateFile(filePath: string): Promise<void> {
  await assertNotSymlink(filePath);
  const stats = await lstat(filePath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.uid !== currentUserId() || (stats.mode & 0o777) !== 0o600) {
    throw new AgentProviderError("Provider configuration must be a private 0600 current-user file.", { code: "unsafe_provider_state" });
  }
}

async function readPrivateProviderFile(filePath: string): Promise<string> {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new AgentProviderError("Provider storage requires O_NOFOLLOW support.", { code: "unsafe_provider_state" });
  }
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: any) {
    if (error?.code === "ENOENT") throw error;
    throw new AgentProviderError("Unable to safely open provider configuration.", { code: "unsafe_provider_state", cause: error instanceof Error ? error : undefined });
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.uid !== currentUserId() || (stats.mode & 0o777) !== 0o600) {
      throw new AgentProviderError("Provider configuration must be a private 0600 current-user file.", { code: "unsafe_provider_state" });
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function parseConfig(raw: string): AgentProviderConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AgentProviderError("Provider configuration is not valid JSON.", { code: "invalid_provider_config", cause: error });
  }
  if (!parsed || typeof parsed !== "object") throw new AgentProviderError("Provider configuration has an invalid shape.", { code: "invalid_provider_config" });
  const value = parsed as Record<string, unknown>;
  if (value.version !== 1 || typeof value.endpoint !== "string" || typeof value.apiKey !== "string" || typeof value.model !== "string") {
    throw new AgentProviderError("Provider configuration has an invalid or unsupported shape.", { code: "invalid_provider_config" });
  }
  return validateConfig({ endpoint: value.endpoint, apiKey: value.apiKey, model: value.model });
}

export class AgentProviderStore {
  readonly #file: string;
  readonly #directory: string;

  constructor(options: { stateDirectory: string }) {
    const stateDirectory = resolve(options.stateDirectory);
    this.#directory = join(stateDirectory, "agents");
    this.#file = join(this.#directory, "provider.json");
  }

  async configure(input: { endpoint: string; apiKey: string; model: string }): Promise<AgentProviderStatus> {
    const config = validateConfig(input);
    await ensurePrivateDirectory(this.#directory);
    await assertNotSymlink(this.#file);
    const temporary = join(this.#directory, `.provider-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, this.#file);
      await assertPrivateFile(this.#file);
    } catch (error) {
      await rm(temporary, { force: true });
      if (error instanceof AgentProviderError) throw error;
      throw new AgentProviderError("Unable to write provider configuration.", { code: "provider_storage_error", cause: error instanceof Error ? error : undefined });
    }
    return { configured: true, endpoint: config.endpoint, model: config.model };
  }

  async read(): Promise<AgentProviderConfig | null> {
    await ensurePrivateDirectory(this.#directory);
    try {
      return parseConfig(await readPrivateProviderFile(this.#file));
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      if (error instanceof AgentProviderError) throw error;
      throw new AgentProviderError("Unable to read provider configuration.", { code: "provider_storage_error", cause: error instanceof Error ? error : undefined });
    }
  }

  async status(): Promise<AgentProviderStatus> {
    const config = await this.read();
    return config === null
      ? { configured: false, endpoint: null, model: null }
      : { configured: true, endpoint: config.endpoint, model: config.model };
  }

  async clear(): Promise<boolean> {
    await ensurePrivateDirectory(this.#directory);
    try {
      await assertPrivateFile(this.#file);
      await rm(this.#file);
      return true;
    } catch (error: any) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Operation aborted."));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Operation aborted."));
    };
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolvePromise();
    };
    const timer = setTimeout(done, milliseconds);
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function boundedErrorBody(value: string): string {
  return Buffer.from(value, "utf8").subarray(0, MAX_ERROR_BYTES).toString("utf8").replace(/\s+/g, " ").trim();
}

function messagesForApi(system: string, messages: AgentMessage[]): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  if (system) output.push({ role: "system", content: system });
  for (const message of messages) {
    if (message.role === "user") output.push({ role: "user", content: message.text });
    else if (message.role === "assistant") output.push({
      role: "assistant",
      content: message.text,
      ...(message.toolCalls?.length ? {
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      } : {}),
    });
    else output.push({ role: "tool", content: message.text, tool_call_id: message.toolCallId });
  }
  return output;
}

function toolDefinitionsForApi(tools: AgentToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

function stringContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => typeof part === "string" ? part : part && typeof part === "object" && typeof (part as any).text === "string" ? (part as any).text : "").join("");
}

function parseCompletion(payload: unknown, requestedModel: string, estimatedPromptTokens: number): AgentCompletionResult {
  if (!payload || typeof payload !== "object") throw new AgentProviderError("Provider returned an invalid response.", { code: "provider_protocol_error" });
  const choice = (payload as any).choices?.[0];
  const message = choice?.message;
  if (!message || typeof message !== "object") throw new AgentProviderError("Provider response did not contain an assistant message.", { code: "provider_protocol_error" });
  const toolCalls: AgentToolCall[] = [];
  const providerToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (providerToolCalls.length > MAX_TOOL_CALLS_PER_RESPONSE) throw new AgentProviderError("Provider returned too many tool calls.", { code: "provider_protocol_error" });
  for (const call of providerToolCalls) {
    const id = call?.id;
    const name = call?.function?.name;
    const rawArguments = call?.function?.arguments;
    if (typeof id !== "string" || id.length === 0 || id.length > 512 || typeof name !== "string" || name.length === 0 || name.length > 128 || typeof rawArguments !== "string" || Buffer.byteLength(rawArguments) > MAX_TOOL_ARGUMENT_BYTES) throw new AgentProviderError("Provider returned a malformed tool call.", { code: "provider_protocol_error" });
    let arguments_: unknown;
    try { arguments_ = JSON.parse(rawArguments); } catch (error) { throw new AgentProviderError("Provider returned invalid JSON tool arguments.", { code: "provider_protocol_error", cause: error }); }
    if (!arguments_ || typeof arguments_ !== "object" || Array.isArray(arguments_)) throw new AgentProviderError("Provider tool arguments must be a JSON object.", { code: "provider_protocol_error" });
    toolCalls.push({ id, name, arguments: arguments_ as Record<string, unknown> });
  }
  const model = typeof (payload as any).model === "string" && (payload as any).model ? (payload as any).model : requestedModel;
  const usage = parseUsage(payload as Record<string, unknown>) ?? {
    promptTokens: estimatedPromptTokens,
    completionTokens: estimateTokenCount(JSON.stringify({ content: message.content ?? "", tool_calls: providerToolCalls })),
    totalTokens: estimatedPromptTokens + estimateTokenCount(JSON.stringify({ content: message.content ?? "", tool_calls: providerToolCalls })),
  };
  return { text: stringContent(message.content), toolCalls, model, ...(usage ? { usage } : {}) };
}

/** Deterministic display estimate used when a provider omits token usage. */
export function estimateTokenCount(value: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(value, "utf8") / 4));
}

function parseUsage(payload: Record<string, unknown>): AgentCompletionResult["usage"] {
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
  const promptTokens = tokenCount(usage.prompt_tokens ?? payload.prompt_eval_count);
  const completionTokens = tokenCount(usage.completion_tokens ?? payload.eval_count);
  const explicitTotal = tokenCount(usage.total_tokens);
  if (promptTokens === undefined && completionTokens === undefined && explicitTotal === undefined) return undefined;
  const prompt = promptTokens ?? 0;
  const completion = completionTokens ?? 0;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: explicitTotal ?? prompt + completion };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export class AgentProviderClient {
  readonly #config: AgentProviderConfig;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #random: () => number;

  constructor(config: AgentProviderConfig, options: AgentProviderClientOptions = {}) {
    this.#config = config;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
  }

  async complete(input: AgentCompletionInput): Promise<AgentCompletionResult> {
    const body = JSON.stringify({
      model: input.model,
      messages: messagesForApi(input.system, input.messages),
      tools: toolDefinitionsForApi(input.tools),
      tool_choice: "auto",
    });
    let lastError: AgentProviderError | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.#request(body, input, attempt);
      } catch (error) {
        const providerError = error instanceof AgentProviderError
          ? error
          : new AgentProviderError("Provider request failed.", { code: "provider_request_failed", retryable: true, cause: error instanceof Error ? error : undefined, attempts: attempt });
        lastError = providerError;
        if (!providerError.retryable || attempt === MAX_ATTEMPTS) break;
        const delay = RETRY_DELAY_MS * 2 ** (attempt - 1) + Math.floor(this.#random() * RETRY_DELAY_MS);
        await this.#sleep(delay, input.signal);
      }
    }
    throw new AgentProviderError(lastError?.message ?? "Provider request failed.", {
      code: lastError?.code ?? "provider_request_failed",
      status: lastError?.status,
      retryable: lastError?.retryable ?? false,
      attempts: MAX_ATTEMPTS,
      cause: lastError,
    });
  }

  async #request(body: string, input: AgentCompletionInput, attempt: number): Promise<AgentCompletionResult> {
    if (input.signal.aborted) throw new AgentProviderError("Provider request was cancelled.", { code: "provider_cancelled", attempts: attempt });
    const timeout = AbortSignal.timeout(input.timeoutMs);
    const signal = AbortSignal.any([input.signal, timeout]);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.endpoint}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.#config.apiKey}`, "content-type": "application/json" },
        body,
        signal,
      });
    } catch (error) {
      if (input.signal.aborted) throw new AgentProviderError("Provider request was cancelled.", { code: "provider_cancelled", attempts: attempt, cause: error instanceof Error ? error : undefined });
      if (timeout.aborted) throw new AgentProviderError("Provider request timed out.", { code: "provider_timeout", retryable: true, attempts: attempt, cause: error instanceof Error ? error : undefined });
      throw new AgentProviderError("Provider request failed.", { code: "provider_request_failed", retryable: true, attempts: attempt, cause: error instanceof Error ? error : undefined });
    }
    let raw: string;
    try {
      raw = await response.text();
    } catch (error) {
      throw new AgentProviderError("Provider response could not be read.", { code: "provider_request_failed", retryable: true, attempts: attempt, cause: error instanceof Error ? error : undefined });
    }
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new AgentProviderError("Provider response exceeded the response limit.", { code: "provider_response_limit", attempts: attempt });
    if (!response.ok) {
      const detail = boundedErrorBody(raw);
      throw new AgentProviderError(`Provider returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`, {
        code: "provider_http_error",
        status: response.status,
        retryable: TRANSIENT_STATUSES.has(response.status),
        attempts: attempt,
      });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (error) { throw new AgentProviderError("Provider returned invalid JSON.", { code: "provider_protocol_error", attempts: attempt, cause: error }); }
    return parseCompletion(parsed, input.model, estimateTokenCount(body));
  }
}
