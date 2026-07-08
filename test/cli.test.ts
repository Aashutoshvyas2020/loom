import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cliPath = new URL('../src/cli.js', import.meta.url);
const packagePath = new URL('../../package.json', import.meta.url);

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cliPath.pathname, ...args], {
    encoding: 'utf8',
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
