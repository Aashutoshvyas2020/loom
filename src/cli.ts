#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

import { checkConfig, resetConfig } from './config.js';

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

const HELP = `Loom ${packageJson.version}

Foreground-only single-owner MCP server for macOS 14+.

Usage:
  loom launch --yolo   Start Loom with unrestricted remote tools enabled
  loom setup browser   Install and verify the pinned Chromium build
  loom auth reset      Rotate the persistent owner password
  loom config check    Validate configuration without modifying it
  loom config reset    Restore valid default configuration
  loom --version       Print version
  loom --help          Print help
`;

class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message);
}

async function confirmConfigReset(): Promise<boolean> {
  let inputHandle;
  let outputHandle;
  try {
    inputHandle = await open('/dev/tty', 'r');
    outputHandle = await open('/dev/tty', 'w');
  } catch (error) {
    await inputHandle?.close().catch(() => undefined);
    await outputHandle?.close().catch(() => undefined);
    throw new CliError(`Local terminal confirmation is required: ${String(error)}`);
  }

  const input = inputHandle.createReadStream({ autoClose: false });
  const output = outputHandle.createWriteStream({ autoClose: false });
  const prompt = createInterface({ input, output });

  try {
    const answer = await prompt.question('Type RESET to restore the default Loom configuration: ');
    return answer.trim() === 'RESET';
  } finally {
    prompt.close();
    input.destroy();
    output.end();
    await Promise.allSettled([inputHandle.close(), outputHandle.close()]);
  }
}

async function main(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }

  if (args[0] === 'launch') {
    if (args.length === 2 && args[1] === '--yolo') {
      fail('Loom runtime is not implemented yet.');
    }

    fail('Unrestricted access is disabled. Start it explicitly with: loom launch --yolo');
  }

  if (args.length === 2 && args[0] === 'config' && args[1] === 'check') {
    await checkConfig();
    process.stdout.write('Configuration valid.\n');
    return;
  }

  if (args.length === 2 && args[0] === 'config' && args[1] === 'reset') {
    if (!await confirmConfigReset()) {
      fail('Configuration reset cancelled.');
    }
    const result = await resetConfig();
    process.stdout.write('Configuration reset to defaults.\n');
    if (result.backupPath !== undefined) {
      process.stdout.write(`Invalid prior configuration preserved at ${result.backupPath}\n`);
    }
    return;
  }

  fail(`Unknown command.\n\n${HELP}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
});
