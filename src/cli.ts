#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  installPinnedChromium,
  type ChromiumInstallManifest,
  type InstallPinnedChromiumOptions,
} from './browser/setup.js';
import { checkConfig, initializeState, readRuntimeLock, resetConfig } from './config.js';
import { AuthStore } from './oauth.js';
import { resolveUserPath } from './paths.js';
import { inspectProcess, observableIdentityMatches } from './watchdog.js';

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

interface LocalTerminal {
  inputHandle: FileHandle;
  outputHandle: FileHandle;
}

const confirmationDecoder = new TextDecoder('utf-8', { fatal: true });
const MAX_CONFIRMATION_BYTES = 128;

function fail(message: string): never {
  throw new CliError(message);
}

function nestedErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && typeof current.code === 'string') {
      return current.code;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

async function openLocalTerminal(): Promise<LocalTerminal> {
  let inputHandle: FileHandle | undefined;
  let outputHandle: FileHandle | undefined;
  try {
    inputHandle = await open('/dev/tty', 'r');
    outputHandle = await open('/dev/tty', 'w');
    return { inputHandle, outputHandle };
  } catch (error) {
    await inputHandle?.close().catch(() => undefined);
    await outputHandle?.close().catch(() => undefined);
    throw new CliError(`Local terminal confirmation is required: ${String(error)}`);
  }
}

async function closeLocalTerminal(terminal: LocalTerminal): Promise<void> {
  await Promise.allSettled([
    terminal.inputHandle.close(),
    terminal.outputHandle.close(),
  ]);
}

async function writeTerminal(terminal: LocalTerminal, text: string): Promise<void> {
  await terminal.outputHandle.writeFile(text);
}

async function readTerminalLine(terminal: LocalTerminal): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (totalBytes < MAX_CONFIRMATION_BYTES) {
    const remaining = MAX_CONFIRMATION_BYTES - totalBytes;
    const buffer = Buffer.alloc(Math.min(64, remaining));
    const { bytesRead } = await terminal.inputHandle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) {
      throw new CliError('Local terminal closed before confirmation was received.');
    }

    const chunk = buffer.subarray(0, bytesRead);
    const lineEnd = chunk.findIndex((byte) => byte === 0x0a || byte === 0x0d);
    if (lineEnd >= 0) {
      chunks.push(chunk.subarray(0, lineEnd));
      try {
        return confirmationDecoder.decode(Buffer.concat(chunks)).trim();
      } catch (error) {
        throw new CliError(`Local terminal confirmation must be valid UTF-8: ${String(error)}`);
      }
    }

    chunks.push(chunk);
    totalBytes += bytesRead;
  }

  throw new CliError(`Local terminal confirmation exceeds ${MAX_CONFIRMATION_BYTES} bytes.`);
}

async function withLocalConfirmation<T>(
  question: string,
  operation: (terminal: LocalTerminal) => Promise<T>,
): Promise<T> {
  const terminal = await openLocalTerminal();
  try {
    await writeTerminal(terminal, question);
    const answer = await readTerminalLine(terminal);
    if (answer !== 'RESET') {
      fail('Operation cancelled.');
    }
    return await operation(terminal);
  } finally {
    await closeLocalTerminal(terminal);
  }
}

async function runtimeIsLive(stateRoot = '~/.loom'): Promise<boolean> {
  let lock;
  try {
    lock = await readRuntimeLock(stateRoot);
  } catch (error) {
    if (nestedErrorCode(error) === 'ENOENT') {
      return false;
    }
    throw new CliError(`Unable to verify Loom runtime state safely: ${String(error)}`);
  }

  let observed;
  try {
    observed = await inspectProcess(lock.pid);
  } catch (error) {
    throw new CliError(`Unable to verify Loom runtime process safely: ${String(error)}`);
  }
  if (observed === null) {
    return false;
  }
  return observableIdentityMatches(lock, observed);
}

export async function setupBrowser(
  stateRoot = '~/.loom',
  installBrowser: (
    options: InstallPinnedChromiumOptions,
  ) => Promise<ChromiumInstallManifest> = installPinnedChromium,
): Promise<ChromiumInstallManifest> {
  await initializeState(stateRoot);
  return installBrowser({
    installationDirectory: path.join(resolveUserPath(stateRoot), 'browser'),
  });
}

async function resetOwnerPassword(): Promise<void> {
  if (await runtimeIsLive()) {
    fail('Loom is currently running. Stop Loom before rotating the owner password.');
  }

  await withLocalConfirmation(
    'Type RESET to rotate the Loom owner password: ',
    async (terminal) => {
      if (await runtimeIsLive()) {
        fail('Loom started while reset was pending. Stop Loom and try again.');
      }
      const opened = await AuthStore.open('~/.loom');
      const result = await opened.store.resetOwnerCredential();
      await writeTerminal(
        terminal,
        `\nNew Loom owner password: ${result.ownerPassword}\n`
        + 'Store it securely. Sharing it is equivalent to giving away this macOS account.\n',
      );
    },
  );
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

  if (args.length === 2 && args[0] === 'setup' && args[1] === 'browser') {
    const manifest = await setupBrowser();
    process.stdout.write(
      `Installed Playwright Chromium ${manifest.chromiumVersion} `
      + `(revision ${manifest.chromiumRevision}) at ${manifest.executablePath}\n`,
    );
    return;
  }

  if (args.length === 2 && args[0] === 'auth' && args[1] === 'reset') {
    await resetOwnerPassword();
    return;
  }

  if (args.length === 2 && args[0] === 'config' && args[1] === 'check') {
    await checkConfig();
    process.stdout.write('Configuration valid.\n');
    return;
  }

  if (args.length === 2 && args[0] === 'config' && args[1] === 'reset') {
    const result = await withLocalConfirmation(
      'Type RESET to restore the default Loom configuration: ',
      async () => resetConfig(),
    );
    process.stdout.write('Configuration reset to defaults.\n');
    if (result.backupPath !== undefined) {
      process.stdout.write(`Invalid prior configuration preserved at ${result.backupPath}\n`);
    }
    return;
  }

  fail(`Unknown command.\n\n${HELP}`);
}

let invokedPath: string | undefined;
try {
  invokedPath = process.argv[1] === undefined
    ? undefined
    : realpathSync(path.resolve(process.argv[1]));
} catch {
  invokedPath = undefined;
}
if (invokedPath !== undefined && realpathSync(fileURLToPath(import.meta.url)) === invokedPath) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  });
}
