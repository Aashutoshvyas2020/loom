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
}

export interface LoomDashboardProps {
  endpoint: string;
  ownerPassword?: string;
  startedAt: number;
  checkHealth?(endpoint: string): Promise<boolean>;
  getStats(): LoomDashboardStats;
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
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={72}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">LOOM / LOCAL MCP</Text>
        <Text color={lifecycle === "terminated" ? "red" : lifecycle === "terminating" ? "yellow" : tunnelReady ? "green" : "yellow"}>
          {lifecycle === "terminated" ? "■ TERMINATED" : lifecycle === "terminating" ? "◌ TERMINATING" : tunnelReady ? "● READY" : "◌ CONNECTING"}  v{LOOM_VERSION}
        </Text>
      </Box>
      <Text dimColor>{"─".repeat(68)}</Text>
      <Text bold color="cyan">CONNECTION</Text>
      <Text>Endpoint  {props.endpoint}</Text>
      <Text>Password  {props.ownerPassword ?? "already configured"}</Text>
      <Text color={lifecycle === "terminated" ? "red" : tunnelReady ? "green" : "yellow"}>Tunnel    {lifecycle === "terminated" ? "terminated — all Loom processes stopped" : lifecycle === "terminating" ? "stopping all Loom processes" : tunnelReady ? "ready" : "connecting — wait before using ChatGPT"}</Text>
      <Text>Uptime    {seconds}s</Text>
      <Text> </Text>
      <Text bold color="cyan">RUNTIME</Text>
      <Box>
        <Box flexDirection="column" width={22}>
          <Text>Sessions  {stats.sessions}</Text>
          <Text>Calls     {stats.toolCalls}</Text>
          <Text>Errors    {stats.toolErrors}</Text>
        </Box>
        <Box flexDirection="column">
          <Text>Jobs {stats.activeTerminalJobs}  Tabs {stats.browserTabs}</Text>
          <Text>Skills {stats.skills}  Memory {stats.memories}</Text>
        </Box>
      </Box>
      <Text> </Text>
      <Text bold color="cyan">RECENT ACTIVITY</Text>
      {(stats.recentActivity.length ? stats.recentActivity : ["No tool calls yet"]).map((activity) => (
        <Text key={activity}>  {activity}</Text>
      ))}
      <Text dimColor>{"─".repeat(68)}</Text>
      <Text dimColor>q quit  c endpoint  p password{note ? `  · ${note}` : ""}</Text>
    </Box>
  );
}

export function renderLoomDashboard(props: LoomDashboardProps): Instance {
  return render(<LoomDashboard {...props} />);
}
