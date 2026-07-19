import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { CHATGPT_INSTRUCTIONS, createLoomMcpServer, LoomToolRuntime, LOOM_VERSION } from "./loom-tools.js";

const runtimes: LoomToolRuntime[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function connected() {
  const root = await mkdtemp(join(tmpdir(), "loom-mcp-"));
  const state = join(root, ".state");
  roots.push(root);
  const runtime = new LoomToolRuntime({ allowedRoots: [root], stateDirectory: state, skillRoots: [] });
  runtimes.push(runtime);
  const server = createLoomMcpServer(runtime);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "loom-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { root, state, client, runtime };
}

describe("Loom MCP surface", () => {
  it("gives ChatGPT only the applicable behavior, shared guardrails, and Cavekit", () => {
    expect(CHATGPT_INSTRUCTIONS).toContain("[ChatGPT behavior]");
    expect(CHATGPT_INSTRUCTIONS).toContain("Think Before Coding");
    expect(CHATGPT_INSTRUCTIONS).toContain("Cavekit");
    expect(CHATGPT_INSTRUCTIONS).toContain("preserve existing user changes");
    expect(CHATGPT_INSTRUCTIONS).not.toContain("commentary channel");
    expect(CHATGPT_INSTRUCTIONS).not.toContain("apply_patch");
    expect(CHATGPT_INSTRUCTIONS).not.toContain("Codex desktop");
  });

  it("exposes the complete Loom tool surface", async () => {
    const { client } = await connected();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "loom_terminal", "loom_agents", "loom_read", "loom_write", "loom_edit", "loom_skills", "loom_memory", "loom_browser",
    ]);
    for (const tool of listed.tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toHaveLength(0);
      expect(tool.inputSchema).not.toHaveProperty("oneOf");
      expect(tool.inputSchema).not.toHaveProperty("anyOf");
      expect(tool.outputSchema).toMatchObject({
        type: "object",
        required: ["ok", "action", "message", "data", "loomVersion", "toolCallCount"],
        additionalProperties: false,
      });
      expect(tool._meta?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["loom"] }]);
      expect(tool._meta?.["openai/toolInvocation/invoking"]).toMatch(/…$/);
      expect(tool._meta?.["openai/toolInvocation/invoked"]).toMatch(/complete$/);
      expect(String(tool._meta?.["openai/toolInvocation/invoking"]).length).toBeLessThanOrEqual(64);
      expect(String(tool._meta?.["openai/toolInvocation/invoked"]).length).toBeLessThanOrEqual(64);
      expect(tool.description).toMatch(/\S/);
    }

    expect(listed.tools.find((tool) => tool.name === "loom_read")?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });
    expect(listed.tools.find((tool) => tool.name === "loom_skills")?.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    });
    const terminalTool = listed.tools.find((tool) => tool.name === "loom_terminal");
    expect(terminalTool?.inputSchema.properties).not.toHaveProperty("environment");
    expect((terminalTool?.inputSchema.properties?.action as any)?.enum).toEqual(["start", "poll", "input", "cancel", "repo"]);
    expect(listed.tools.find((tool) => tool.name === "loom_read")?.inputSchema.properties).not.toHaveProperty("asArtifact");
    const agentsTool = listed.tools.find((tool) => tool.name === "loom_agents");
    expect((agentsTool?.inputSchema.properties?.action as any)?.enum).toEqual(["status", "start", "poll", "message", "cancel", "list", "read", "delete"]);
    expect(agentsTool?.inputSchema.properties).not.toHaveProperty("system");
    expect(agentsTool?.inputSchema.properties).not.toHaveProperty("parentId");
    expect(agentsTool?.inputSchema.properties).not.toHaveProperty("detached");
    const memoryTool = listed.tools.find((tool) => tool.name === "loom_memory");
    expect((memoryTool?.inputSchema.properties?.action as any)?.enum).toEqual(["read", "add", "replace", "remove"]);
    expect(memoryTool?.inputSchema.properties).toMatchObject({
      content: { type: "string", minLength: 1, maxLength: 16_384 },
      oldText: { type: "string", minLength: 1, maxLength: 16_384 },
      newText: { type: "string", maxLength: 16_384 },
    });
    expect(memoryTool?.inputSchema.properties?.newText).not.toHaveProperty("minLength");
    expect(memoryTool?.inputSchema.properties).not.toHaveProperty("id");
    expect(memoryTool?.inputSchema.properties).not.toHaveProperty("title");
    expect(memoryTool?.inputSchema.properties).not.toHaveProperty("query");
  });

  it("dispatches real files and returns hard tool failures", async () => {
    const { root, client, runtime } = await connected();
    const path = join(root, "note.txt");
    await client.callTool({ name: "loom_write", arguments: { path, content: "hello" } });
    const read: any = await client.callTool({ name: "loom_read", arguments: { path } });
    expect(read.content).toEqual([{ type: "text", text: "hello" }]);
    expect(read.structuredContent).toMatchObject({
      ok: true,
      action: "read",
      message: "Read 5 bytes",
      data: { text: "hello", bytes: 5, totalBytes: 5, encoding: "utf8" },
      loomVersion: LOOM_VERSION,
      toolCallCount: 2,
    });
    expect(runtime.stats().chatgptTokens).toBeGreaterThan(0);
    expect(runtime.stats().totalTokens).toBe(runtime.stats().chatgptTokens);
    expect(JSON.stringify(read)).not.toContain("resource_link");

    const blocked: any = await client.callTool({ name: "loom_terminal", arguments: { action: "start", command: "sudo rm -rf /", cwd: root } });
    expect(blocked.isError).toBe(true);
    expect(blocked.structuredContent).toMatchObject({
      ok: false,
      action: "start",
      data: { code: "LOOM_DANGEROUS_COMMAND", rule: "privilege-escalation" },
    });

    const denied: any = await client.callTool({ name: "loom_read", arguments: { path: "/etc/hosts" } });
    expect(denied.isError).toBe(true);
  });

  it("injects bundled skills on call ten for this MCP session", async () => {
    const { client } = await connected();
    let result: any;
    for (let call = 1; call <= 10; call += 1) {
      result = await client.callTool({ name: "loom_skills", arguments: { action: "diagnostics" } });
      if (call < 10) expect(result.content.some((entry: any) => entry.text?.includes("operating skills refresh"))).toBe(false);
    }
    expect(result.content.some((entry: any) => entry.text?.includes("Ponytail"))).toBe(true);
    expect(result.content.some((entry: any) => entry.text?.includes("Cavekit"))).toBe(true);
    expect(result.content.some((entry: any) => entry.text?.includes("Think Before Coding"))).toBe(true);
    expect(result.content.some((entry: any) => entry.text?.includes("MEMORY.md"))).toBe(true);
    expect(result.content.some((entry: any) => /durable|reusable/.test(entry.text ?? ""))).toBe(true);
  });

  it("retains only the six most recent tool calls", async () => {
    const { client, runtime } = await connected();
    for (let call = 0; call < 8; call += 1) {
      await client.callTool({ name: "loom_skills", arguments: { action: "diagnostics" } });
    }
    expect(runtime.stats().recentActivity).toHaveLength(6);
  });

  it("curates one global durable MEMORY.md through the MCP contract", async () => {
    const { client, runtime, state } = await connected();
    const added: any = await client.callTool({
      name: "loom_memory",
      arguments: { action: "add", content: "Tool quirk:\nUse exact paths." },
    });
    expect(added.structuredContent.data).toEqual({ updated: true, bytes: 28 });

    const replaced: any = await client.callTool({
      name: "loom_memory",
      arguments: { action: "replace", oldText: "exact", newText: "absolute" },
    });
    expect(replaced.structuredContent.data).toEqual({ updated: true, bytes: 31 });

    const read: any = await client.callTool({ name: "loom_memory", arguments: { action: "read" } });
    expect(read.structuredContent.data).toEqual({ text: "Tool quirk:\nUse absolute paths.", bytes: 31 });
    expect(await runtime.memory.snapshot()).toBe("Tool quirk:\nUse absolute paths.");
    expect(await readFile(join(state, "memory", "MEMORY.md"), "utf8")).toBe("Tool quirk:\nUse absolute paths.\n");

    const removed: any = await client.callTool({
      name: "loom_memory",
      arguments: { action: "remove", oldText: "Tool quirk:\nUse absolute paths." },
    });
    expect(removed.structuredContent.data).toEqual({ updated: true, bytes: 0 });

    const empty: any = await client.callTool({ name: "loom_memory", arguments: { action: "read" } });
    expect(empty.structuredContent.data).toEqual({ text: "", bytes: 0 });
    expect(empty.content).toEqual([{ type: "text", text: "Memory is empty." }]);
  });

  it("returns hard tool errors when memory action fields are missing", async () => {
    const { client } = await connected();
    for (const arguments_ of [
      { action: "add" },
      { action: "replace", oldText: "present" },
      { action: "remove" },
    ]) {
      const result: any = await client.callTool({ name: "loom_memory", arguments: arguments_ });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ ok: false, data: { code: "LOOM_TOOL_ERROR" } });
    }
  });

  it("allows an empty replacement to remove exact memory text", async () => {
    const { client } = await connected();
    await client.callTool({ name: "loom_memory", arguments: { action: "add", content: "Temporary fact." } });

    const replaced: any = await client.callTool({
      name: "loom_memory",
      arguments: { action: "replace", oldText: "Temporary fact.", newText: "" },
    });
    expect(replaced.isError).not.toBe(true);
    expect(replaced.structuredContent.data).toEqual({ updated: true, bytes: 0 });

    const read: any = await client.callTool({ name: "loom_memory", arguments: { action: "read" } });
    expect(read.structuredContent.data).toEqual({ text: "", bytes: 0 });
  });

  it("rejects secrets and UTF-8 byte overflow without changing memory", async () => {
    const { client } = await connected();
    const secret: any = await client.callTool({
      name: "loom_memory",
      arguments: { action: "add", content: "token: abcdefghijklmnop" },
    });
    expect(secret.isError).toBe(true);
    expect(secret.content[0].text).toMatch(/secret/i);

    const overflow: any = await client.callTool({
      name: "loom_memory",
      arguments: { action: "add", content: "😀".repeat(5_000) },
    });
    expect(overflow.isError).toBe(true);
    expect(overflow.content[0].text).toMatch(/16384 bytes/i);

    const read: any = await client.callTool({ name: "loom_memory", arguments: { action: "read" } });
    expect(read.structuredContent.data).toEqual({ text: "", bytes: 0 });
  });

  it("suppresses unchanged repeat reads only inside a ten-call project window", async () => {
    const { root, client } = await connected();
    const path = join(root, "dedup.txt");
    await client.callTool({ name: "loom_write", arguments: { path, content: "same" } });

    const first: any = await client.callTool({ name: "loom_read", arguments: { path } });
    expect(first.content).toEqual([{ type: "text", text: "same" }]);

    const unchanged: any = await client.callTool({ name: "loom_read", arguments: { path } });
    expect(unchanged.content).toEqual([{ type: "text", text: "File has not changed since last read." }]);
    expect(unchanged.structuredContent.data).toMatchObject({ unchanged: true });

    for (let call = 0; call < 10; call += 1) {
      await client.callTool({ name: "loom_skills", arguments: { action: "diagnostics" } });
    }
    const refreshed: any = await client.callTool({ name: "loom_read", arguments: { path } });
    expect(refreshed.content).toEqual([{ type: "text", text: "same" }]);
  });

  it("reports child-free agent provider status without exposing secrets", async () => {
    const { client } = await connected();
    const status: any = await client.callTool({ name: "loom_agents", arguments: { action: "status" } });
    expect(status.structuredContent.data).toMatchObject({
      providerConfigured: false,
      childDelegation: false,
      fullToolAccess: true,
    });
    expect(JSON.stringify(status)).not.toContain("apiKey");
  });

  it("returns screenshots inline without materializable file attachments", async () => {
    const { client, runtime } = await connected();
    runtime.browser.screenshot = async () => ({
      structuredContent: { mimeType: "image/png", width: 1, height: 1, bytes: 3 },
      content: [{ type: "image", data: "cG5n", mimeType: "image/png" }],
    });

    const screenshot: any = await client.callTool({
      name: "loom_browser",
      arguments: { action: "screenshot", tabId: "test-tab" },
    });

    expect(screenshot.content).toEqual([{ type: "image", data: "cG5n", mimeType: "image/png" }]);
    expect(JSON.stringify(screenshot)).not.toContain("resource_link");
    expect(JSON.stringify(screenshot)).not.toContain("loom-artifact://");
  });
});
