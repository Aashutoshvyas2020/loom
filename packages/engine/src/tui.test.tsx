import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { LoomDashboard } from "./tui.js";
import { LOOM_VERSION } from "./version.js";

describe("Loom terminal dashboard", () => {
  it("renders a compact operational dashboard", async () => {
    let checkedUrl = "";
    const view = render(
      <LoomDashboard
        endpoint="https://loom.example.com/mcp"
        ownerPassword="owner-secret"
        startedAt={Date.now() - 5_000}
        checkHealth={async (url) => {
          checkedUrl = url;
          return false;
        }}
        getStats={() => ({
          activeTerminalJobs: 2,
          browserTabs: 1,
          skills: 23,
          memories: 4,
          sessions: 3,
          toolCalls: 17,
          toolErrors: 1,
          agentProviderConfigured: true,
          agentTokens: 12_345,
          chatgptTokens: 678,
          totalTokens: 13_023,
          recentActivity: ["loom_read · ok", "loom_terminal:start · error"],
        })}
        onQuit={() => {}}
      />,
    );
    const output = view.lastFrame() ?? "";
    expect(output).toContain("LOOM / LOCAL MCP");
    expect(output).toContain(`v${LOOM_VERSION}`);
    expect(output).toContain("https://loom.example.com/mcp");
    expect(output).toContain("owner-secret");
    expect(output).toContain("Public    connecting — wait before connecting ChatGPT");
    expect(output).toContain("Sessions  3");
    expect(output).toContain("Calls     17");
    expect(output).toContain("Errors    1");
    expect(output).toContain("Agent tok 12,345");
    expect(output).toContain("ChatGPT tok 678");
    expect(output).toContain("Total tok 13,023");
    expect(output).toContain("Provider  ready");
    expect(output).toContain("Jobs 2");
    expect(output).toContain("Tabs 1");
    expect(output).toContain("Skills 23");
    expect(output).toContain("Memory 4");
    expect(output).toContain("RECENT ACTIVITY");
    expect(output).toContain("loom_read · ok");
    expect(output).toContain("q quit");
    expect(output).toContain("p password");
    expect(output).toContain("l logs");
    await vi.waitFor(() => expect(checkedUrl).toBe("https://loom.example.com/.well-known/oauth-protected-resource/mcp"));
  });

  it("shows terminated only after quit cleanup completes", async () => {
    let finishQuit!: () => void;
    const quitting = new Promise<void>((resolve) => { finishQuit = resolve; });
    const view = render(
      <LoomDashboard
        endpoint="https://loom.example.com/mcp"
        startedAt={Date.now()}
        checkHealth={async () => false}
        getStats={() => ({
          activeTerminalJobs: 0, browserTabs: 0, skills: 3, memories: 0,
          sessions: 0, toolCalls: 0, toolErrors: 0, recentActivity: [],
        })}
        onQuit={() => quitting}
      />,
    );

    view.stdin.write("q");
    await vi.waitFor(() => expect(view.lastFrame()).toContain("TERMINATING"));
    finishQuit();
    await vi.waitFor(() => expect(view.lastFrame()).toContain("TERMINATED"));
  });

  it("labels public reachability without claiming the connector session is ready", async () => {
    const view = render(
      <LoomDashboard
        endpoint="https://loom.example.com/mcp"
        startedAt={Date.now()}
        checkHealth={async () => true}
        getStats={() => ({
          activeTerminalJobs: 0, browserTabs: 0, skills: 3, memories: 0,
          sessions: 0, toolCalls: 0, toolErrors: 0, recentActivity: [],
        })}
        onQuit={() => {}}
      />,
    );

    await vi.waitFor(() => expect(view.lastFrame()).toContain("PUBLIC READY"));
    expect(view.lastFrame()).toContain("connector session is separate");
    expect(view.lastFrame()).not.toContain("● READY");
  });

  it("opens agent endpoint setup from the dashboard", async () => {
    let setupCalls = 0;
    const view = render(
      <LoomDashboard
        endpoint="https://loom.example.com/mcp"
        startedAt={Date.now()}
        checkHealth={async () => false}
        getStats={() => ({
          activeTerminalJobs: 0, browserTabs: 0, skills: 3, memories: 0,
          sessions: 0, toolCalls: 0, toolErrors: 0, recentActivity: [],
        })}
        onConfigureAgent={() => { setupCalls += 1; }}
        onQuit={() => {}}
      />,
    );

    view.stdin.write("e");
    await vi.waitFor(() => expect(setupCalls).toBe(1));
  });

  it("opens runtime logs from the dashboard", async () => {
    let openCalls = 0;
    const view = render(
      <LoomDashboard
        endpoint="https://loom.example.com/mcp"
        startedAt={Date.now()}
        checkHealth={async () => false}
        getStats={() => ({
          activeTerminalJobs: 0, browserTabs: 0, skills: 5, memories: 0,
          sessions: 0, toolCalls: 0, toolErrors: 0, recentActivity: [],
        })}
        onOpenLogs={() => { openCalls += 1; }}
        onQuit={() => {}}
      />,
    );

    view.stdin.write("l");
    await vi.waitFor(() => expect(openCalls).toBe(1));
    expect(view.lastFrame()).toContain("opening logs");
  });
});
