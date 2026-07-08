#!/usr/bin/env node

import { readFileSync } from 'node:fs';

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

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function main(args: string[]): void {
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

  fail(`Unknown command.\n\n${HELP}`);
}

main(process.argv.slice(2));
