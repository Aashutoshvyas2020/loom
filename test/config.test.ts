import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ConfigError,
  DEFAULT_CONFIG,
  checkConfig,
  initializeState,
  readRuntimeLock,
  resetConfig,
  runtimeIdentityMatches,
  writeRuntimeLock,
} from '../src/config.js';

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), 'loom-config-')));
}

const expectedDirectories = [
  'audit',
  'browser-profile',
  'cloudflared',
  'downloads',
  'downloads/screenshots',
  'memory',
  'runtime',
];

test('initializeState creates the private Loom directory tree and default config', async () => {
  const parent = await tempRoot();
  const stateRoot = path.join(parent, '.loom');

  const config = await initializeState(stateRoot);

  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal((await stat(stateRoot)).mode & 0o777, 0o700);
  for (const relativePath of expectedDirectories) {
    assert.equal((await stat(path.join(stateRoot, relativePath))).mode & 0o777, 0o700);
  }
  assert.equal((await stat(path.join(stateRoot, 'config.json'))).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(path.join(stateRoot, 'config.json'), 'utf8')), DEFAULT_CONFIG);
});

test('initializeState repairs owner-controlled modes and rejects a symlink state root', async () => {
  const parent = await tempRoot();
  const stateRoot = path.join(parent, '.loom');
  await initializeState(stateRoot);
  await chmod(stateRoot, 0o755);
  await chmod(path.join(stateRoot, 'config.json'), 0o644);

  await initializeState(stateRoot);

  assert.equal((await stat(stateRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(stateRoot, 'config.json'))).mode & 0o777, 0o600);

  const linkedRoot = path.join(parent, 'linked-loom');
  await symlink(stateRoot, linkedRoot);
  await assert.rejects(initializeState(linkedRoot), ConfigError);
});

test('checkConfig validates strictly without modifying files', async () => {
  const parent = await tempRoot();
  const stateRoot = path.join(parent, '.loom');
  await initializeState(stateRoot);
  const configPath = path.join(stateRoot, 'config.json');
  const beforeStat = await stat(configPath);
  const beforeFiles = await readdir(stateRoot);

  assert.deepEqual(await checkConfig(stateRoot), DEFAULT_CONFIG);

  const afterStat = await stat(configPath);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
  assert.deepEqual(await readdir(stateRoot), beforeFiles);

  const named = {
    version: 1,
    tunnel: {
      type: 'named',
      name: 'loom-prod',
      hostname: 'LOOM.Example.COM',
      credentialsFile: '~/.cloudflared/credentials.json',
    },
    extraRoots: [],
  };
  await writeFile(configPath, JSON.stringify(named), { mode: 0o600 });
  assert.deepEqual(await checkConfig(stateRoot), {
    ...named,
    tunnel: {
      ...named.tunnel,
      hostname: 'loom.example.com',
    },
  });
});

test('checkConfig rejects unknown keys, relative roots, and incomplete named tunnels', async () => {
  const parent = await tempRoot();
  const stateRoot = path.join(parent, '.loom');
  await initializeState(stateRoot);
  const configPath = path.join(stateRoot, 'config.json');

  for (const invalid of [
    { ...DEFAULT_CONFIG, unknown: true },
    { ...DEFAULT_CONFIG, extraRoots: ['relative/path'] },
    { version: 1, tunnel: { type: 'named', name: 'prod' }, extraRoots: [] },
    {
      version: 1,
      tunnel: {
        type: 'named',
        name: 'prod',
        hostname: 'unsafe.trycloudflare.com',
        credentialsFile: '~/.cloudflared/credentials.json',
      },
      extraRoots: [],
    },
    {
      version: 1,
      tunnel: {
        type: 'named',
        name: ' prod ',
        hostname: 'loom.example.com',
        credentialsFile: '~/.cloudflared/credentials.json',
      },
      extraRoots: [],
    },
    {
      version: 1,
      tunnel: {
        type: 'named',
        name: '--url',
        hostname: 'loom.example.com',
        credentialsFile: '~/.cloudflared/credentials.json',
      },
      extraRoots: [],
    },
    {
      version: 1,
      tunnel: {
        type: 'named',
        name: `prod${'x'.repeat(125)}`,
        hostname: 'loom.example.com',
        credentialsFile: '~/.cloudflared/credentials.json',
      },
      extraRoots: [],
    },
  ]) {
    await writeFile(configPath, JSON.stringify(invalid), { mode: 0o600 });
    await assert.rejects(checkConfig(stateRoot), ConfigError);
  }
});

test('resetConfig preserves invalid bytes with a timestamp and writes private defaults', async () => {
  const parent = await tempRoot();
  const stateRoot = path.join(parent, '.loom');
  await initializeState(stateRoot);
  const configPath = path.join(stateRoot, 'config.json');
  const invalid = '{"version":1,"tunnel":{"type":"named"}}\n';
  await writeFile(configPath, invalid, { mode: 0o644 });

  const result = await resetConfig(stateRoot, new Date('2026-07-08T07:00:00.000Z'));

  assert.equal(result.backupPath, path.join(stateRoot, 'config.invalid.2026-07-08T07-00-00-000Z.json'));
  assert.equal(await readFile(result.backupPath!, 'utf8'), invalid);
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), DEFAULT_CONFIG);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  assert.equal((await stat(result.backupPath!)).mode & 0o777, 0o600);
  assert.equal((await lstat(result.backupPath!)).isSymbolicLink(), false);
});

test('runtime lock records are private, strict, and round-trip every identity field', async () => {
  const parent = await tempRoot();
  const stateRoot = path.join(parent, '.loom');
  await initializeState(stateRoot);
  const identity = {
    pid: 123,
    startTime: 456,
    executablePath: '/usr/local/bin/node',
    launchId: 'launch-1',
    statePath: stateRoot,
  };

  await writeRuntimeLock(stateRoot, identity);

  const lockPath = path.join(stateRoot, 'runtime', 'loom.lock');
  assert.deepEqual(await readRuntimeLock(stateRoot), identity);
  assert.equal((await stat(lockPath)).mode & 0o777, 0o600);

  await writeFile(lockPath, JSON.stringify({ ...identity, unknown: true }), { mode: 0o600 });
  await assert.rejects(readRuntimeLock(stateRoot), ConfigError);
});

test('runtime lock identity requires every PID-reuse defense field to match', () => {
  const expected = {
    pid: 123,
    startTime: 456,
    executablePath: '/usr/local/bin/node',
    launchId: 'launch-1',
    statePath: '/Users/example/.loom',
  };

  assert.equal(runtimeIdentityMatches(expected, { ...expected }), true);
  for (const changed of [
    { ...expected, pid: 124 },
    { ...expected, startTime: 457 },
    { ...expected, executablePath: '/usr/bin/node' },
    { ...expected, launchId: 'launch-2' },
    { ...expected, statePath: '/tmp/.loom' },
  ]) {
    assert.equal(runtimeIdentityMatches(expected, changed), false);
  }
});
