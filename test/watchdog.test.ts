import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import test from 'node:test';

import {
  inspectProcess,
  listProcessGroupMembers,
  observableIdentityMatches,
  runWatchdogCommand,
} from '../src/watchdog.js';

test('watchdog subprocesses are locale-pinned and terminate at their explicit deadline', async () => {
  const environment = await runWatchdogCommand('/usr/bin/env', [], {
    maxBuffer: 64 * 1024,
    timeoutMs: 1_000,
  });
  assert.match(environment, /^LC_ALL=C$/m);
  assert.match(environment, /^LANG=C$/m);

  const started = performance.now();
  await assert.rejects(
    runWatchdogCommand('/bin/sh', ['-c', 'sleep 5'], {
      maxBuffer: 64 * 1024,
      timeoutMs: 25,
    }),
    (error: unknown) => (
      error instanceof Error
      && (error as Error & { killed?: boolean; signal?: string }).killed === true
      && (error as Error & { signal?: string }).signal === 'SIGKILL'
    ),
  );
  assert.equal(performance.now() - started < 1_000, true);
});

test('inspectProcess returns macOS PID, group, start time, and canonical executable identity', async () => {
  const observed = await inspectProcess(process.pid);

  assert.ok(observed);
  assert.equal(observed.pid, process.pid);
  assert.equal(observed.executablePath, await realpath(process.execPath));
  assert.equal(Number.isInteger(observed.pgid), true);
  assert.equal(observed.pgid > 0, true);
  assert.equal(observed.startTime <= Date.now(), true);
  assert.equal(observed.startTime > Date.now() - 60_000, true);
});

test('observable identity requires PID, start time, and executable path', async () => {
  const observed = await inspectProcess(process.pid);
  assert.ok(observed);

  assert.equal(observableIdentityMatches(observed, { ...observed }), true);
  assert.equal(observableIdentityMatches(observed, { ...observed, pid: observed.pid + 1 }), false);
  assert.equal(observableIdentityMatches(observed, { ...observed, startTime: observed.startTime + 1_000 }), false);
  assert.equal(observableIdentityMatches(observed, { ...observed, executablePath: '/usr/bin/false' }), false);
});

test('process group scans include the current process and missing PIDs return null', async () => {
  const observed = await inspectProcess(process.pid);
  assert.ok(observed);

  const members = await listProcessGroupMembers(observed.pgid);
  assert.equal(members.some((member) => member.pid === process.pid), true);
  assert.equal(await inspectProcess(2_147_483_647), null);
});
