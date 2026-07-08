import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  AtomicFileConflictError,
  AtomicFileError,
  atomicWriteFile,
} from '../src/atomic-file.js';

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), 'loom-atomic-')));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

test('atomicWriteFile creates a private file and leaves no temporary residue', async () => {
  const root = await tempRoot();
  const target = path.join(root, 'state.json');

  const result = await atomicWriteFile(target, '{"ready":true}');

  assert.equal(await readFile(target, 'utf8'), '{"ready":true}');
  assert.equal(result.sha256, sha256('{"ready":true}'));
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(root), ['state.json']);
});

test('atomicWriteFile preserves an existing regular file mode', async () => {
  const root = await tempRoot();
  const target = path.join(root, 'script.txt');
  await writeFile(target, 'old', { mode: 0o640 });
  await chmod(target, 0o640);

  await atomicWriteFile(target, 'new');

  assert.equal(await readFile(target, 'utf8'), 'new');
  assert.equal((await stat(target)).mode & 0o777, 0o640);
});

test('atomicWriteFile rejects an expected hash conflict without changing the file', async () => {
  const root = await tempRoot();
  const target = path.join(root, 'state.txt');
  await writeFile(target, 'current');

  await assert.rejects(
    atomicWriteFile(target, 'replacement', { expectedSha256: sha256('stale') }),
    AtomicFileConflictError,
  );

  assert.equal(await readFile(target, 'utf8'), 'current');
  assert.deepEqual(await readdir(root), ['state.txt']);
});

test('concurrent writes to one path serialize so one expected-hash writer wins', async () => {
  const root = await tempRoot();
  const target = path.join(root, 'state.txt');
  await writeFile(target, 'base');
  const expectedSha256 = sha256('base');

  const results = await Promise.allSettled([
    atomicWriteFile(target, 'first', { expectedSha256 }),
    atomicWriteFile(target, 'second', { expectedSha256 }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.ok(rejected.reason instanceof AtomicFileConflictError);
  assert.match(await readFile(target, 'utf8'), /^(first|second)$/);
  assert.deepEqual(await readdir(root), ['state.txt']);
});

test('atomicWriteFile rejects symbolic-link targets and oversized content', async () => {
  const root = await tempRoot();
  const realTarget = path.join(root, 'real.txt');
  const linkedTarget = path.join(root, 'linked.txt');
  await writeFile(realTarget, 'safe');
  await symlink(realTarget, linkedTarget);

  await assert.rejects(atomicWriteFile(linkedTarget, 'unsafe'), AtomicFileError);
  await assert.rejects(atomicWriteFile(path.join(root, 'large.bin'), Buffer.alloc(8 * 1024 * 1024 + 1)), AtomicFileError);
  assert.equal(await readFile(realTarget, 'utf8'), 'safe');
});
