#!/usr/bin/env node

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

import { inspectProcess, observableIdentityMatches, type ProcessObservation } from './watchdog.js';

interface StartMessage {
  type: 'start';
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  parentIdentity: Pick<ProcessObservation, 'pid' | 'startTime' | 'executablePath'>;
  heartbeatIntervalMs: number;
  missedHeartbeatLimit: number;
  processScanFallbackMs: number;
  softGraceMs: number;
}

interface HeartbeatMessage {
  type: 'heartbeat';
}

type ParentMessage = StartMessage | HeartbeatMessage;

let target: ChildProcessByStdio<null, Readable, Readable> | undefined;
let started = false;
let orphaning = false;
let shuttingDown = false;
let lastHeartbeat = Date.now();
let heartbeatTimer: NodeJS.Timeout | undefined;
let scanTimer: NodeJS.Timeout | undefined;
let parentIdentity: StartMessage['parentIdentity'] | undefined;
let softGraceMs = 5_000;
let readyDelivery: Promise<void> = Promise.resolve();
let finishing = false;

function send(message: object): Promise<void> {
  return new Promise((resolve) => {
    if (!process.connected || process.send === undefined) {
      resolve();
      return;
    }
    try {
      process.send(message, () => resolve());
    } catch {
      resolve();
    }
  });
}

function clearWatchdogTimers(): void {
  if (heartbeatTimer !== undefined) {
    clearInterval(heartbeatTimer);
  }
  if (scanTimer !== undefined) {
    clearInterval(scanTimer);
  }
}

function hardKillOwnGroup(): void {
  try {
    process.kill(-process.pid, 'SIGKILL');
  } catch {
    process.exit(70);
  }
}

function beginOrphanCleanup(reason: string): void {
  if (orphaning) {
    return;
  }
  orphaning = true;
  shuttingDown = true;
  void send({ type: 'orphaned', reason });

  try {
    process.kill(-process.pid, 'SIGTERM');
  } catch {
    target?.kill('SIGTERM');
  }

  setTimeout(hardKillOwnGroup, softGraceMs);
}

async function parentStillMatches(): Promise<boolean> {
  if (parentIdentity === undefined) {
    return false;
  }
  try {
    const observed = await inspectProcess(parentIdentity.pid);
    return observed !== null && observableIdentityMatches(parentIdentity, observed);
  } catch {
    return false;
  }
}

async function verifyParent(reason: string): Promise<void> {
  if (!await parentStillMatches()) {
    beginOrphanCleanup(reason);
  }
}

function installWatchdog(message: StartMessage): void {
  parentIdentity = message.parentIdentity;
  softGraceMs = message.softGraceMs;
  lastHeartbeat = Date.now();

  heartbeatTimer = setInterval(() => {
    if (Date.now() - lastHeartbeat >= message.heartbeatIntervalMs * message.missedHeartbeatLimit) {
      void verifyParent('missed-heartbeats');
    }
  }, message.heartbeatIntervalMs);

  scanTimer = setInterval(() => {
    void verifyParent('process-table-fallback');
  }, message.processScanFallbackMs);
}

async function finishNormally(
  code: number | null,
  signal: NodeJS.Signals | null,
): Promise<void> {
  if (finishing) return;
  finishing = true;
  clearWatchdogTimers();
  await readyDelivery;
  await send({ type: 'exit', exitCode: code, signal });

  if (orphaning) return;
  process.exitCode = 0;
  if (process.connected) process.disconnect?.();
}

async function finishWithStartupError(message: string): Promise<void> {
  if (finishing) return;
  finishing = true;
  clearWatchdogTimers();
  await send({ type: 'error', message });
  process.exitCode = 1;
  if (process.connected) process.disconnect?.();
}

function startTarget(message: StartMessage): void {
  if (started) {
    void send({ type: 'error', message: 'Child wrapper received more than one start request.' });
    return;
  }
  started = true;
  installWatchdog(message);

  let spawned: ChildProcessByStdio<null, Readable, Readable>;
  try {
    spawned = spawn(message.executable, message.args, {
      cwd: message.cwd,
      env: message.env,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    target = spawned;
  } catch (error) {
    void finishWithStartupError(`Unable to spawn target: ${String(error)}`);
    return;
  }

  spawned.stdout.pipe(process.stdout, { end: false });
  spawned.stderr.pipe(process.stderr, { end: false });

  spawned.once('spawn', () => {
    readyDelivery = send({ type: 'ready', targetPid: spawned.pid, pgid: process.pid });
  });
  spawned.once('error', (error) => {
    void finishWithStartupError(`Target process error: ${error.message}`);
  });
  spawned.once('close', (code, signal) => {
    if (!process.connected && !shuttingDown) {
      beginOrphanCleanup('parent-ipc-disconnected-before-target-exit');
      return;
    }
    void finishNormally(code, signal);
  });
}

function handleTerminationSignal(): void {
  shuttingDown = true;
  target?.kill('SIGTERM');
}

process.on('SIGTERM', handleTerminationSignal);
process.on('SIGINT', handleTerminationSignal);
process.on('message', (message: ParentMessage) => {
  if (message.type === 'heartbeat') {
    lastHeartbeat = Date.now();
    return;
  }
  if (message.type === 'start') {
    startTarget(message);
  }
});
process.on('disconnect', () => {
  // The independent heartbeat and process-table checks decide whether cleanup is required.
});

if (process.send === undefined) {
  process.stderr.write('Loom child wrapper requires an IPC parent.\n');
  process.exitCode = 64;
}
