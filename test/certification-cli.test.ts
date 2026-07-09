import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  EXPECTED_LOOM_TOOLS,
  type CertificationReport,
  type DeterministicCertificationEvidence,
  type ExternalCertificationEvidence,
} from '../src/certification.js';
import {
  CertificationCliError,
  runCertificationCli,
} from '../src/certification-cli.js';

const SHA = 'a'.repeat(40);

function deterministic(): DeterministicCertificationEvidence {
  return {
    releaseSha: SHA,
    branch: 'release/loom-v1',
    cleanTree: true,
    platform: 'darwin',
    architecture: 'arm64',
    nodeVersion: 'v22.17.0',
    checks: {
      typecheck: { status: 'pass', summary: 'pass' },
      tests: { status: 'pass', summary: 'pass' },
      build: { status: 'pass', summary: 'pass' },
      documentation: { status: 'pass', summary: 'pass' },
      repositoryMap: { status: 'pass', summary: 'pass' },
      packageDryRun: { status: 'pass', summary: 'pass' },
      processResidue: { status: 'pass', summary: 'pass' },
    },
    packageFiles: [
      'package.json',
      'README.md',
      'dist/src/cli.js',
      'dist/src/runtime.js',
      'docs/OPERATOR.md',
      'docs/SECURITY.md',
      'docs/DEVELOPMENT.md',
      'docs/CERTIFICATION.md',
      'docs/certification-evidence.example.json',
    ],
    processResidue: [],
    generatedAt: '2026-07-08T20:00:00.000Z',
  };
}

function external(): ExternalCertificationEvidence {
  const artifact = { path: '/evidence/redacted.txt', sha256: 'b'.repeat(64) };
  const cloudflaredArtifact = { path: '/evidence/cloudflared', sha256: 'c'.repeat(64) };
  const chromiumArtifact = { path: '/evidence/chromium', sha256: 'd'.repeat(64) };
  const packageArtifact = { path: '/evidence/loom.tgz', sha256: 'e'.repeat(64) };
  return {
    g5: {
      releaseSha: SHA,
      host: {
        platform: 'darwin', architecture: 'arm64', macosVersion: '15.5', nodeVersion: 'v22.17.0',
      },
      cloudflared: { managed: true, version: '2026.6.1', sha256: 'c'.repeat(64) },
      chromium: { managed: true, revision: '138.0.7204.92', sha256: 'd'.repeat(64) },
      quickTunnel: { registered: true, productionEligible: false, publicAccessTerminated: true },
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

test('certification CLI writes a blocked report and returns 2 without external evidence', async () => {
  const writes: Array<{ path: string; report: CertificationReport }> = [];
  const output: string[] = [];
  const code = await runCertificationCli(
    ['--output', './report.json'],
    {
      cwd: '/repo',
      collect: async () => deterministic(),
      writeReport: async (reportPath, report) => { writes.push({ path: reportPath, report }); },
      stdout: (text) => { output.push(text); },
    },
  );
  assert.equal(code, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.path, path.resolve('/repo', 'report.json'));
  assert.equal(writes[0]!.report.overall, 'blocked');
  assert.equal(writes[0]!.report.releaseCertified, false);
  assert.match(output.join(''), /G5: blocked/);
  assert.match(output.join(''), /not certified/i);
});

test('certification CLI validates external evidence and returns 0 only for all passing gates', async () => {
  const writes: CertificationReport[] = [];
  const code = await runCertificationCli(
    ['--output', '/tmp/report.json', '--external', './external.json'],
    {
      cwd: '/repo',
      collect: async () => deterministic(),
      readText: async (filePath) => {
        assert.equal(filePath, '/repo/external.json');
        return JSON.stringify(external());
      },
      verifyExternal: async (evidence) => evidence,
      writeReport: async (_reportPath, report) => { writes.push(report); },
      stdout: () => undefined,
    },
  );
  assert.equal(code, 0);
  assert.equal(writes[0]!.overall, 'pass');
  assert.equal(writes[0]!.releaseCertified, true);
});

test('certification CLI returns 1 for deterministic failure and rejects unsafe arguments', async () => {
  const failed = deterministic();
  failed.checks.tests = { status: 'fail', summary: 'test failure' };
  const code = await runCertificationCli(
    ['--output', '/tmp/report.json'],
    {
      cwd: '/repo',
      collect: async () => failed,
      writeReport: async () => undefined,
      stdout: () => undefined,
    },
  );
  assert.equal(code, 1);

  await assert.rejects(
    runCertificationCli(['--unknown'], { cwd: '/repo' }),
    CertificationCliError,
  );
  await assert.rejects(
    runCertificationCli([], { cwd: '/repo' }),
    /--output/,
  );
});

test('certification CLI help has no side effects', async () => {
  let collected = false;
  let written = false;
  const output: string[] = [];
  const code = await runCertificationCli(
    ['--help'],
    {
      cwd: '/repo',
      collect: async () => { collected = true; return deterministic(); },
      writeReport: async () => { written = true; },
      stdout: (text) => { output.push(text); },
    },
  );
  assert.equal(code, 0);
  assert.equal(collected, false);
  assert.equal(written, false);
  assert.match(output.join(''), /--external/);
  assert.match(output.join(''), /exit 2/i);
});
