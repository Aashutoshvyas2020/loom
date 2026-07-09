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
  assert.match(certification, /human review/i);
  assert.match(certification, /does not prove/i);
  assert.match(certification, /exit code 2/i);
  assert.match(evidence, /G5/i);
  assert.match(evidence, /G6/i);
  assert.match(evidence, /not yet certified/i);
});

test('external audit dossier is self-contained and represents every mapped tracked file', async () => {
  const audit = await readDocument('EXTERNAL_AUDIT.md');
  const repositoryMap = await readDocument('REPO_MAP.md');
  for (const heading of [
    '# Loom v1 External Expert Audit Dossier',
    '## Product, scope, and non-goals',
    '## Architecture and end-to-end control flow',
    '## Security model and trust boundaries',
    '## Complete repository file-by-file ledger',
    '## Implementation plan and chronology',
    '## Verification, evidence, and release status',
    '## Embedded canonical documents',
  ]) {
    assert.equal(audit.includes(heading), true, `${heading} missing from EXTERNAL_AUDIT.md`);
  }
  for (const tool of [
    'loom_terminal',
    'loom_read',
    'loom_write',
    'loom_edit',
    'loom_skills',
    'loom_memory',
    'loom_browser',
  ]) {
    assert.equal(audit.includes(`\`${tool}\``), true, `${tool} missing from audit dossier`);
  }
  assert.match(audit, /human review/i);
  assert.match(audit, /does not prove/i);
  assert.match(audit, /G5[\s\S]*G6[\s\S]*G7/i);

  const mappedPaths = [...repositoryMap.matchAll(/^### `([^`]+)`/gm)].map((match) => match[1]!);
  assert.equal(mappedPaths.length > 0, true, 'REPO_MAP.md contains no tracked paths');
  for (const mappedPath of mappedPaths) {
    assert.equal(
      audit.includes(`\`${mappedPath}\``),
      true,
      `${mappedPath} is not represented in EXTERNAL_AUDIT.md`,
    );
  }
});

test('security and operator documents disclose adversarial content and residual unrestricted-agent risks', async () => {
  const readme = await readDocument('README.md');
  const operator = await readDocument('docs/OPERATOR.md');
  const security = await readDocument('docs/SECURITY.md');
  const development = await readDocument('docs/DEVELOPMENT.md');
  const certification = await readDocument('docs/RELEASE_CERTIFICATION.md');

  for (const required of [
    /prompt injection/i,
    /persistent browser/i,
    /macOS TCC|Full Disk Access/i,
    /localhost|private network/i,
    /authorized remote client|LLM provider/i,
    /local-only.*stop|physical access/i,
    /not.*forensic|forensic.*not/i,
    /process group.*escape|new session.*escape|setsid/i,
  ]) {
    assert.match(security, required);
  }
  assert.match(operator, /launch.*minimal.*environment|sensitive.*environment/i);
  assert.match(operator, /auth reset.*does not.*memory|does not delete browser state/is);
  assert.match(operator, /terminal scrollback|screen sharing/i);
  assert.match(readme, /untrusted.*browser|prompt injection/is);
  assert.match(development, /F_FULLFSYNC|power-loss durability/i);
  assert.match(certification, /out-of-band|detached signature|artifact hash/i);
});

test('npm package metadata includes runtime assets, documentation, license, and notice', async () => {
  const packageJson = JSON.parse(await readDocument('package.json')) as {
    bin: Record<string, string>;
    files: string[];
    scripts: Record<string, string>;
    license: string;
    engines: { node: string };
  };
  assert.deepEqual(packageJson.bin, {
    loom: 'dist/src/cli.js',
    'loom-certify': 'dist/src/certification-cli.js',
  });
  for (const entry of [
    'dist/src',
    'public',
    'README.md',
    'LICENSE',
    'NOTICE',
    'docs/OPERATOR.md',
    'docs/SECURITY.md',
    'docs/DEVELOPMENT.md',
    'docs/RELEASE_CERTIFICATION.md',
    'docs/certification-evidence.example.json',
  ]) {
    assert.equal(packageJson.files.includes(entry), true, `${entry} missing from package files`);
  }
  assert.equal(packageJson.files.includes('docs'), false);
  assert.equal(packageJson.scripts.prepack, 'npm run build');
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.engines.node, '>=22');
});
