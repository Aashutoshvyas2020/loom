import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PathPolicyError,
  assertNoSymlinkComponents,
  resolveUserPath,
} from '../src/paths.js';

test('resolveUserPath accepts only absolute paths or ~/ paths', () => {
  const home = '/Users/example';

  assert.equal(resolveUserPath('/tmp/../tmp/file.txt', home), '/tmp/file.txt');
  assert.equal(resolveUserPath('~/Documents/file.txt', home), '/Users/example/Documents/file.txt');

  for (const input of ['', '.', 'relative/file.txt', '~', '~other/file.txt', 'foo\0bar']) {
    assert.throws(() => resolveUserPath(input, home), PathPolicyError);
  }
});

test('resolveUserPath rejects malformed Unicode surrogate sequences', () => {
  assert.throws(() => resolveUserPath('/tmp/\ud800', '/Users/example'), PathPolicyError);
  assert.throws(() => resolveUserPath('/tmp/\udc00', '/Users/example'), PathPolicyError);
  assert.doesNotThrow(() => resolveUserPath('/tmp/\ud83d\ude80', '/Users/example'));
});

test('assertNoSymlinkComponents allows a missing tail under real directories', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-paths-')));
  await mkdir(path.join(root, 'real'));

  await assertNoSymlinkComponents(path.join(root, 'real', 'missing', 'file.txt'));
});

test('assertNoSymlinkComponents rejects symlink parents and final symlinks', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-paths-')));
  const real = path.join(root, 'real');
  await mkdir(real);
  await writeFile(path.join(real, 'target.txt'), 'target');
  await symlink(real, path.join(root, 'linked-dir'));
  await symlink(path.join(real, 'target.txt'), path.join(root, 'linked-file'));

  await assert.rejects(
    assertNoSymlinkComponents(path.join(root, 'linked-dir', 'new.txt')),
    PathPolicyError,
  );
  await assert.rejects(assertNoSymlinkComponents(path.join(root, 'linked-file')), PathPolicyError);
});
