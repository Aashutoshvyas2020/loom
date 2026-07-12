import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createLoomMcpServer, LoomToolRuntime } from "./loom-tools.js";

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
  return { root, client };
}

describe("Loom MCP surface", () => {
  it("exposes exactly seven complete Loom tools", async () => {
    const { client } = await connected();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "loom_terminal", "loom_read", "loom_write", "loom_edit", "loom_skills", "loom_memory", "loom_browser",
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
    expect(listed.tools.find((tool) => tool.name === "loom_terminal")?.inputSchema.properties).not.toHaveProperty("environment");
  });

  it("dispatches real files and returns hard tool failures", async () => {
    const { root, client } = await connected();
    const path = join(root, "note.txt");
    await client.callTool({ name: "loom_write", arguments: { path, content: "hello" } });
    const read: any = await client.callTool({ name: "loom_read", arguments: { path } });
    expect(read.content).toEqual([{ type: "text", text: "hello" }]);
    expect(read.structuredContent).toMatchObject({
      ok: true,
      action: "read",
      message: "Read 5 bytes",
      data: { text: "hello", bytes: 5, totalBytes: 5, encoding: "utf8" },
      loomVersion: "2.0.0",
      toolCallCount: 2,
    });
    const denied: any = await client.callTool({ name: "loom_read", arguments: { path: "/etc/hosts" } });
    expect(denied.isError).toBe(true);
  });

  it("injects bundled skills on call twenty for this MCP session", async () => {
    const { client } = await connected();
    let result: any;
    for (let call = 1; call <= 20; call += 1) {
      result = await client.callTool({ name: "loom_skills", arguments: { action: "diagnostics" } });
      if (call < 20) expect(result.content.some((entry: any) => entry.text?.includes("operating skills refresh"))).toBe(false);
    }
    expect(result.content.some((entry: any) => entry.text?.includes("Ponytail"))).toBe(true);
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
});
