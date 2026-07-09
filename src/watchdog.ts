import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';

import { WATCHDOG_COMMAND_TIMEOUT_MS } from './limits.js';

const execFileAsync = promisify(execFile);
const WATCHDOG_ENVIRONMENT = Object.freeze({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'C',
  LC_ALL: 'C',
});

export class WatchdogError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WatchdogError';
  }
}

export interface ProcessTableEntry {
  pid: number;
  ppid: number;
  pgid: number;
  startTime: number;
}

export interface ProcessObservation extends ProcessTableEntry {
  executablePath: string;
}

export interface WatchdogCommandOptions {
  maxBuffer: number;
  timeoutMs?: number;
}

export async function runWatchdogCommand(
  executable: string,
  args: string[],
  options: WatchdogCommandOptions,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? WATCHDOG_COMMAND_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new WatchdogError('Watchdog command timeout must be a positive safe integer.');
  }
  const { stdout } = await execFileAsync(executable, args, {
    encoding: 'utf8',
    maxBuffer: options.maxBuffer,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: WATCHDOG_ENVIRONMENT,
  });
  return stdout;
}

function parseProcessLine(line: string): ProcessTableEntry {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 8) {
    throw new WatchdogError(`Unexpected macOS ps output: ${line}`);
  }

  const pid = Number(fields[0]);
  const ppid = Number(fields[1]);
  const pgid = Number(fields[2]);
  const startText = fields.slice(3, 8).join(' ');
  const startTime = Date.parse(startText);

  if (![pid, ppid, pgid, startTime].every(Number.isFinite)) {
    throw new WatchdogError(`Invalid macOS ps process fields: ${line}`);
  }

  return { pid, ppid, pgid, startTime };
}

async function readExecutablePath(pid: number): Promise<string> {
  try {
    const stdout = await runWatchdogCommand(
      '/usr/sbin/lsof',
      ['-a', '-p', String(pid), '-d', 'txt', '-Fn'],
      { maxBuffer: 1024 * 1024 },
    );
    const lines = stdout.split(/\r?\n/);
    const textIndex = lines.indexOf('ftxt');
    const executableLine = textIndex >= 0
      ? lines.slice(textIndex + 1).find((line) => line.startsWith('n'))
      : undefined;
    if (executableLine === undefined || executableLine.length < 2) {
      throw new WatchdogError(`macOS lsof did not report an executable for PID ${pid}.`);
    }
    return await realpath(executableLine.slice(1));
  } catch (error) {
    if (error instanceof WatchdogError) {
      throw error;
    }
    throw new WatchdogError(`Unable to inspect executable for PID ${pid}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function readSingleProcess(pid: number): Promise<ProcessTableEntry | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new WatchdogError('PID must be a positive safe integer.');
  }

  try {
    const stdout = await runWatchdogCommand(
      '/bin/ps',
      ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,lstart='],
      { maxBuffer: 64 * 1024 },
    );
    const line = stdout.trim();
    return line.length === 0 ? null : parseProcessLine(line);
  } catch (error) {
    if ((error as NodeJS.ErrnoException & { code?: number }).code === 1) {
      return null;
    }
    throw new WatchdogError(`Unable to inspect PID ${pid}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export async function inspectProcess(pid: number): Promise<ProcessObservation | null> {
  const processEntry = await readSingleProcess(pid);
  if (processEntry === null) {
    return null;
  }

  try {
    return {
      ...processEntry,
      executablePath: await readExecutablePath(pid),
    };
  } catch (error) {
    if (await readSingleProcess(pid) === null) {
      return null;
    }
    throw error;
  }
}

export async function listProcessGroupMembers(pgid: number): Promise<ProcessTableEntry[]> {
  if (!Number.isSafeInteger(pgid) || pgid <= 0) {
    throw new WatchdogError('Process-group ID must be a positive safe integer.');
  }

  try {
    const stdout = await runWatchdogCommand(
      '/bin/ps',
      ['-axo', 'pid=,ppid=,pgid=,lstart='],
      { maxBuffer: 8 * 1024 * 1024 },
    );

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseProcessLine)
      .filter((entry) => entry.pgid === pgid);
  } catch (error) {
    if (error instanceof WatchdogError) {
      throw error;
    }
    throw new WatchdogError(`Unable to scan process group ${pgid}: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export function observableIdentityMatches(
  expected: Pick<ProcessObservation, 'pid' | 'startTime' | 'executablePath'>,
  observed: Pick<ProcessObservation, 'pid' | 'startTime' | 'executablePath'>,
): boolean {
  return expected.pid === observed.pid
    && expected.startTime === observed.startTime
    && expected.executablePath === observed.executablePath;
}
