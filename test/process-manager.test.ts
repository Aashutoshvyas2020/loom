import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';

import { ProcessManager } from '../src/process-manager.js';
import { inspectProcess, listProcessGroupMembers } from '../src/watchdog.js';

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), 'loom-process-')));
}

async function waitForText(
  job: Awaited<ReturnType<ProcessManager['start']>>,
  pattern: RegExp,
  timeoutMs = 3_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = job.output.read(0).segments.map((segment) => segment.text).join('');
    if (pattern.test(text)) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for output matching ${pattern}.`);
}

function testManager(statePath: string): ProcessManager {
  return new ProcessManager({
    statePath,
    outputBytes: 8 * 1024,
    startupTimeoutMs: 3_000,
    heartbeatIntervalMs: 50,
    missedHeartbeatLimit: 3,
    processScanFallbackMs: 100,
    softGraceMs: 100,
    absoluteDeadlineMs: 2_000,
  });
}

test('managed processes have no PTY or usable stdin and capture both output streams', async () => {
  const root = await tempRoot();
  const manager = testManager(root);
  const script = `
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write('stdin-ended tty=' + Boolean(process.stdin.isTTY) + '\\n');
  process.stderr.write('stderr-line\\n');
});
`;

  const job = await manager.start({ executable: process.execPath, args: ['-e', script], cwd: root });
  const result = await job.wait();
  const text = job.output.read(0).segments.map((segment) => segment.text).join('');

  assert.equal(result.state, 'completed');
  assert.equal(result.exitCode, 0);
  assert.match(text, /stdin-ended tty=false/);
  assert.match(text, /stderr-line/);
  assert.equal((await listProcessGroupMembers(job.metadata.pgid)).length, 0);
});

test('wrapper and target are placed in one dedicated process group', async () => {
  const root = await tempRoot();
  const manager = testManager(root);
  const job = await manager.start({
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: root,
  });

  try {
    const wrapper = await inspectProcess(job.metadata.wrapperPid);
    const target = await inspectProcess(job.metadata.targetPid);
    assert.ok(wrapper);
    assert.ok(target);
    assert.equal(job.metadata.pgid, job.metadata.wrapperPid);
    assert.equal(wrapper.pgid, job.metadata.pgid);
    assert.equal(target.pgid, job.metadata.pgid);
    assert.equal(job.metadata.targetExecutablePath, await realpath(process.execPath));
    assert.equal(job.metadata.wrapperExecutablePath, await realpath(process.execPath));
    assert.equal(job.metadata.statePath, root);
  } finally {
    await job.cancel();
  }

  assert.equal((await listProcessGroupMembers(job.metadata.pgid)).length, 0);
});

test('cancellation terminates the complete process group including grandchildren', async () => {
  const root = await tempRoot();
  const manager = testManager(root);
  const script = `
const { spawn } = require('node:child_process');
const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
console.log('grandchild=' + child.pid);
setInterval(() => {}, 1000);
`;
  const job = await manager.start({ executable: process.execPath, args: ['-e', script], cwd: root });

  const text = await waitForText(job, /grandchild=\d+/);
  const grandchildPid = Number(text.match(/grandchild=(\d+)/)![1]);
  const result = await job.cancel();

  assert.equal(result.state, 'cancelled');
  assert.equal(await inspectProcess(grandchildPid), null);
  assert.equal((await listProcessGroupMembers(job.metadata.pgid)).length, 0);
});

test('normal target exit still cleans background descendants in its group', async () => {
  const root = await tempRoot();
  const manager = testManager(root);
  const script = `
const { spawn } = require('node:child_process');
const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
child.unref();
console.log('grandchild=' + child.pid);
`;
  const job = await manager.start({ executable: process.execPath, args: ['-e', script], cwd: root });

  const text = await waitForText(job, /grandchild=\d+/);
  const grandchildPid = Number(text.match(/grandchild=(\d+)/)![1]);
  const result = await job.wait();

  assert.equal(result.state, 'completed');
  assert.equal(result.exitCode, 0);
  assert.equal(await inspectProcess(grandchildPid), null);
  assert.equal((await listProcessGroupMembers(job.metadata.pgid)).length, 0);
});

test('cancellation escalates to SIGKILL when the target ignores SIGTERM', async () => {
  const root = await tempRoot();
  const manager = testManager(root);
  const script = `
process.on('SIGTERM', () => {});
console.log('ready');
setInterval(() => {}, 1000);
`;
  const job = await manager.start({ executable: process.execPath, args: ['-e', script], cwd: root });
  await waitForText(job, /ready/);

  const startedAt = Date.now();
  const result = await job.cancel();

  assert.equal(result.state, 'cancelled');
  assert.equal(Date.now() - startedAt >= 100, true);
  assert.equal((await listProcessGroupMembers(job.metadata.pgid)).length, 0);
});

test('watchdog removes the full process group after the manager is SIGKILLed', async () => {
  const root = await tempRoot();
  const managerUrl = new URL('../src/process-manager.js', import.meta.url).href;
  const targetScript = `
const { spawn } = require('node:child_process');
const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
child.unref();
setInterval(() => {}, 1000);
`;
  const helperScript = `
import { ProcessManager } from ${JSON.stringify(managerUrl)};
const manager = new ProcessManager({
  statePath: process.env.LOOM_TEST_STATE,
  outputBytes: 4096,
  startupTimeoutMs: 3000,
  heartbeatIntervalMs: 50,
  missedHeartbeatLimit: 3,
  processScanFallbackMs: 100,
  softGraceMs: 100,
  absoluteDeadlineMs: 2000,
});
const job = await manager.start({
  executable: process.execPath,
  args: ['-e', ${JSON.stringify(targetScript)}],
  cwd: process.env.LOOM_TEST_STATE,
});
console.log(JSON.stringify(job.metadata));
setInterval(() => {}, 1000);
`;
  const helper = spawn(process.execPath, ['--input-type=module', '-e', helperScript], {
    env: { ...process.env, LOOM_TEST_STATE: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const lines = createInterface({ input: helper.stdout! });
  const [line] = await once(lines, 'line') as [string];
  const metadata = JSON.parse(line) as { wrapperPid: number; targetPid: number; pgid: number };

  helper.kill('SIGKILL');
  await once(helper, 'exit');

  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && (await listProcessGroupMembers(metadata.pgid)).length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const remaining = await listProcessGroupMembers(metadata.pgid);
  if (remaining.length > 0) {
    try {
      process.kill(-metadata.pgid, 'SIGKILL');
    } catch {
      // Best-effort test cleanup.
    }
  }

  assert.deepEqual(remaining, []);
  assert.equal(await inspectProcess(metadata.wrapperPid), null);
  assert.equal(await inspectProcess(metadata.targetPid), null);
});

test('timeouts mark the job timed-out and leave no process-group members', async () => {
  const root = await tempRoot();
  const manager = testManager(root);
  const job = await manager.start({
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: root,
    timeoutMs: 100,
  });

  const result = await job.wait();

  assert.equal(result.state, 'timed-out');
  assert.equal((await listProcessGroupMembers(job.metadata.pgid)).length, 0);
});
