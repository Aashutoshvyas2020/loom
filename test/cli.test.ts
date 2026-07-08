import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initializeState } from '../src/config.js';

const cliPath = new URL('../src/cli.js', import.meta.url);
const packagePath = new URL('../../package.json', import.meta.url);

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath.pathname, ...args], {
    encoding: 'utf8',
  });
}

function runCliWithHome(home: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliPath.pathname, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

test('package metadata pins the supported runtime and dependencies', async () => {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as {
    engines: { node: string };
    dependencies: Record<string, string>;
  };

  assert.equal(pkg.engines.node, '>=22');
  assert.deepEqual(pkg.dependencies, {
    '@modelcontextprotocol/sdk': '1.29.0',
    express: '5.2.1',
    'playwright-core': '1.61.1',
    zod: '4.4.3',
  });
});

test('--version prints the package version', () => {
  const result = runCli('--version');

  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim(), '0.1.0');
});

test('--help exposes the explicit YOLO launch command and support floor', () => {
  const result = runCli('--help');

  assert.equal(result.status, 0);
  assert.match(result.stdout, /loom launch --yolo/);
  assert.match(result.stdout, /macOS 14\+/);
});

test('plain launch refuses to start unrestricted access', () => {
  const result = runCli('launch');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /loom launch --yolo/);
  assert.doesNotMatch(result.stdout, /FULL COMPUTER ACCESS ENABLED/);
});

test('config check validates the default state without modifying invalid configuration', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-cli-home-')));
  const stateRoot = path.join(home, '.loom');
  await initializeState(stateRoot);

  const valid = runCliWithHome(home, 'config', 'check');
  assert.equal(valid.status, 0);
  assert.match(valid.stdout, /Configuration valid/);

  const configPath = path.join(stateRoot, 'config.json');
  const invalidBytes = '{"version":1,"unknown":true}\n';
  await writeFile(configPath, invalidBytes, { mode: 0o600 });
  const invalid = runCliWithHome(home, 'config', 'check');

  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid Loom configuration/);
  assert.equal(await readFile(configPath, 'utf8'), invalidBytes);
});

test('config reset requires and accepts local terminal confirmation', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-cli-home-')));
  const stateRoot = path.join(home, '.loom');
  await initializeState(stateRoot);
  const configPath = path.join(stateRoot, 'config.json');
  await writeFile(configPath, '{"invalid":true}\n', { mode: 0o600 });

  const expectScript = `
set timeout 10
spawn $env(LOOM_TEST_NODE) $env(LOOM_TEST_CLI) config reset
expect {
  "Type RESET to restore the default Loom configuration: " { send "RESET\\r" }
  timeout { exit 124 }
  eof { exit 125 }
}
expect eof
set result [wait]
exit [lindex $result 3]
`;
  const result = spawnSync('/usr/bin/expect', ['-c', expectScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      LOOM_TEST_NODE: process.execPath,
      LOOM_TEST_CLI: cliPath.pathname,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), {
    version: 1,
    tunnel: { type: 'quick' },
    extraRoots: [],
  });
  assert.equal(
    (await readdir(stateRoot)).some((name) => name.startsWith('config.invalid.')),
    true,
  );
});
