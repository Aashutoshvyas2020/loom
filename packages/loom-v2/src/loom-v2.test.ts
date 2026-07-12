import { describe, expect, it, vi } from "vitest";

async function optionalModule<T>(path: string, fallback: T): Promise<T> {
  try {
    return await import(/* @vite-ignore */ path) as T;
  } catch {
    return fallback;
  }
}

describe("Loom V2 tool contract", () => {
  it("advertises exactly the seven Loom tools with complete schemas", async () => {
    const module = await optionalModule<{ TOOL_DESCRIPTORS?: unknown[] }>("./tool-descriptors.js", {});
    const descriptors = module.TOOL_DESCRIPTORS ?? [];
    const names = descriptors.map((descriptor: any) => descriptor.name);

    expect(names).toEqual([
      "loom_terminal",
      "loom_read",
      "loom_write",
      "loom_edit",
      "loom_skills",
      "loom_memory",
      "loom_browser",
    ]);

    for (const descriptor of descriptors as any[]) {
      expect(descriptor.title).toBeTruthy();
      expect(descriptor.description).toBeTruthy();
      expect(descriptor.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(descriptor.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(Object.keys(descriptor.inputSchema.properties ?? {}).length).toBeGreaterThan(0);
      expect(descriptor.securitySchemes[0].scopes.length).toBeGreaterThan(0);
      expect(descriptor.annotations).toEqual({
        readOnlyHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
      });
    }

    const browser = (descriptors as any[]).find((descriptor) => descriptor.name === "loom_browser");
    expect(browser.inputSchema.properties.action.enum).not.toContain("evaluate");
    expect(browser.inputSchema.properties.action.enum).toContain("prepare");
    expect(browser.inputSchema.properties.action.enum).toContain("commit");
  });

  it("injects bundled operating skills every twentieth call per authenticated session", async () => {
    const module = await optionalModule<any>("./session-hook.js", {});
    const hook = module.SessionSkillHook ? new module.SessionSkillHook() : undefined;

    for (let call = 1; call < 20; call += 1) {
      expect(hook?.record("session-a")).toMatchObject({ callCount: call, reminder: undefined });
    }
    expect(hook?.record("session-b")).toMatchObject({ callCount: 1, reminder: undefined });

    const twentieth = hook?.record("session-a");
    expect(twentieth).toMatchObject({ callCount: 20, reminder: expect.any(String) });
    expect(twentieth.reminder).toContain("Ponytail");
    expect(twentieth.reminder).toContain("Using Superpowers");
    expect(twentieth.reminder).toContain("Caveman");

    for (let call = 21; call < 40; call += 1) hook?.record("session-a");
    expect(hook?.record("session-a")).toMatchObject({ callCount: 40, reminder: expect.any(String) });
  });

  it("returns requested text and images in model-visible content", async () => {
    const module = await optionalModule<any>("./results.js", {});
    expect(module.textResult?.({ text: "hello", bytes: 5 })).toEqual({
      structuredContent: { text: "hello", bytes: 5 },
      content: [{ type: "text", text: "hello" }],
    });
    expect(module.imageResult?.({ data: "YWJj", mimeType: "image/png", sha256: "abc" })).toEqual({
      structuredContent: { mimeType: "image/png", sha256: "abc" },
      content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    });
  });
});

describe("browser policy", () => {
  it("allows public HTTP(S), rejects local and active-content URLs", async () => {
    const module = await optionalModule<any>("./browser-policy.js", {});
    expect(module.assertBrowserUrl?.("https://example.com/path")).toBe("https://example.com/path");
    expect(module.assertBrowserUrl?.("about:blank")).toBe("about:blank");
    for (const url of [
      "file:///tmp/a", "javascript:alert(1)", "data:text/html,hi",
      "http://127.0.0.1", "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.1", "http://172.16.0.1", "http://192.168.1.1", "http://[::1]",
    ]) {
      expect(() => module.assertBrowserUrl?.(url)).toThrow();
    }
    await expect(module.assertBrowserNetworkUrl?.("http://127.0.0.1")).rejects.toThrow(/private/i);
  });

  it("commits one exact prepared action once before expiry", async () => {
    vi.useFakeTimers();
    const module = await optionalModule<any>("./browser-policy.js", {});
    const approvals = module.ActionApprovals ? new module.ActionApprovals(30_000) : undefined;
    const prepared = approvals?.prepare({ tabId: "tab-1", ref: "r7", operation: "click", target: "Publish" });
    expect(prepared).toMatchObject({ actionId: expect.any(String), target: "Publish" });
    expect(approvals?.commit(prepared.actionId)).toMatchObject({ target: "Publish" });
    expect(() => approvals?.commit(prepared.actionId)).toThrow(/used/i);

    const expired = approvals?.prepare({ tabId: "tab-1", ref: "r8", operation: "click", target: "Delete" });
    vi.advanceTimersByTime(30_001);
    expect(() => approvals?.commit(expired.actionId)).toThrow(/expired/i);
    vi.useRealTimers();
  });
});
