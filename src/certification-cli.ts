#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectDeterministicCertificationEvidence,
  evaluateCertification,
  validateExternalCertificationEvidence,
  verifyExternalCertificationArtifacts,
  writeCertificationReport,
  type CertificationReport,
  type CollectDeterministicCertificationOptions,
  type DeterministicCertificationEvidence,
} from './certification.js';

export const CERTIFICATION_CLI_USAGE = `Usage:
  loom-certify --output <report.json> [--external <evidence.json>]
  loom-certify --help

The command runs deterministic G4 checks for the exact current commit.
G5-G7 remain blocked unless strict external evidence bound to that commit is supplied.
Exit 0: all G4-G7 pass
Exit 1: a performed check failed
Exit 2: no failures, but one or more external gates are blocked
`;

export class CertificationCliError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CertificationCliError';
  }
}

interface ParsedArguments {
  help: boolean;
  outputPath?: string;
  externalPath?: string;
}

export interface CertificationCliDependencies {
  cwd?: string;
  collect?: (
    options: CollectDeterministicCertificationOptions,
  ) => Promise<DeterministicCertificationEvidence>;
  readText?: (filePath: string) => Promise<string>;
  verifyExternal?: typeof verifyExternalCertificationArtifacts;
  writeReport?: (reportPath: string, report: CertificationReport) => Promise<void>;
  stdout?: (text: string) => void;
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === '--help' || value === '-h') {
      parsed.help = true;
      continue;
    }
    if (value === '--output') {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new CertificationCliError('--output requires a report path.');
      }
      if (parsed.outputPath !== undefined) {
        throw new CertificationCliError('--output may be specified only once.');
      }
      parsed.outputPath = next;
      index += 1;
      continue;
    }
    if (value === '--external') {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new CertificationCliError('--external requires an evidence JSON path.');
      }
      if (parsed.externalPath !== undefined) {
        throw new CertificationCliError('--external may be specified only once.');
      }
      parsed.externalPath = next;
      index += 1;
      continue;
    }
    throw new CertificationCliError(`Unknown certification argument: ${value}`);
  }
  if (!parsed.help && parsed.outputPath === undefined) {
    throw new CertificationCliError('--output is required.');
  }
  return parsed;
}

function renderReport(report: CertificationReport, reportPath: string): string {
  return [
    `Release SHA: ${report.releaseSha}`,
    `G4: ${report.gates.G4.status} — ${report.gates.G4.summary}`,
    `G5: ${report.gates.G5.status} — ${report.gates.G5.summary}`,
    `G6: ${report.gates.G6.status} — ${report.gates.G6.summary}`,
    `G7: ${report.gates.G7.status} — ${report.gates.G7.summary}`,
    `Overall: ${report.overall}`,
    report.releaseCertified
      ? 'Release certified by the supplied G4-G7 evidence.'
      : 'Release is not certified.',
    `Report: ${reportPath}`,
    '',
  ].join('\n');
}

export async function runCertificationCli(
  argv: readonly string[],
  dependencies: CertificationCliDependencies = {},
): Promise<number> {
  const parsed = parseArguments(argv);
  const stdout = dependencies.stdout ?? ((text: string) => { process.stdout.write(text); });
  if (parsed.help) {
    stdout(CERTIFICATION_CLI_USAGE);
    return 0;
  }

  const cwd = path.resolve(dependencies.cwd ?? process.cwd());
  const outputPath = path.resolve(cwd, parsed.outputPath!);
  const collect = dependencies.collect ?? collectDeterministicCertificationEvidence;
  const readText = dependencies.readText ?? ((filePath: string) => readFile(filePath, 'utf8'));
  const writeReport = dependencies.writeReport ?? writeCertificationReport;
  const deterministic = await collect({ repositoryRoot: cwd });

  let external;
  if (parsed.externalPath !== undefined) {
    const externalPath = path.resolve(cwd, parsed.externalPath);
    let raw: unknown;
    try {
      raw = JSON.parse(await readText(externalPath));
    } catch (error) {
      throw new CertificationCliError(
        `Unable to read external certification evidence ${externalPath}: ${String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
    const validated = validateExternalCertificationEvidence(raw, deterministic.releaseSha);
    external = await (dependencies.verifyExternal ?? verifyExternalCertificationArtifacts)(validated);
  }

  const report = evaluateCertification({
    deterministic,
    ...(external === undefined ? {} : { external }),
  });
  await writeReport(outputPath, report);
  stdout(renderReport(report, outputPath));
  if (report.overall === 'pass') return 0;
  if (report.overall === 'fail') return 1;
  return 2;
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCertificationCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
