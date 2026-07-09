import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AuditLogger, AuditUnavailableError } from '../src/audit.js';
import { ProcessManager } from '../src/process-manager.js';
import { inspectProcess, listProcessGroupMembers } from '../src/watchdog.js';
import {
  TerminalCapacityError,
  TerminalJobNotFoundError,
  TerminalToolError,
  TerminalToolService,
  createTerminalToolDispatcher,
} from '../src/tools/terminal.js';

async function tempRoot(prefix = 'loom-terminal-'): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

async function setup(options: { maxRetainedJobs?: number } = {}) {
  const root = await tempRoot();
  const auditDirectory = path.join(root, 'audit');
  await mkdir(auditDirectory, { mode: 0o700 });
  const audit = await AuditLogger.create({ auditDirectory });
  const manager = new ProcessManager({
    statePath: root,
    outputBytes: 64 * 1024,
    heartbeatIntervalMs: 50,
    missedHeartbeatLimit: 3,
    processScanFallbackMs: 100,
    softGraceMs: 100,
    absoluteDeadlineMs: 2_000,
  });
  const service = new TerminalToolService({
    processManager: manager,
    audit,
    ...(options.maxRetainedJobs === undefined
      ? {}
      : { maxRetainedJobs: options.maxRetainedJobs }),
  });
  return { root, auditDirectory, audit, manager, service };
}

