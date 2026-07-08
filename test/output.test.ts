import assert from 'node:assert/strict';
import test from 'node:test';

import { BoundedOutput } from '../src/output.js';

test('bounded output preserves stdout/stderr order and sanitizes terminal controls', () => {
  const output = new BoundedOutput(128);

  output.append('stdout', Buffer.from('\u001b[31mred\u001b[0m\u0001\n'));
  output.append('stderr', Buffer.from('error\n'));

  const read = output.read(0);
  assert.deepEqual(read.segments, [
    { source: 'stdout', text: 'red\n' },
    { source: 'stderr', text: 'error\n' },
  ]);
  assert.equal(read.requestedCursor, 0);
  assert.equal(read.availableFrom, 0);
  assert.equal(read.nextCursor, 10);
  assert.equal(read.gap, false);
});

test('binary output is replaced by a deterministic marker', () => {
  const output = new BoundedOutput(128);

  output.append('stdout', Buffer.from([0xff, 0x00, 0xfe]));

  assert.deepEqual(output.read(0).segments, [
    { source: 'stdout', text: '[binary output suppressed: 3 bytes]\n' },
  ]);
});

test('truncation retains exact head and tail and reports cursor gaps', () => {
  const output = new BoundedOutput(10);

  output.append('stdout', 'abcdefghijkl');

  assert.deepEqual(output.snapshot(), {
    totalBytes: 12,
    retainedHead: 'abcde',
    retainedTail: 'hijkl',
    truncated: true,
    firstAvailableCursor: 7,
    state: 'running',
    exitCode: null,
    signal: null,
  });

  const stale = output.read(5);
  assert.equal(stale.requestedCursor, 5);
  assert.equal(stale.availableFrom, 7);
  assert.equal(stale.gap, true);
  assert.equal(stale.nextCursor, 12);
  assert.deepEqual(stale.segments, [{ source: 'stdout', text: 'hijkl' }]);

  const current = output.read(7);
  assert.equal(current.gap, false);
  assert.deepEqual(current.segments, [{ source: 'stdout', text: 'hijkl' }]);
});

test('cursor pagination splits segments without losing source order', () => {
  const output = new BoundedOutput(64);
  output.append('stdout', 'abc');
  output.append('stderr', 'XYZ');

  const first = output.read(0, 4);
  assert.deepEqual(first.segments, [
    { source: 'stdout', text: 'abc' },
    { source: 'stderr', text: 'X' },
  ]);
  assert.equal(first.nextCursor, 4);

  const second = output.read(first.nextCursor, 4);
  assert.deepEqual(second.segments, [{ source: 'stderr', text: 'YZ' }]);
  assert.equal(second.nextCursor, 6);
});

test('UTF-8 truncation never splits a code point', () => {
  const output = new BoundedOutput(8);

  output.append('stdout', '🚀abcde');

  const snapshot = output.snapshot();
  assert.equal(snapshot.totalBytes, 9);
  assert.equal(snapshot.retainedHead, '🚀');
  assert.equal(snapshot.retainedTail, 'bcde');
  assert.equal(snapshot.firstAvailableCursor, 5);
});

test('terminal output records completed, cancelled, and timed-out states', () => {
  const completed = new BoundedOutput(64);
  completed.complete(0, null);
  assert.equal(completed.snapshot().state, 'completed');
  assert.equal(completed.snapshot().exitCode, 0);

  const cancelled = new BoundedOutput(64);
  cancelled.cancel('SIGTERM');
  assert.equal(cancelled.snapshot().state, 'cancelled');
  assert.equal(cancelled.snapshot().signal, 'SIGTERM');

  const timedOut = new BoundedOutput(64);
  timedOut.timeout('SIGKILL');
  assert.equal(timedOut.snapshot().state, 'timed-out');
  assert.equal(timedOut.snapshot().signal, 'SIGKILL');
});
