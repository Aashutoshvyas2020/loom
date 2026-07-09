import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CERTIFICATION_VERSION,
  EXPECTED_LOOM_TOOLS,
  CertificationEvidenceError,
  collectDeterministicCertificationEvidence,
  evaluateCertification,
  parseNpmPackDryRun,
  validateExternalCertificationEvidence,
  verifyExternalCertificationArtifacts,
  writeCertificationReport,
  type DeterministicCertificationEvidence,
  type CertificationCommandRunner,
  type ExternalCertificationEvidence,
} from '../src/certification.js';

const SHA = 'a'.repeat(40);
const ARM64_CLOUDFLARED_SHA256 = 'cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04';
const ARM64_CHROMIUM_SHA256 = 'b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7';
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), 'loom-certification-')));
}

function deterministic(
  overrides: Partial<DeterministicCertificationEvidence> = {},
): DeterministicCertificationEvidence {
  return {
    releaseSha: SHA,
    branch: 'release/loom-v1',
    cleanTree: true,
    platform: 'darwin',
    architecture: 'arm64',
    nodeVersion: 'v22.17.0',
    checks: {
      typecheck: { status: 'pass', summary: 'npm run typecheck' },
      tests: { status: 'pass', summary: 'npm test: 200/200' },
      build: { status: 'pass', summary: 'npm run build' },
      documentation: { status: 'pass', summary: 'docs contract' },
      repositoryMap: { status: 'pass', summary: 'tracked paths exact' },
      packageDryRun: { status: 'pass', summary: 'npm pack --dry-run' },
      processResidue: { status: 'pass', summary: 'zero Loom-owned processes' },
    },
    packageFiles: [
      'package.json',
      'LICENSE',
      'NOTICE',
      'README.md',
      'dist/src/cli.js',
      'dist/src/runtime.js',
      'dist/src/certification-cli.js',
      'public/dashboard.css',
      'public/dashboard.html',
      'public/dashboard.js',
      'docs/OPERATOR.md',
      'docs/SECURITY.md',
      'docs/DEVELOPMENT.md',
      'docs/RELEASE_CERTIFICATION.md',
      'docs/certification-evidence.example.json',
    ],
    processResidue: [],
    generatedAt: '2026-07-08T20:00:00.000Z',
    ...overrides,
  };
}

function validExternalEvidence(): ExternalCertificationEvidence {
  const artifact = { path: '/evidence/redacted.txt', sha256: 'b'.repeat(64) };
  const cloudflaredArtifact = { path: '/evidence/cloudflared', sha256: ARM64_CLOUDFLARED_SHA256 };
  const chromiumArtifact = { path: '/evidence/chromium', sha256: ARM64_CHROMIUM_SHA256 };
  const packageArtifact = { path: '/evidence/loom.tgz', sha256: 'e'.repeat(64) };
  return {
    g5: {
      releaseSha: SHA,
      host: {
        platform: 'darwin',
        architecture: 'arm64',
        macosVersion: '15.5',
        nodeVersion: 'v22.17.0',
      },
      cloudflared: {
        managed: true,
        version: '2026.7.0',
        sha256: ARM64_CLOUDFLARED_SHA256,
      },
      chromium: {
        managed: true,
        revision: '1228',
        sha256: ARM64_CHROMIUM_SHA256,
      },
      quickTunnel: {
        registered: true,
        productionEligible: false,
        publicAccessTerminated: true,
      },
      namedTunnel: {
        registered: true,
        endpoint: 'https://loom.example.com/mcp',
        stableRestartGenerationPreserved: true,
        hostnameChangeGenerationIncremented: true,
        ownerPasswordPreserved: true,
        noQuickFallback: true,
        publicAccessTerminated: true,
      },
      processResidue: [],
      artifacts: [cloudflaredArtifact, chromiumArtifact, artifact],
    },
    g6: {
      releaseSha: SHA,
      chatGptEligible: true,
      oauthCompleted: true,
      unauthorizedRejected: true,
      revokedCredentialsRejected: true,
      toolsInvoked: [...EXPECTED_LOOM_TOOLS],
      auditSecretScanPassed: true,
      publicAccessTerminated: true,
      processResidue: [],
      artifacts: [artifact],
    },
    g7: {
      releaseSha: SHA,
      immutableRelease: true,
      cleanSupportedMacInstall: true,
      packageSha256: 'e'.repeat(64),
      fullGatePassed: true,
      documentationConsistent: true,
      publicAccessTerminated: true,
      processResidue: [],
      artifacts: [packageArtifact, artifact],
    },
  };
}

