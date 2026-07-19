import { spawn } from "node:child_process";
import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput, type Instance } from "ink";
import { LOOM_VERSION } from "./loom-tools.js";

export interface LoomDashboardStats {
  activeTerminalJobs: number;
  browserTabs: number;
  skills: number;
  memories: number;
  sessions: number;
  toolCalls: number;
  toolErrors: number;
  recentActivity: string[];
  activeAgents?: number;
  queuedAgents?: number;
  retainedAgents?: number;
  agentProviderConfigured?: boolean;
  agentTokens?: number;
  chatgptTokens?: number;
  totalTokens?: number;
}

export interface LoomDashboardProps {
  endpoint: string;
  ownerPassword?: string;
  startedAt: number;
  checkHealth?(endpoint: string): Promise<boolean>;
  getStats(): LoomDashboardStats;
  onConfigureAgent?(): void | Promise<void>;
  onOpenLogs?(): void | Promise<void>;
  onQuit(): void | Promise<void>;
}

async function checkPublicHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export function LoomDashboard(props: LoomDashboardProps) {
  const { exit } = useApp();
  const [stats, setStats] = useState(props.getStats());
  const [seconds, setSeconds] = useState(Math.max(0, Math.floor((Date.now() - props.startedAt) / 1_000)));
  const [note, setNote] = useState("");
  const [tunnelReady, setTunnelReady] = useState(false);
  const [lifecycle, setLifecycle] = useState<"running" | "terminating" | "terminated">("running");

  useEffect(() => {
    const timer = setInterval(() => {
      setStats(props.getStats());
      setSeconds(Math.max(0, Math.floor((Date.now() - props.startedAt) / 1_000)));
    }, 1_000);
    timer.unref();
    return () => clearInterval(timer);
  }, [props]);

  useEffect(() => {
    let active = true;
    let timer: NodeJS.Timeout | undefined;
    const check = async () => {
      const discoveryUrl = new URL("/.well-known/oauth-protected-resource/mcp", props.endpoint).toString();
      const ready = await (props.checkHealth ?? checkPublicHealth)(discoveryUrl);
      if (!active) return;
      setTunnelReady(ready);
      if (!ready) {
        timer = setTimeout(check, 2_000);
        timer.unref();
      }
    };
    void check();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [props.checkHealth, props.endpoint]);

  useInput((input) => {
    if (input === "q" && lifecycle === "running") {
      setLifecycle("terminating");
      void Promise.resolve(props.onQuit()).then(() => {
        setLifecycle("terminated");
        setTimeout(exit, 300);
      }).catch((error) => {
        setLifecycle("running");
        setNote(`shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    if (input === "c") {
      const clipboard = spawn("/usr/bin/pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      clipboard.stdin.end(props.endpoint);
      setNote("endpoint copied");
    }
    if (input === "p" && props.ownerPassword) {
      const clipboard = spawn("/usr/bin/pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      clipboard.stdin.end(props.ownerPassword);
      setNote("password copied");
    }
    if (input === "e" && lifecycle === "running" && props.onConfigureAgent) {
      setNote("opening agent setup");
      void Promise.resolve().then(() => props.onConfigureAgent?.()).catch((error) => setNote(`agent setup failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    if (input === "l" && props.onOpenLogs) {
      setNote("opening logs");
      void Promise.resolve().then(() => props.onOpenLogs?.()).catch((error) => setNote(`log open failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={72}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">LOOM / LOCAL MCP</Text>
        <Text color={lifecycle === "terminated" ? "red" : lifecycle === "terminating" ? "yellow" : tunnelReady ? "green" : "yellow"}>
          {lifecycle === "terminated" ? "■ TERMINATED" : lifecycle === "terminating" ? "◌ TERMINATING" : tunnelReady ? "● PUBLIC READY" : "◌ CONNECTING"}  v{LOOM_VERSION}
        </Text>
      </Box>
      <Text dimColor>{"─".repeat(68)}</Text>
      <Text bold color="cyan">CONNECTION</Text>
      <Text>Endpoint  {props.endpoint}</Text>
      <Text>Password  {props.ownerPassword ?? "already configured"}</Text>
      <Text color={lifecycle === "terminated" ? "red" : tunnelReady ? "green" : "yellow"}>Public    {lifecycle === "terminated" ? "terminated — all Loom processes stopped" : lifecycle === "terminating" ? "stopping all Loom processes" : tunnelReady ? "reachable — connector session is separate" : "connecting — wait before connecting ChatGPT"}</Text>
      <Text>Uptime    {seconds}s</Text>
      <Text> </Text>
      <Text bold color="cyan">RUNTIME</Text>
      <Box>
        <Box flexDirection="column" width={22}>
          <Text>Sessions  {stats.sessions}</Text>
          <Text>Calls     {stats.toolCalls}</Text>
          <Text>Errors    {stats.toolErrors}</Text>
          <Text>Agent tok {formatCount(stats.agentTokens ?? 0)}</Text>
          <Text>ChatGPT tok {formatCount(stats.chatgptTokens ?? 0)}</Text>
          <Text>Total tok {formatCount(stats.totalTokens ?? stats.agentTokens ?? 0)}</Text>
        </Box>
        <Box flexDirection="column">
          <Text>Jobs {stats.activeTerminalJobs}  Tabs {stats.browserTabs}</Text>
          <Text>Skills {stats.skills}  Memory {stats.memories}</Text>
          <Text>Agents {stats.activeAgents ?? 0} active / {stats.queuedAgents ?? 0} queued</Text>
          <Text>Provider  {stats.agentProviderConfigured ? "ready" : "not set"}</Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold color="cyan">RECENT ACTIVITY</Text>
      {(stats.recentActivity.slice(0, 6).length ? stats.recentActivity.slice(0, 6) : ["No tool calls yet"]).map((activity, index) => (
        <Text key={`${index}:${activity}`}>  {activity}</Text>
      ))}
      <Text dimColor>{"─".repeat(68)}</Text>
      <Text dimColor>q quit  c endpoint  p password  e agents  l logs  tok≈estimate{note ? `  · ${note}` : ""}</Text>
    </Box>
  );
}

function formatCount(value: number): string {
  return Math.max(0, Math.trunc(value)).toLocaleString("en-US");
}

export function renderLoomDashboard(props: LoomDashboardProps): Instance {
  return render(<LoomDashboard {...props} />);
}
