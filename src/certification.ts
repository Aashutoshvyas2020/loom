import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants as fsConstants, type Stats } from 'node:fs';

import { z } from 'zod';

import {
  PINNED_CHROMIUM_REVISION,
  pinnedChromiumExecutableSha256For,
} from './browser/setup.js';
import { CLOUDFLARED_VERSION, cloudflaredReleaseFor } from './cloudflare.js';
import { assertNoSymlinkComponents } from './paths.js';

export const CERTIFICATION_VERSION = 1 as const;

export const EXPECTED_LOOM_TOOLS = [
  'loom_read',
  'loom_write',
  'loom_edit',
  'loom_terminal',
  'loom_skills',
  'loom_memory',
  'loom_browser',
] as const;

const REQUIRED_PACKAGE_FILES = [
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
] as const;

const SHA1_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export class CertificationEvidenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CertificationEvidenceError';
  }
}

const checkEvidenceSchema = z.object({
  status: z.enum(['pass', 'fail']),
  summary: z.string().min(1).max(1_024),
}).strict();

const deterministicEvidenceSchema = z.object({
  releaseSha: z.string().regex(SHA1_PATTERN),
  branch: z.string().min(1).max(256),
  cleanTree: z.boolean(),
  platform: z.string().min(1).max(64),
  architecture: z.string().min(1).max(64),
  nodeVersion: z.string().min(1).max(64),
  checks: z.object({
    typecheck: checkEvidenceSchema,
    tests: checkEvidenceSchema,
    build: checkEvidenceSchema,
    documentation: checkEvidenceSchema,
    repositoryMap: checkEvidenceSchema,
    packageDryRun: checkEvidenceSchema,
    processResidue: checkEvidenceSchema,
  }).strict(),
  packageFiles: z.array(z.string().min(1).max(1_024)).max(10_000),
  processResidue: z.array(z.string().min(1).max(4_096)).max(10_000),
  generatedAt: z.string().datetime(),
}).strict();

export type DeterministicCertificationEvidence = z.infer<typeof deterministicEvidenceSchema>;