test('deterministic success without external evidence remains blocked and never certified', () => {
  const report = evaluateCertification({ deterministic: deterministic() });
  assert.equal(report.version, CERTIFICATION_VERSION);
  assert.equal(report.overall, 'blocked');
  assert.equal(report.releaseCertified, false);
  assert.equal(report.gates.G4.status, 'pass');
  assert.equal(report.gates.G5.status, 'blocked');
  assert.equal(report.gates.G6.status, 'blocked');
  assert.equal(report.gates.G7.status, 'blocked');
  assert.match(report.gates.G5.summary, /real managed components and tunnel evidence/i);
  assert.match(report.gates.G6.summary, /ChatGPT/i);
});

test('deterministic failure makes the report fail instead of blocked', () => {
  const evidence = deterministic({
    checks: {
      ...deterministic().checks,
      tests: { status: 'fail', summary: 'one test failed' },
    },
  });
  const report = evaluateCertification({ deterministic: evidence });
  assert.equal(report.overall, 'fail');
  assert.equal(report.releaseCertified, false);
  assert.equal(report.gates.G4.status, 'fail');
  assert.equal(report.gates.G7.status, 'blocked');
});

test('self-reported external evidence remains blocked pending human review', () => {
  const external = validateExternalCertificationEvidence(validExternalEvidence(), SHA);
  const report = evaluateCertification({ deterministic: deterministic(), external });
  assert.equal(report.overall, 'blocked');
  assert.equal(report.releaseCertified, false);
  assert.deepEqual(
    Object.values(report.gates).map((gate) => gate.status),
    ['pass', 'blocked', 'blocked', 'blocked'],
  );
  assert.match(report.gates.G5.summary, /human review/i);
  assert.match(report.gates.G6.summary, /human review/i);
  assert.match(report.gates.G7.summary, /human review/i);
});

test('external evidence rejects SHA mismatch, missing tools, extra secret fields, and unstable endpoints', () => {
  const mismatch = validExternalEvidence();
  mismatch.g5!.releaseSha = 'f'.repeat(40);
  assert.throws(
    () => validateExternalCertificationEvidence(mismatch, SHA),
    /release SHA/i,
  );

  const missingTool = validExternalEvidence();
  missingTool.g6!.toolsInvoked = EXPECTED_LOOM_TOOLS.slice(0, -1);
  assert.throws(
    () => validateExternalCertificationEvidence(missingTool, SHA),
    /toolsInvoked|seven Loom tools/i,
  );

  const secret = validExternalEvidence() as unknown as Record<string, unknown>;
  (secret.g6 as Record<string, unknown>).ownerPassword = 'must-not-be-stored';
  assert.throws(
    () => validateExternalCertificationEvidence(secret, SHA),
    CertificationEvidenceError,
  );

  const quickNamed = validExternalEvidence();
  quickNamed.g5!.namedTunnel.endpoint = 'https://unsafe.trycloudflare.com/mcp';
  assert.throws(
    () => validateExternalCertificationEvidence(quickNamed, SHA),
    /stable HTTPS/i,
  );

  const staleCloudflared = validExternalEvidence();
  (staleCloudflared.g5!.cloudflared as { version: string }).version = '2026.6.1';
  assert.throws(
    () => validateExternalCertificationEvidence(staleCloudflared, SHA),
    /Cloudflared|2026\.7\.0/i,
  );

  const staleChromium = validExternalEvidence();
  (staleChromium.g5!.chromium as { revision: string }).revision = '1227';
  assert.throws(
    () => validateExternalCertificationEvidence(staleChromium, SHA),
    /Chromium|1228/i,
  );

  const wrongManagedHash = validExternalEvidence();
  wrongManagedHash.g5!.cloudflared.sha256 = 'f'.repeat(64);
  wrongManagedHash.g5!.artifacts[0] = {
    path: '/evidence/cloudflared',
    sha256: 'f'.repeat(64),
  };
  assert.throws(
    () => validateExternalCertificationEvidence(wrongManagedHash, SHA),
    /pinned Cloudflared|SHA-256/i,
  );

  const wrongChromiumHash = validExternalEvidence();
  wrongChromiumHash.g5!.chromium.sha256 = 'e'.repeat(64);
  wrongChromiumHash.g5!.artifacts[1] = {
    path: '/evidence/chromium',
    sha256: 'e'.repeat(64),
  };
  assert.throws(
    () => validateExternalCertificationEvidence(wrongChromiumHash, SHA),
    /pinned Chromium|SHA-256/i,
  );
});

