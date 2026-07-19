import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentProviderClient,
  AgentProviderError,
  AgentProviderStore,
  canonicalizeAgentEndpoint,
} from "./agent-provider.js";

describe("agent provider policy", () => {
  it("normalizes compatible endpoints and rejects unsafe transport", () => {
    expect(canonicalizeAgentEndpoint("http://127.0.0.1")).toBe("http://127.0.0.1/v1");
    expect(canonicalizeAgentEndpoint("https://provider.example/v1/")).toBe("https://provider.example/v1");
    expect(() => canonicalizeAgentEndpoint("http://provider.example/v1")).toThrow(/HTTPS/);
    expect(() => canonicalizeAgentEndpoint("https://user:pass@provider.example/v1")).toThrow(/credentials/);
    expect(() => canonicalizeAgentEndpoint("https://provider.example/api")).toThrow(/\/v1/);
  });

  it("stores only a private provider record and redacts status", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-agent-provider-"));
    try {
      const store = new AgentProviderStore({ stateDirectory: root });
      const status = await store.configure({
        endpoint: "http://localhost:8080/v1",
        apiKey: "secret-key",
        model: "coding-model",
      });
      expect(status).toEqual({ configured: true, endpoint: "http://localhost:8080/v1", model: "coding-model" });
      expect(status).not.toHaveProperty("apiKey");
      const file = join(root, "agents", "provider.json");
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ apiKey: "secret-key", model: "coding-model" });
      expect(await store.status()).toEqual(status);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe ancestors and symlinks in provider storage paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-agent-provider-unsafe-"));
    try {
      const writable = join(root, "writable");
      await mkdir(writable);
      await chmod(writable, 0o777);
      await expect(new AgentProviderStore({ stateDirectory: join(writable, "state") }).configure({
        endpoint: "http://localhost:8080/v1",
        apiKey: "secret-key",
        model: "coding-model",
      })).rejects.toMatchObject({ code: "unsafe_provider_state" });

      const target = join(root, "target");
      const linked = join(root, "linked");
      await mkdir(target);
      await symlink(target, linked);
      await expect(new AgentProviderStore({ stateDirectory: join(linked, "state") }).configure({
        endpoint: "http://localhost:8080/v1",
        apiKey: "secret-key",
        model: "coding-model",
      })).rejects.toMatchObject({ code: "unsafe_provider_state" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("agent provider client", () => {
  it("retries transient HTTP failures and parses tool calls", async () => {
    let calls = 0;
    const delays: number[] = [];
    const client = new AgentProviderClient({
      version: 1,
      endpoint: "http://127.0.0.1:8080/v1",
      apiKey: "secret-key",
      model: "coding-model",
    }, {
      fetchImplementation: async () => {
        calls += 1;
        if (calls === 1) return new Response("busy", { status: 503 });
        return new Response(JSON.stringify({
          model: "coding-model",
          usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
          choices: [{ message: {
            content: "I will inspect the file.",
            tool_calls: [{ id: "call-1", function: { name: "loom_read", arguments: '{"path":"README.md"}' } }],
          } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      random: () => 0,
    });

    const result = await client.complete({
      model: "coding-model",
      system: "You are a coding agent.",
      messages: [{ role: "user", text: "Inspect the README." }],
      tools: [{ name: "loom_read", description: "Read a file.", parameters: { type: "object" } }],
      timeoutMs: 1_000,
      signal: AbortSignal.timeout(1_000),
    });
    expect(calls).toBe(2);
    expect(delays).toEqual([250]);
    expect(result).toMatchObject({ text: "I will inspect the file.", model: "coding-model" });
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 30, totalTokens: 150 });
    expect(result.toolCalls).toEqual([{ id: "call-1", name: "loom_read", arguments: { path: "README.md" } }]);
  });

  it("does not retry malformed successful responses", async () => {
    let calls = 0;
    const client = new AgentProviderClient({
      version: 1,
      endpoint: "http://127.0.0.1:8080/v1",
      apiKey: "secret-key",
      model: "coding-model",
    }, {
      fetchImplementation: async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      },
      sleep: async () => undefined,
    });

    await expect(client.complete({
      model: "coding-model",
      system: "",
      messages: [],
      tools: [],
      timeoutMs: 1_000,
      signal: AbortSignal.timeout(1_000),
    })).rejects.toMatchObject({ code: "provider_protocol_error" });
    expect(calls).toBe(1);
  });

  it("estimates usage when Ollama omits token metadata", async () => {
    let requestBody = "";
    const client = new AgentProviderClient({
      version: 1,
      endpoint: "http://127.0.0.1:11434/v1",
      apiKey: "ollama",
      model: "coding-model",
    }, {
      fetchImplementation: async (_url, init) => {
        requestBody = String(init?.body ?? "");
        return new Response(JSON.stringify({
          model: "coding-model",
          choices: [{ message: { content: "Done.", tool_calls: [] } }],
        }), { status: 200 });
      },
    });

    const result = await client.complete({
      model: "coding-model",
      system: "You are a coding agent.",
      messages: [{ role: "user", text: "Inspect the README." }],
      tools: [],
      timeoutMs: 1_000,
      signal: AbortSignal.timeout(1_000),
    });

    expect(result.usage).toEqual({
      promptTokens: Math.max(1, Math.ceil(Buffer.byteLength(requestBody, "utf8") / 4)),
      completionTokens: Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify({ content: "Done.", tool_calls: [] }), "utf8") / 4)),
      totalTokens: expect.any(Number),
    });
    expect(result.usage?.totalTokens).toBe(result.usage!.promptTokens + result.usage!.completionTokens);
  });
});
