import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { CLI_USAGE } from '../src/cli.js';
import { FULL_ACCESS_WARNING } from '../src/runtime.js';

const repositoryRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const requiredDocuments = [
  'README.md',
  'LICENSE',
  'NOTICE',
  'docs/OPERATOR.md',
  'docs/SECURITY.md',
  'docs/DEVELOPMENT.md',
  'docs/RELEASE_CERTIFICATION.md',
  'docs/release-evidence/README.md',
] as const;

const documentedCommands = [
  'loom launch --yolo',
  'loom setup browser',
  'loom auth reset',
  'loom config check',
  'loom config reset',
  'loom --version',
  'loom --help',
] as const;

async function readDocument(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

test('CLI usage and operator documentation contain exactly the real public commands', async () => {
  const readme = await readDocument('README.md');
  const operator = await readDocument('docs/OPERATOR.md');
  for (const command of documentedCommands) {
    assert.match(CLI_USAGE, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(readme.includes(command), true, `${command} missing from README.md`);
    assert.equal(operator.includes(command), true, `${command} missing from docs/OPERATOR.md`);
  }
  for (const unsupported of ['loom status', 'loom setup --with-browser', 'loom reset --confirm']) {
    assert.equal(CLI_USAGE.includes(unsupported), false);
    assert.equal(operator.includes(`\`${unsupported}\``), false);
  }
});

test('documentation covers the locked security and operating contract without placeholders', async () => {
  const documents = await Promise.all(requiredDocuments.map(readDocument));
  for (let index = 0; index < documents.length; index += 1) {
    const text = documents[index]!;
    assert.equal(text.trim().length > 0, true, `${requiredDocuments[index]} is empty`);
    assert.doesNotMatch(text, /\b(?:TBD|TODO|FIXME|coming soon|not implemented)\b/i);
  }

  const readme = documents[0]!;
  const operator = documents[3]!;
  const security = documents[4]!;
  const certification = documents[6]!;
  const evidence = documents[7]!;

  for (const required of [
    FULL_ACCESS_WARNING,
    'macOS 14',
    'Node.js 22',
    'Quick Tunnel',
    'Named Tunnel',
    '/mcp',
    'owner password',
    'browser',
    'Ctrl+C',
  ]) {
    assert.equal(readme.includes(required), true, `${required} missing from README.md`);
  }
  assert.match(operator, /runtime\/current\.json/);
  assert.match(operator, /runtime\/loom\.lock/);
  assert.match(security, /no PTY/i);
  assert.match(security, /same macOS user/i);
  assert.match(security, /Quick Tunnel.*not.*production/is);
  assert.match(certification, /deterministic local/i);
  assert.match(certification, /real named tunnel/i);
  assert.match(certification, /real ChatGPT/i);
  assert.match(evidence, /G5/i);
  assert.match(evidence, /G6/i);
  assert.match(evidence, /not yet certified/i);
});

test('npm package metadata includes runtime assets, documentation, license, and notice', async () => {
  const packageJson = JSON.parse(await readDocument('package.json')) as {
    bin: Record<string, string>;
    files: string[];
    scripts: Record<string, string>;
    license: string;
    engines: { node: string };
  };
  assert.deepEqual(packageJson.bin, { loom: 'dist/src/cli.js' });
  for (const entry of ['dist/src', 'public', 'docs', 'README.md', 'LICENSE', 'NOTICE']) {
    assert.equal(packageJson.files.includes(entry), true, `${entry} missing from package files`);
  }
  assert.equal(packageJson.scripts.prepack, 'npm run build');
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.engines.node, '>=22');
});