test('G5 evidence does not require a Quick Tunnel smoke test', () => {
  const evidence = validExternalEvidence() as unknown as {
    g5: Record<string, unknown>;
  };
  delete evidence.g5.quickTunnel;
  assert.doesNotThrow(() => validateExternalCertificationEvidence(evidence, SHA));
});

test('external artifact verification hashes stable private regular files and rejects mismatch or symlink', async () => {
  const root = await tempRoot();
  const artifactPath = path.join(root, 'redacted-evidence.txt');
  const bytes = Buffer.from('redacted certification evidence\n');
  await writeFile(artifactPath, bytes, { mode: 0o600 });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const g6 = validExternalEvidence().g6!;
  g6.artifacts = [{ path: artifactPath, sha256 }];
  const evidence = validateExternalCertificationEvidence({ g6 }, SHA);
  assert.equal(await verifyExternalCertificationArtifacts(evidence), evidence);

  const mismatch = validateExternalCertificationEvidence({
    g6: { ...g6, artifacts: [{ path: artifactPath, sha256: 'f'.repeat(64) }] },
  }, SHA);
  await assert.rejects(
    verifyExternalCertificationArtifacts(mismatch),
    /SHA-256 mismatch/i,
  );

  const linkPath = path.join(root, 'evidence-link.txt');
  await symlink(artifactPath, linkPath);
  const linked = validateExternalCertificationEvidence({
    g6: { ...g6, artifacts: [{ path: linkPath, sha256 }] },
  }, SHA);
  await assert.rejects(
    verifyExternalCertificationArtifacts(linked),
    /symbolic[- ]link|without following/i,
  );
});

test('certification report writes private canonical JSON and rejects symlink targets', async () => {
  const root = await tempRoot();
  const reportPath = path.join(root, 'report.json');
  const report = evaluateCertification({ deterministic: deterministic() });
  await writeCertificationReport(reportPath, report);
  assert.equal((await lstat(reportPath)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(reportPath, 'utf8')), report);

  const target = path.join(root, 'target.json');
  await writeCertificationReport(target, report);
  await chmod(target, 0o600);
  const link = path.join(root, 'report-link.json');
  await symlink(target, link);
  await assert.rejects(writeCertificationReport(link, report), /symbolic link/i);

  const outside = path.join(root, 'outside');
  await mkdir(outside);
  const linkedDirectory = path.join(root, 'linked-directory');
  await symlink(outside, linkedDirectory);
  await assert.rejects(
    writeCertificationReport(path.join(linkedDirectory, 'created', 'report.json'), report),
    /symbolic[- ]link/i,
  );
  await assert.rejects(
    lstat(path.join(outside, 'created')),
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
  );
});