export interface CertificationCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type CertificationCommandRunner = (
  executable: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<CertificationCommandResult>;

export interface CollectDeterministicCertificationOptions {
  repositoryRoot: string;
  runner?: CertificationCommandRunner;
  platform?: NodeJS.Platform | string;
  architecture?: string;
  nodeVersion?: string;
  now?: () => Date;
}

const artifactSchema = z.object({
  path: z.string().min(1).max(4_096).refine(path.isAbsolute, {
    message: 'Evidence artifact paths must be absolute.',
  }),
  sha256: z.string().regex(SHA256_PATTERN),
}).strict();

const g5EvidenceSchema = z.object({
  releaseSha: z.string().regex(SHA1_PATTERN),
  host: z.object({
    platform: z.literal('darwin'),
    architecture: z.enum(['arm64', 'x64']),
    macosVersion: z.string().min(1).max(128),
    nodeVersion: z.string().min(1).max(64),
  }).strict(),
  cloudflared: z.object({
    managed: z.literal(true),
    version: z.literal(CLOUDFLARED_VERSION),
    sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  chromium: z.object({
    managed: z.literal(true),
    revision: z.literal(PINNED_CHROMIUM_REVISION),
    sha256: z.string().regex(SHA256_PATTERN),
  }).strict(),
  quickTunnel: z.object({
    registered: z.literal(true),
    productionEligible: z.literal(false),
    publicAccessTerminated: z.literal(true),
  }).strict().optional(),
  namedTunnel: z.object({
    registered: z.literal(true),
    endpoint: z.string().superRefine((value, context) => {
      let endpoint: URL;
      try {
        endpoint = new URL(value);
      } catch {
        context.addIssue({ code: 'custom', message: 'Named Tunnel endpoint must be stable HTTPS.' });
        return;
      }
      const hostname = endpoint.hostname.toLowerCase();
      if (endpoint.protocol !== 'https:'
        || endpoint.pathname !== '/mcp'
        || endpoint.search !== ''
        || endpoint.hash !== ''
        || endpoint.username !== ''
        || endpoint.password !== ''
        || hostname === 'trycloudflare.com'
        || hostname.endsWith('.trycloudflare.com')) {
        context.addIssue({ code: 'custom', message: 'Named Tunnel endpoint must be stable HTTPS ending in /mcp.' });
      }
    }),
    stableRestartGenerationPreserved: z.literal(true),
    hostnameChangeGenerationIncremented: z.literal(true),
    ownerPasswordPreserved: z.literal(true),
    noQuickFallback: z.literal(true),
    publicAccessTerminated: z.literal(true),
  }).strict(),
  processResidue: z.array(z.never()).length(0),
  artifacts: z.array(artifactSchema).min(2).max(1_000),
}).strict().superRefine((value, context) => {
  const hashes = new Set(value.artifacts.map((artifact) => artifact.sha256.toLowerCase()));
  if (!hashes.has(value.cloudflared.sha256.toLowerCase())) {
    context.addIssue({
      code: 'custom',
      path: ['artifacts'],
      message: 'G5 artifacts must include the managed Cloudflared binary SHA-256.',
    });
  }
  if (!hashes.has(value.chromium.sha256.toLowerCase())) {
    context.addIssue({
      code: 'custom',
      path: ['artifacts'],
      message: 'G5 artifacts must include the managed Chromium executable SHA-256.',
    });
  }

  const cloudflaredRelease = cloudflaredReleaseFor(value.host.architecture);
  if (value.cloudflared.sha256.toLowerCase() !== cloudflaredRelease.executableSha256) {
    context.addIssue({
      code: 'custom',
      path: ['cloudflared', 'sha256'],
      message: 'G5 Cloudflared SHA-256 does not match the pinned architecture-specific executable.',
    });
  }
  const chromiumSha256 = pinnedChromiumExecutableSha256For(value.host.architecture);
  if (value.chromium.sha256.toLowerCase() !== chromiumSha256) {
    context.addIssue({
      code: 'custom',
      path: ['chromium', 'sha256'],
      message: 'G5 Chromium SHA-256 does not match the pinned architecture-specific executable.',
    });
  }
});

const g6EvidenceSchema = z.object({
  releaseSha: z.string().regex(SHA1_PATTERN),
  chatGptEligible: z.literal(true),
  oauthCompleted: z.literal(true),
  unauthorizedRejected: z.literal(true),
  revokedCredentialsRejected: z.literal(true),
  toolsInvoked: z.array(z.string()).length(EXPECTED_LOOM_TOOLS.length).superRefine((value, context) => {
    const expected = new Set<string>(EXPECTED_LOOM_TOOLS);
    const actual = new Set(value);
    if (actual.size !== EXPECTED_LOOM_TOOLS.length
      || [...expected].some((tool) => !actual.has(tool))) {
      context.addIssue({
        code: 'custom',
        message: 'toolsInvoked must contain all seven Loom tools exactly once.',
      });
    }
  }),
  auditSecretScanPassed: z.literal(true),
  publicAccessTerminated: z.literal(true),
  processResidue: z.array(z.never()).length(0),
  artifacts: z.array(artifactSchema).min(1).max(1_000),
}).strict();

const g7EvidenceSchema = z.object({
  releaseSha: z.string().regex(SHA1_PATTERN),
  immutableRelease: z.literal(true),
  cleanSupportedMacInstall: z.literal(true),
  packageSha256: z.string().regex(SHA256_PATTERN),
  fullGatePassed: z.literal(true),
  documentationConsistent: z.literal(true),
  publicAccessTerminated: z.literal(true),
  processResidue: z.array(z.never()).length(0),
  artifacts: z.array(artifactSchema).min(1).max(1_000),
}).strict().superRefine((value, context) => {
  if (!value.artifacts.some((artifact) => (
    artifact.sha256.toLowerCase() === value.packageSha256.toLowerCase()
  ))) {
    context.addIssue({
      code: 'custom',
      path: ['artifacts'],
      message: 'G7 artifacts must include the certified package SHA-256.',
    });
  }
});

const externalEvidenceSchema = z.object({
  g5: g5EvidenceSchema.optional(),
  g6: g6EvidenceSchema.optional(),
  g7: g7EvidenceSchema.optional(),
}).strict();

export type ExternalCertificationEvidence = z.infer<typeof externalEvidenceSchema>;

export interface CertificationGateResult {
  status: 'pass' | 'fail' | 'blocked';
  summary: string;
}

export interface CertificationReport {
  version: typeof CERTIFICATION_VERSION;
  releaseSha: string;
  branch: string;
  generatedAt: string;
  overall: 'pass' | 'fail' | 'blocked';
  releaseCertified: boolean;
  deterministic: DeterministicCertificationEvidence;
  externalEvidencePresent: {
    G5: boolean;
    G6: boolean;
    G7: boolean;
  };
  gates: {
    G4: CertificationGateResult;
    G5: CertificationGateResult;
    G6: CertificationGateResult;
    G7: CertificationGateResult;
  };
}

function parseEvidence<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CertificationEvidenceError(
      `${label} is invalid: ${result.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  return result.data;
}

export function validateExternalCertificationEvidence(
  value: unknown,
  releaseSha: string,
): ExternalCertificationEvidence {
  if (!SHA1_PATTERN.test(releaseSha)) {
    throw new CertificationEvidenceError('Expected release SHA is invalid.');
  }
  const parsed = parseEvidence(externalEvidenceSchema, value, 'External certification evidence');
  for (const [gate, evidence] of Object.entries(parsed)) {
    if (evidence !== undefined && evidence.releaseSha !== releaseSha) {
      throw new CertificationEvidenceError(
        `${gate.toUpperCase()} evidence release SHA does not match ${releaseSha}.`,
      );
    }
  }
  return parsed;
}

function artifactIdentityMatches(before: Stats, after: Stats): boolean {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs;
}

async function verifyArtifact(artifact: z.infer<typeof artifactSchema>): Promise<void> {
  await assertNoSymlinkComponents(artifact.path);
  let handle;
  try {
    handle = await open(artifact.path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    throw new CertificationEvidenceError(
      `Unable to open certification artifact ${artifact.path} without following symbolic links.`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new CertificationEvidenceError(`Certification artifact is not a regular file: ${artifact.path}`);
    }
    if (typeof process.getuid === 'function' && before.uid !== process.getuid()) {
      throw new CertificationEvidenceError(`Certification artifact is not owned by the current user: ${artifact.path}`);
    }
    if ((before.mode & 0o022) !== 0) {
      throw new CertificationEvidenceError(`Certification artifact is writable by another user: ${artifact.path}`);
    }
    if (before.size <= 0 || before.size > 2 * 1024 * 1024 * 1024) {
      throw new CertificationEvidenceError(`Certification artifact has an invalid size: ${artifact.path}`);
    }
    const hash = createHash('sha256');
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) hash.update(chunk as Buffer);
    const after = await handle.stat();
    if (!artifactIdentityMatches(before, after)) {
      throw new CertificationEvidenceError(`Certification artifact changed while being hashed: ${artifact.path}`);
    }
    const actual = hash.digest('hex');
    if (actual.toLowerCase() !== artifact.sha256.toLowerCase()) {
      throw new CertificationEvidenceError(`Certification artifact SHA-256 mismatch: ${artifact.path}`);
    }
  } finally {
    await handle.close();
  }
}

export async function verifyExternalCertificationArtifacts(
  evidence: ExternalCertificationEvidence,
): Promise<ExternalCertificationEvidence> {
  const artifacts = new Map<string, z.infer<typeof artifactSchema>>();
  for (const gate of [evidence.g5, evidence.g6, evidence.g7]) {
    for (const artifact of gate?.artifacts ?? []) {
      const previous = artifacts.get(artifact.path);
      if (previous !== undefined
        && previous.sha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
        throw new CertificationEvidenceError(
          `Certification artifact path has conflicting SHA-256 values: ${artifact.path}`,
        );
      }
      artifacts.set(artifact.path, artifact);
    }
  }
  for (const artifact of artifacts.values()) await verifyArtifact(artifact);
  return evidence;
}

function nodeMajor(version: string): number | null {
  const match = /^v?(\d+)/.exec(version);
  if (match === null) return null;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function deterministicGate(
  evidence: DeterministicCertificationEvidence,
): CertificationGateResult {
  const failedChecks = Object.entries(evidence.checks)
    .filter(([, result]) => result.status !== 'pass')
    .map(([name, result]) => `${name}: ${result.summary}`);
  const missingPackageFiles = REQUIRED_PACKAGE_FILES
    .filter((required) => !evidence.packageFiles.includes(required));
  const hostFailures: string[] = [];
  if (evidence.platform !== 'darwin') hostFailures.push(`unsupported platform ${evidence.platform}`);
  const major = nodeMajor(evidence.nodeVersion);
  if (major === null || major < 22) hostFailures.push(`unsupported Node ${evidence.nodeVersion}`);
  if (!evidence.cleanTree) hostFailures.push('working tree is dirty');
  if (evidence.processResidue.length > 0) {
    hostFailures.push(`${evidence.processResidue.length} Loom-owned process(es) remain`);
  }
  const failures = [
    ...failedChecks,
    ...missingPackageFiles.map((file) => `package missing ${file}`),
    ...hostFailures,
  ];
  return failures.length === 0
    ? { status: 'pass', summary: 'Deterministic runtime, package, documentation, map, and residue checks passed.' }
    : { status: 'fail', summary: `Deterministic certification failed: ${failures.join('; ')}` };
}

export function evaluateCertification(input: {
  deterministic: DeterministicCertificationEvidence;
  external?: ExternalCertificationEvidence;
}): CertificationReport {
  const deterministicEvidence = parseEvidence(
    deterministicEvidenceSchema,
    input.deterministic,
    'Deterministic certification evidence',
  );
  const external = input.external === undefined
    ? {}
    : validateExternalCertificationEvidence(input.external, deterministicEvidence.releaseSha);

  const G4 = deterministicGate(deterministicEvidence);
  const G5: CertificationGateResult = external.g5 === undefined
    ? {
        status: 'blocked',
        summary: 'G5 requires real managed components and tunnel evidence from the exact release SHA.',
      }
    : {
        status: 'blocked',
        summary: 'G5 evidence passed structural and artifact-integrity checks but still requires human review of the real external events.',
      };
  const G6: CertificationGateResult = external.g6 === undefined
    ? {
        status: 'blocked',
        summary: 'G6 requires eligible ChatGPT OAuth, all-tool, revocation, audit, shutdown, and residue evidence.',
      }
    : {
        status: 'blocked',
        summary: 'G6 evidence passed structural and artifact-integrity checks but still requires human review of the real ChatGPT and cleanup events.',
      };

  const G7: CertificationGateResult = external.g7 === undefined
    ? {
        status: 'blocked',
        summary: 'G7 requires immutable package and clean supported-Mac installation evidence after G4–G6.',
      }
    : {
        status: 'blocked',
        summary: 'G7 evidence passed structural and artifact-integrity checks but still requires human review of the clean-host release evidence.',
      };

  const gates = { G4, G5, G6, G7 };
  const statuses = Object.values(gates).map((gate) => gate.status);
  const overall: CertificationReport['overall'] = statuses.includes('fail')
    ? 'fail'
    : statuses.every((status) => status === 'pass')
      ? 'pass'
      : 'blocked';

  return {
    version: CERTIFICATION_VERSION,
    releaseSha: deterministicEvidence.releaseSha,
    branch: deterministicEvidence.branch,
    generatedAt: deterministicEvidence.generatedAt,
    overall,
    releaseCertified: overall === 'pass',
    deterministic: deterministicEvidence,
    externalEvidencePresent: {
      G5: external.g5 !== undefined,
      G6: external.g6 !== undefined,
      G7: external.g7 !== undefined,
    },
    gates,
  };
}

const COMMAND_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1_000;
const RESIDUE_PATTERN = /(?:dist\/src\/child-wrapper|loom-runtime|loom-terminal-|loom-process-|\/bin\/sleep 30|\/\.loom\/cloudflared\/cloudflared(?:\s|$)|\/\.loom\/browser-profile(?:\/|\s|$))/;

function appendBounded(chunks: Buffer[], chunk: Buffer, currentBytes: number): number {
  if (currentBytes >= COMMAND_OUTPUT_LIMIT_BYTES) return currentBytes;
  const remaining = COMMAND_OUTPUT_LIMIT_BYTES - currentBytes;
  const accepted = chunk.subarray(0, remaining);
  chunks.push(accepted);
  return currentBytes + accepted.length;
}

export const runCertificationCommand: CertificationCommandRunner = async (
  executable,
  args,
  options,
) => new Promise((resolve, reject) => {
  const child = spawn(executable, [...args], {
    cwd: options.cwd,
    detached: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let settled = false;

  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
  }, options.timeoutMs);
  timer.unref?.();

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes = appendBounded(stdout, chunk, stdoutBytes);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes = appendBounded(stderr, chunk, stderrBytes);
  });
  child.once('error', (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(new CertificationEvidenceError(
      `Unable to run certification command ${executable}: ${error.message}`,
      { cause: error },
    ));
  });
  child.once('close', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve({
      exitCode: code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      timedOut,
    });
  });
});

function commandCheck(
  label: string,
  result: CertificationCommandResult,
  successSummary: string,
): z.infer<typeof checkEvidenceSchema> {
  if (result.timedOut) {
    return { status: 'fail', summary: `${label} timed out.` };
  }
  if (result.exitCode !== 0) {
    return { status: 'fail', summary: `${label} exited with code ${String(result.exitCode)}.` };
  }
  return { status: 'pass', summary: successSummary };
}

function testSummary(result: CertificationCommandResult): string {
  const tests = /# tests (\d+)/.exec(result.stdout)?.[1];
  const passes = /# pass (\d+)/.exec(result.stdout)?.[1];
  return tests === undefined
    ? 'npm test completed successfully.'
    : `npm test: ${passes ?? tests}/${tests} passed.`;
}

function mappedPaths(text: string): string[] {
  return [...text.matchAll(/^### `(.+)`$/gm)].map((match) => match[1]!).sort();
}

async function repositoryMapCheck(
  repositoryRoot: string,
  trackedResult: CertificationCommandResult,
): Promise<z.infer<typeof checkEvidenceSchema>> {
  if (trackedResult.timedOut || trackedResult.exitCode !== 0) {
    return commandCheck('git ls-files', trackedResult, 'Repository map checked.');
  }
  try {
    const tracked = trackedResult.stdout.split(/\r?\n/).filter(Boolean).sort();
    const mapped = mappedPaths(await readFile(path.join(repositoryRoot, 'REPO_MAP.md'), 'utf8'));
    if (tracked.length !== mapped.length
      || tracked.some((entry, index) => entry !== mapped[index])) {
      return {
        status: 'fail',
        summary: `REPO_MAP mismatch: ${tracked.length} tracked versus ${mapped.length} mapped paths.`,
      };
    }
    return { status: 'pass', summary: `REPO_MAP exactly documents ${tracked.length} tracked paths.` };
  } catch {
    return { status: 'fail', summary: 'REPO_MAP could not be read or compared.' };
  }
}

export async function collectDeterministicCertificationEvidence(
  options: CollectDeterministicCertificationOptions,
): Promise<DeterministicCertificationEvidence> {
  if (!path.isAbsolute(options.repositoryRoot)) {
    throw new CertificationEvidenceError('Certification repository root must be absolute.');
  }
  const runner = options.runner ?? runCertificationCommand;
  const commandOptions = { cwd: options.repositoryRoot, timeoutMs: COMMAND_TIMEOUT_MS };
  const run = (executable: string, args: readonly string[]) => (
    runner(executable, args, commandOptions)
  );

  const shaResult = await run('git', ['rev-parse', 'HEAD']);
  const releaseSha = shaResult.stdout.trim();
  if (shaResult.exitCode !== 0 || shaResult.timedOut || !SHA1_PATTERN.test(releaseSha)) {
    throw new CertificationEvidenceError('Unable to resolve a valid release SHA for certification.');
  }
  const branchResult = await run('git', ['branch', '--show-current']);
  const branch = branchResult.exitCode === 0 && !branchResult.timedOut
    ? branchResult.stdout.trim() || '(detached)'
    : '(unknown)';
  const statusResult = await run('git', ['status', '--porcelain']);
  const cleanTree = statusResult.exitCode === 0
    && !statusResult.timedOut
    && statusResult.stdout.trim() === '';

  const typecheckResult = await run('npm', ['run', 'typecheck']);
  const testsResult = await run('npm', ['test']);
  const buildResult = await run('npm', ['run', 'build']);
  const documentationResult = await run('node', ['--test', 'dist/test/docs.test.js']);
  const trackedResult = await run('git', ['ls-files']);
  const repositoryMap = await repositoryMapCheck(options.repositoryRoot, trackedResult);
  const packageResult = await run('npm', ['pack', '--dry-run', '--json']);
  let packageFiles: string[] = [];
  let packageDryRun: z.infer<typeof checkEvidenceSchema>;
  if (packageResult.exitCode === 0 && !packageResult.timedOut) {
    try {
      packageFiles = parseNpmPackDryRun(packageResult.stdout);
      packageDryRun = {
        status: 'pass',
        summary: `npm package contains ${packageFiles.length} approved files.`,
      };
    } catch (error) {
      packageDryRun = {
        status: 'fail',
        summary: error instanceof Error ? error.message : 'npm package validation failed.',
      };
    }
  } else {
    packageDryRun = commandCheck('npm pack --dry-run', packageResult, 'npm package validated.');
  }

  const processResult = await run('ps', ['-axo', 'pid,ppid,pgid,command']);
  const processResidue = processResult.exitCode === 0 && !processResult.timedOut
    ? processResult.stdout.split(/\r?\n/).filter((line) => RESIDUE_PATTERN.test(line))
    : ['Process residue scan did not complete successfully.'];
  const processResidueCheck: z.infer<typeof checkEvidenceSchema> = processResidue.length === 0
    ? { status: 'pass', summary: 'No Loom-owned wrapper, runtime, terminal, or descendant processes remain.' }
    : { status: 'fail', summary: `${processResidue.length} Loom-owned process line(s) remain.` };

  return parseEvidence(deterministicEvidenceSchema, {
    releaseSha,
    branch,
    cleanTree,
    platform: options.platform ?? process.platform,
    architecture: options.architecture ?? process.arch,
    nodeVersion: options.nodeVersion ?? process.version,
    checks: {
      typecheck: commandCheck('npm run typecheck', typecheckResult, 'npm run typecheck passed.'),
      tests: commandCheck('npm test', testsResult, testSummary(testsResult)),
      build: commandCheck('npm run build', buildResult, 'npm run build passed.'),
      documentation: commandCheck(
        'documentation contract',
        documentationResult,
        'Executable documentation contract passed.',
      ),
      repositoryMap,
      packageDryRun,
      processResidue: processResidueCheck,
    },
    packageFiles,
    processResidue,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
  }, 'Collected deterministic certification evidence');
}

function nestedCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export async function writeCertificationReport(
  reportPath: string,
  report: CertificationReport,
): Promise<void> {
  if (!path.isAbsolute(reportPath)) {
    throw new CertificationEvidenceError('Certification report path must be absolute.');
  }
  const directory = path.dirname(reportPath);
  await assertNoSymlinkComponents(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertNoSymlinkComponents(directory);
  try {
    const current = await lstat(reportPath);
    if (current.isSymbolicLink()) {
      throw new CertificationEvidenceError('Certification report target is a symbolic link.');
    }
    if (!current.isFile()) {
      throw new CertificationEvidenceError('Certification report target is not a regular file.');
    }
  } catch (error) {
    if (nestedCode(error) !== 'ENOENT') throw error;
  }

  const temporary = path.join(directory, `.${path.basename(reportPath)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await chmod(temporary, 0o600);
    await rename(temporary, reportPath);
    await chmod(reportPath, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function parseNpmPackDryRun(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new CertificationEvidenceError('npm pack dry-run output is not valid JSON.', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const schema = z.array(z.object({
    files: z.array(z.object({ path: z.string().min(1) }).passthrough()),
  }).passthrough()).min(1);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new CertificationEvidenceError('npm pack dry-run output has an unexpected shape.');
  }
  const files = [...new Set(result.data[0]!.files.map((entry) => entry.path))].sort();
  const forbidden = files.filter((file) => (
    file === '.loom'
    || file.startsWith('.loom/')
    || file.startsWith('test/')
    || file.startsWith('dist/test/')
    || file.startsWith('docs/plans/')
    || file.startsWith('docs/release-evidence/')
    || file.startsWith('node_modules/')
    || file.startsWith('.git/')
    || /(?:^|\/)(?:auth\.json|cert\.pem|credentials[^/]*\.json)$/i.test(file)
  ));
  if (forbidden.length > 0) {
    throw new CertificationEvidenceError(
      `Package contains private or development-only content: ${forbidden.join(', ')}`,
    );
  }
  const missing = REQUIRED_PACKAGE_FILES.filter((required) => !files.includes(required));
  if (missing.length > 0) {
    throw new CertificationEvidenceError(
      `Package is missing required package file(s): ${missing.join(', ')}`,
    );
  }
  return files;
}