async function auditRecords(directory: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for (const filename of (await readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort()) {
    const text = await readFile(path.join(directory, filename), 'utf8');
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      records.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return records;
}

async function pollUntilFinished(
  service: TerminalToolService,
  jobId: string,
  timeoutMs = 5_000,
): Promise<{ status: string; output: string; cursor: number; exitCode: number | null }> {
  const deadline = Date.now() + timeoutMs;
  let cursor = 0;
  let output = '';
  let status = 'running';
  let exitCode: number | null = null;
  while (status === 'running' && Date.now() < deadline) {
    const result = await service.poll({
      jobId,
      cursor,
      maxBytes: 64 * 1024,
      waitMs: 100,
    });
    output += result.content[0]?.type === 'text' ? result.content[0].text : '';
    cursor = result.structuredContent?.nextCursor as number;
    status = result.structuredContent?.status as string;
    exitCode = result.structuredContent?.exitCode as number | null;
  }
  return { status, output, cursor, exitCode };
}

test('terminal executes through a noninteractive shell with canonical symlink cwd and explicit environment', async (t) => {
  const { root, audit, service } = await setup();
  t.after(async () => {
    await service.shutdown();
    await audit.close();
  });
  const realCwd = path.join(root, 'real-cwd');
  const linkedCwd = path.join(root, 'linked-cwd');
  await mkdir(realCwd, { mode: 0o700 });
  await symlink(realCwd, linkedCwd);

  const started = await service.start({
    command: 'printf "stdout:%s:%s\\n" "$PWD" "$LOOM_TERMINAL_VALUE"; printf "stderr-line\\n" >&2',
    cwd: linkedCwd,
    environment: { LOOM_TERMINAL_VALUE: 'explicit-value' },
    timeoutMs: 5_000,
  });
  const jobId = started.structuredContent?.jobId as string;
  const completed = await pollUntilFinished(service, jobId);

  assert.equal(completed.status, 'exited');
  assert.equal(completed.exitCode, 0);
  assert.match(completed.output, new RegExp(`stdout:${realCwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:explicit-value`));
  assert.match(completed.output, /stderr-line/);
  assert.equal((await stat(realCwd)).isDirectory(), true);
});

test('terminal audit is durable before launch and never stores command, environment, cwd, or output', async (t) => {
  const { root, auditDirectory, audit, service } = await setup();
  t.after(async () => {
    await service.shutdown();
    await audit.close();
  });
  const marker = 'terminal-secret-marker-8472';
  const started = await service.start({
    command: `printf '${marker}'`,
    cwd: root,
    environment: { SECRET_TOKEN: 'terminal-secret-environment-5931' },
  });
  const jobId = started.structuredContent?.jobId as string;
  const completed = await pollUntilFinished(service, jobId);
  assert.match(completed.output, new RegExp(marker));

  const records = await auditRecords(auditDirectory);
  assert.deepEqual(records.map((record) => record.phase), ['start', 'finish']);
  assert.equal(records[0]?.operation, 'terminal.start');
  assert.equal(records[1]?.status, 'ok');
  const persisted = JSON.stringify(records);
  for (const forbidden of [marker, 'SECRET_TOKEN', 'terminal-secret-environment-5931', root, 'printf']) {
    assert.equal(persisted.includes(forbidden), false);
  }
});

test('audit failure blocks terminal start but preserves cancellation and polling as safety operations', async (t) => {
  const { root, auditDirectory, audit, service } = await setup();
  t.after(async () => {
    await service.shutdown();
    await audit.close();
  });
  const existing = await service.start({
    command: 'printf "poll-remains-available\\n"; sleep 30',
    cwd: root,
  });
  const existingJobId = existing.structuredContent?.jobId as string;
  await rm(auditDirectory, { recursive: true });
  const markerPath = path.join(root, 'must-not-exist');
  await assert.rejects(
    service.start({ command: `touch ${JSON.stringify(markerPath)}`, cwd: root }),
    AuditUnavailableError,
  );
  const polled = await service.poll({ jobId: existingJobId, waitMs: 100 });
  assert.match(polled.content[0]?.type === 'text' ? polled.content[0].text : '', /poll-remains-available/);
  const cancelled = await service.cancel({ jobId: existingJobId });
  assert.equal(cancelled.structuredContent?.status, 'cancelled');
  await assert.rejects(stat(markerPath), /ENOENT/);
});

test('terminal timeout reaches timed-out state and cancellation removes the complete descendant group', async (t) => {
  const { root, audit, service } = await setup();
  t.after(async () => {
    await service.shutdown();
    await audit.close();
  });

  const timed = await service.start({ command: 'sleep 30', cwd: root, timeoutMs: 100 });
  const timedResult = await pollUntilFinished(service, timed.structuredContent?.jobId as string);
  assert.equal(timedResult.status, 'timed-out');

  const started = await service.start({
    command: `${JSON.stringify(process.execPath)} -e 'const {spawn}=require("node:child_process"); const child=spawn("/bin/sleep",["30"],{stdio:"ignore"}); console.log("grandchild="+child.pid); setInterval(()=>{},1000)'`,
    cwd: root,
  });
  const jobId = started.structuredContent?.jobId as string;
  let grandchildPid = 0;
  let pgid = 0;
  const deadline = Date.now() + 5_000;
  while (grandchildPid === 0 && Date.now() < deadline) {
    const polled = await service.poll({ jobId, waitMs: 100 });
    const text = polled.content[0]?.type === 'text' ? polled.content[0].text : '';
    const match = /grandchild=(\d+)/.exec(text);
    if (match !== null) grandchildPid = Number(match[1]);
    pgid = polled.structuredContent?.pgid as number;
  }
  assert.equal(grandchildPid > 0, true);
  assert.equal(pgid > 0, true);

  const cancelled = await service.cancel({ jobId });
  assert.equal(cancelled.structuredContent?.status, 'cancelled');
  assert.equal(await inspectProcess(grandchildPid), null);
  assert.equal((await listProcessGroupMembers(pgid)).length, 0);
  const repeated = await service.cancel({ jobId });
  assert.equal(repeated.structuredContent?.status, 'cancelled');
});

test('terminal retention never evicts a running job and evicts the oldest finished job', async (t) => {
  const { root, audit, service } = await setup({ maxRetainedJobs: 2 });
  t.after(async () => {
    await service.shutdown();
    await audit.close();
  });

  const firstRunning = await service.start({ command: 'sleep 30', cwd: root });
  const secondRunning = await service.start({ command: 'sleep 30', cwd: root });
  await assert.rejects(service.start({ command: 'true', cwd: root }), TerminalCapacityError);

  await service.cancel({ jobId: firstRunning.structuredContent?.jobId as string });
  const firstFinished = await service.start({ command: 'true', cwd: root });
  await pollUntilFinished(service, firstFinished.structuredContent?.jobId as string);

  const newest = await service.start({ command: 'true', cwd: root });
  await pollUntilFinished(service, newest.structuredContent?.jobId as string);
  await assert.rejects(
    service.poll({ jobId: firstFinished.structuredContent?.jobId as string }),
    TerminalJobNotFoundError,
  );
  await service.cancel({ jobId: secondRunning.structuredContent?.jobId as string });
});

test('terminal service shutdown cancels every running job and leaves no owned process groups', async (t) => {
  const { root, audit, service } = await setup();
  t.after(() => audit.close());
  const first = await service.start({ command: 'sleep 30', cwd: root });
  const second = await service.start({ command: 'sleep 30', cwd: root });
  const firstPoll = await service.poll({ jobId: first.structuredContent?.jobId as string });
  const secondPoll = await service.poll({ jobId: second.structuredContent?.jobId as string });
  const pgids = [
    firstPoll.structuredContent?.pgid as number,
    secondPoll.structuredContent?.pgid as number,
  ];

  await service.shutdown();
  for (const pgid of pgids) {
    assert.equal((await listProcessGroupMembers(pgid)).length, 0);
  }
});

test('terminal validates commands, paths, environment, bounds, and job IDs before mutation', async (t) => {
  const { root, auditDirectory, audit, service } = await setup();
  t.after(async () => {
    await service.shutdown();
    await audit.close();
  });

  await assert.rejects(service.start({ command: '', cwd: root }), TerminalToolError);
  await assert.rejects(service.start({ command: 'echo\u0000bad', cwd: root }), TerminalToolError);
  await assert.rejects(service.start({ command: 'true', cwd: 'relative' }), TerminalToolError);
  await assert.rejects(service.start({ command: 'true', cwd: root, environment: { 'BAD-KEY': 'x' } }), TerminalToolError);
  await assert.rejects(service.start({ command: 'true', cwd: root, environment: { GOOD: 'bad\u0000value' } }), TerminalToolError);
  await assert.rejects(service.start({ command: 'true', cwd: root, timeoutMs: 0 }), TerminalToolError);
  await assert.rejects(service.poll({ jobId: '../bad' }), TerminalToolError);
  await assert.rejects(service.poll({ jobId: 'job_00000000-0000-4000-8000-000000000000', cursor: -1 }), TerminalToolError);
  await assert.rejects(service.poll({ jobId: 'job_00000000-0000-4000-8000-000000000000', maxBytes: 1024 * 1024 + 1 }), TerminalToolError);
  await assert.rejects(service.poll({ jobId: 'job_00000000-0000-4000-8000-000000000000', waitMs: 60_001 }), TerminalToolError);
  await assert.rejects(service.cancel({ jobId: '../bad' }), TerminalToolError);
  assert.deepEqual(await readdir(auditDirectory), []);
});

test('terminal dispatcher handles all terminal actions and delegates every other Loom tool', async (t) => {
  const { root, audit, service } = await setup();
  t.after(async () => {
    await service.shutdown();
    await audit.close();
  });
  const delegated: Array<[string, Record<string, unknown>]> = [];
  const dispatcher = createTerminalToolDispatcher(service, async (name, arguments_) => {
    delegated.push([name, arguments_]);
    return { content: [{ type: 'text', text: 'delegated' }] };
  });

  const started = await dispatcher('loom_terminal', { action: 'start', command: 'true', cwd: root });
  const jobId = started.structuredContent?.jobId as string;
  await dispatcher('loom_terminal', { action: 'poll', jobId, waitMs: 100 });
  await dispatcher('loom_terminal', { action: 'cancel', jobId });
  const delegatedResult = await dispatcher('loom_read', { path: '/tmp/example.txt' });

  assert.equal(delegatedResult.content[0]?.type === 'text' ? delegatedResult.content[0].text : '', 'delegated');
  assert.deepEqual(delegated, [['loom_read', { path: '/tmp/example.txt' }]]);
});