test('deterministic collector runs every repository gate and stores summaries without command output', async () => {
  const root = await tempRoot();
  const tracked = ['README.md', 'REPO_MAP.md', 'package.json'];
  await import('node:fs/promises').then(({ writeFile }) => Promise.all([
    writeFile(path.join(root, 'README.md'), '# Loom\n'),
    writeFile(path.join(root, 'package.json'), '{"name":"loom"}\n'),
    writeFile(path.join(root, 'REPO_MAP.md'), tracked.map((entry) => `### \`${entry}\``).join('\n')),
  ]));
  const calls: string[] = [];
  const pack = JSON.stringify([{ files: [
    { path: 'package.json' },
    { path: 'LICENSE' },
    { path: 'NOTICE' },
    { path: 'README.md' },
    { path: 'dist/src/cli.js' },
    { path: 'dist/src/runtime.js' },
    { path: 'dist/src/certification-cli.js' },
    { path: 'public/dashboard.css' },
    { path: 'public/dashboard.html' },
    { path: 'public/dashboard.js' },
    { path: 'docs/OPERATOR.md' },
    { path: 'docs/SECURITY.md' },
    { path: 'docs/DEVELOPMENT.md' },
    { path: 'docs/RELEASE_CERTIFICATION.md' },
    { path: 'docs/certification-evidence.example.json' },
    { path: 'docs/release-evidence/README.md' },
  ] }]);
  const runner: CertificationCommandRunner = async (executable, args) => {
    const key = [executable, ...args].join(' ');
    calls.push(key);
    if (key === 'git rev-parse HEAD') return { exitCode: 0, stdout: `${SHA}\n`, stderr: '', timedOut: false };
    if (key === 'git branch --show-current') return { exitCode: 0, stdout: 'release/loom-v1\n', stderr: '', timedOut: false };
    if (key === 'git status --porcelain') return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    if (key === 'git ls-files') return { exitCode: 0, stdout: `${tracked.join('\n')}\n`, stderr: '', timedOut: false };
    if (key === 'npm run typecheck') return { exitCode: 0, stdout: 'secret compiler output', stderr: '', timedOut: false };
    if (key === 'npm test') return { exitCode: 0, stdout: '# tests 222\n# pass 222\n# fail 0\nsecret test output', stderr: '', timedOut: false };
    if (key === 'npm run build') return { exitCode: 0, stdout: 'secret build output', stderr: '', timedOut: false };
    if (key === 'node --test dist/test/docs.test.js') return { exitCode: 0, stdout: '# tests 6\n# pass 6\n', stderr: '', timedOut: false };
    if (key === 'npm pack --dry-run --json') return { exitCode: 0, stdout: pack, stderr: '', timedOut: false };
    if (key === 'ps -axo pid,ppid,pgid,command') return { exitCode: 0, stdout: '  1 0 1 /sbin/launchd\n', stderr: '', timedOut: false };
    throw new Error(`Unexpected command: ${key}`);
  };

  const evidence = await collectDeterministicCertificationEvidence({
    repositoryRoot: root,
    runner,
    platform: 'darwin',
    architecture: 'arm64',
    nodeVersion: 'v22.17.0',
    now: () => new Date('2026-07-08T20:00:00.000Z'),
  });
  assert.equal(evidence.releaseSha, SHA);
  assert.equal(evidence.cleanTree, true);
  assert.equal(evidence.checks.tests.status, 'pass');
  assert.match(evidence.checks.tests.summary, /222\/222/);
  assert.equal(JSON.stringify(evidence).includes('secret'), false);
  assert.deepEqual(evidence.processResidue, []);
  assert.deepEqual(calls, [
    'git rev-parse HEAD',
    'git branch --show-current',
    'git status --porcelain',
    'npm run typecheck',
    'npm test',
    'npm run build',
    'node --test dist/test/docs.test.js',
    'git ls-files',
    'npm pack --dry-run --json',
    'ps -axo pid,ppid,pgid,command',
  ]);
});

test('deterministic collector records failures and residue without throwing away later evidence', async () => {
  const root = await tempRoot();
  await import('node:fs/promises').then(({ writeFile }) => writeFile(
    path.join(root, 'REPO_MAP.md'),
    '### `REPO_MAP.md`\n',
  ));
  const runner: CertificationCommandRunner = async (executable, args) => {
    const key = [executable, ...args].join(' ');
    if (key === 'git rev-parse HEAD') return { exitCode: 0, stdout: `${SHA}\n`, stderr: '', timedOut: false };
    if (key === 'git branch --show-current') return { exitCode: 0, stdout: 'dirty\n', stderr: '', timedOut: false };
    if (key === 'git status --porcelain') return { exitCode: 0, stdout: ' M src/runtime.ts\n', stderr: '', timedOut: false };
    if (key === 'git ls-files') return { exitCode: 0, stdout: 'REPO_MAP.md\nsrc/runtime.ts\n', stderr: '', timedOut: false };
    if (key === 'npm run typecheck') return { exitCode: 1, stdout: '', stderr: 'type error', timedOut: false };
    if (key === 'npm test') return { exitCode: 1, stdout: '# tests 2\n# pass 1\n# fail 1\n', stderr: '', timedOut: false };
    if (key === 'npm run build') return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    if (key === 'node --test dist/test/docs.test.js') return { exitCode: 0, stdout: '# tests 6\n', stderr: '', timedOut: false };
    if (key === 'npm pack --dry-run --json') return { exitCode: 1, stdout: '', stderr: 'pack failed', timedOut: false };
    if (key === 'ps -axo pid,ppid,pgid,command') return {
      exitCode: 0,
      stdout: [
        ' 99 1 99 node dist/src/child-wrapper.js',
        ' 100 1 100 /Users/aashu/.loom/cloudflared/cloudflared tunnel --no-autoupdate',
        ' 101 1 101 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/aashu/.loom/browser-profile',
        '',
      ].join('\n'),
      stderr: '',
      timedOut: false,
    };
    throw new Error(key);
  };
  const evidence = await collectDeterministicCertificationEvidence({
    repositoryRoot: root,
    runner,
    platform: 'linux',
    architecture: 'x64',
    nodeVersion: 'v20.0.0',
  });
  assert.equal(evidence.cleanTree, false);
  assert.equal(evidence.checks.typecheck.status, 'fail');
  assert.equal(evidence.checks.tests.status, 'fail');
  assert.equal(evidence.checks.repositoryMap.status, 'fail');
  assert.equal(evidence.checks.packageDryRun.status, 'fail');
  assert.equal(evidence.checks.processResidue.status, 'fail');
  assert.equal(evidence.processResidue.length, 3);
  assert.equal(evaluateCertification({ deterministic: evidence }).overall, 'fail');
});

test('package manifest exposes the certification command and an explicit release allowlist', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
    bin?: Record<string, string>;
    files?: string[];
  };
  assert.equal(
    packageJson.scripts?.certify,
    'npm run build && node dist/src/certification-cli.js',
  );
  assert.equal(packageJson.bin?.['loom-certify'], 'dist/src/certification-cli.js');
  assert.equal(packageJson.files?.includes('dist/src'), true);
  assert.equal(packageJson.files?.includes('dist/test'), false);
  assert.equal(packageJson.files?.includes('test'), false);
  assert.equal(packageJson.files?.includes('docs'), false);
  assert.equal(packageJson.files?.includes('docs/RELEASE_CERTIFICATION.md'), true);
  assert.equal(packageJson.files?.includes('docs/certification-evidence.example.json'), true);
});

test('npm pack dry-run parser requires release files and rejects private or development-only content', () => {
  const releaseFiles = [
    'package.json',
    'LICENSE',
    'NOTICE',
    'README.md',
    'dist/src/cli.js',
    'dist/src/runtime.js',
    'dist/src/certification-cli.js',
    'public/dashboard.css',
    'public/dashboard.html',
    'public/dashboard.js',
    'docs/OPERATOR.md',
    'docs/SECURITY.md',
    'docs/DEVELOPMENT.md',
    'docs/RELEASE_CERTIFICATION.md',
    'docs/certification-evidence.example.json',
  ];
  const packJson = (files: string[]) => JSON.stringify([{
    files: files.map((entry) => ({ path: entry })),
  }]);

  const parsed = parseNpmPackDryRun(packJson(releaseFiles));
  assert.equal(parsed.includes('dist/src/cli.js'), true);

  assert.throws(
    () => parseNpmPackDryRun(packJson(releaseFiles.filter((entry) => entry !== 'NOTICE'))),
    /NOTICE|required package file/i,
  );
  assert.throws(
    () => parseNpmPackDryRun(packJson([...releaseFiles, 'dist/test/runtime.test.js'])),
    /development-only/i,
  );
  assert.throws(
    () => parseNpmPackDryRun(packJson([
      ...releaseFiles,
      'docs/plans/internal-plan.txt',
      'docs/release-evidence/private-artifact.txt',
    ])),
    /development-only/i,
  );
  assert.throws(
    () => parseNpmPackDryRun(JSON.stringify([{ files: [
      { path: 'package.json' },
      { path: '.loom/auth.json' },
      { path: 'test/runtime.test.ts' },
    ] }])),
    /private|development-only|required package file/i,
  );
});
