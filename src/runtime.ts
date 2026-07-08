import { lstat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { atomicWriteFile } from './atomic-file.js';
import { assertNoSymlinkComponents, resolveUserPath } from './paths.js';

export const FULL_ACCESS_WARNING = 'FULL COMPUTER ACCESS ENABLED — sharing the owner password or authorizing an untrusted client is equivalent to giving away this macOS account.';

export class RuntimeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeError';
  }
}

export class RuntimeEndpointError extends RuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeEndpointError';
  }
}

export class RuntimeStateError extends RuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeStateError';
  }
}

export interface RuntimeMcpReadinessServer {
  readonly origin: string;
  readonly mcpUrl: string;
  bindPublicEndpoint(resource: string): Promise<void>;
}

export type RuntimeTunnelMode = 'quick' | 'named';

export interface RuntimeCurrentState {
  schemaVersion: 1;
  phase: 'not-ready' | 'ready';
  localOrigin: string;
  localMcpUrl: string;
  publicOrigin: string | null;
  publicMcpUrl: string | null;
  resource: string | null;
  tunnelMode: RuntimeTunnelMode | null;
  connectorReady: boolean;
  productionEligible: boolean;
  updatedAt: string;
}

export interface RuntimeReadinessOptions {
  stateRoot: string;
  mcp: RuntimeMcpReadinessServer;
  now?: () => Date;
}

const runtimeCurrentStateSchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.enum(['not-ready', 'ready']),
  localOrigin: z.url(),
  localMcpUrl: z.url(),
  publicOrigin: z.url().nullable(),
  publicMcpUrl: z.url().nullable(),
  resource: z.url().nullable(),
  tunnelMode: z.enum(['quick', 'named']).nullable(),
  connectorReady: z.boolean(),
  productionEligible: z.boolean(),
  updatedAt: z.iso.datetime(),
}).strict();

function currentUserId(): number {
  if (process.getuid === undefined) {
    throw new RuntimeStateError('Runtime ownership checks require POSIX.');
  }
  return process.getuid();
}

function freezeState(state: RuntimeCurrentState): RuntimeCurrentState {
  return Object.freeze({ ...state });
}

export function validateLocalMcpEndpoint(
  originValue: string,
  endpointValue: string,
): { localOrigin: string; localMcpUrl: string } {
  let origin: URL;
  let endpoint: URL;
  try {
    origin = new URL(originValue);
    endpoint = new URL(endpointValue);
  } catch (error) {
    throw new RuntimeEndpointError('Local MCP listener returned an invalid URL.', {
      cause: error instanceof Error ? error : undefined,
    });
  }

  const loopback = origin.hostname === '127.0.0.1'
    || origin.hostname === 'localhost'
    || origin.hostname === '[::1]';
  if (origin.protocol !== 'http:'
    || !loopback
    || origin.port === ''
    || origin.pathname !== '/'
    || origin.search !== ''
    || origin.hash !== ''
    || origin.username !== ''
    || origin.password !== ''
    || originValue !== origin.origin) {
    throw new RuntimeEndpointError(
      'MCP listener must be a bare loopback HTTP origin with an explicit port.',
    );
  }

  const expectedEndpoint = `${origin.origin}/mcp`;
  if (endpoint.protocol !== 'http:'
    || endpoint.origin !== origin.origin
    || endpoint.pathname !== '/mcp'
    || endpoint.search !== ''
    || endpoint.hash !== ''
    || endpoint.username !== ''
    || endpoint.password !== ''
    || endpointValue !== expectedEndpoint) {
    throw new RuntimeEndpointError('Local MCP URL must be exactly the listener origin plus /mcp.');
  }

  return {
    localOrigin: origin.origin,
    localMcpUrl: expectedEndpoint,
  };
}

export function canonicalPublicEndpoint(publicOriginValue: string): {
  publicOrigin: string;
  publicMcpUrl: string;
} {
  let origin: URL;
  try {
    origin = new URL(publicOriginValue);
  } catch (error) {
    throw new RuntimeEndpointError('Public endpoint must be a valid HTTPS origin.', {
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (origin.protocol !== 'https:'
    || origin.port !== ''
    || origin.pathname !== '/'
    || origin.search !== ''
    || origin.hash !== ''
    || origin.username !== ''
    || origin.password !== ''
    || publicOriginValue !== origin.origin) {
    throw new RuntimeEndpointError(
      'Public endpoint must be a bare HTTPS origin without credentials, port, path, query, or fragment.',
    );
  }

  return {
    publicOrigin: origin.origin,
    publicMcpUrl: `${origin.origin}/mcp`,
  };
}

async function validateRuntimeCurrentTarget(
  stateRoot: string,
  state: RuntimeCurrentState,
): Promise<RuntimeCurrentState> {
  const parsed = runtimeCurrentStateSchema.safeParse(state);
  if (!parsed.success) {
    throw new RuntimeStateError(`Invalid runtime state: ${z.prettifyError(parsed.error)}`);
  }

  const runtimeDirectory = path.join(stateRoot, 'runtime');
  const currentPath = path.join(runtimeDirectory, 'current.json');
  try {
    await assertNoSymlinkComponents(runtimeDirectory);
    await assertNoSymlinkComponents(currentPath);
    const stats = await lstat(runtimeDirectory);
    if (stats.isSymbolicLink()
      || !stats.isDirectory()
      || stats.uid !== currentUserId()
      || (stats.mode & 0o777) !== 0o700) {
      throw new RuntimeStateError(
        `Runtime directory must be a private 0700 directory: ${runtimeDirectory}`,
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof RuntimeStateError) throw error;
    throw new RuntimeStateError(`Unable to validate runtime state target: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function writeRuntimeCurrent(
  stateRoot: string,
  state: RuntimeCurrentState,
): Promise<void> {
  const parsed = await validateRuntimeCurrentTarget(stateRoot, state);
  try {
    await atomicWriteFile(
      path.join(stateRoot, 'runtime', 'current.json'),
      `${JSON.stringify(parsed, null, 2)}\n`,
    );
  } catch (error) {
    throw new RuntimeStateError(`Unable to write runtime state: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export class RuntimeReadiness {
  private readonly stateRoot: string;
  private readonly mcp: RuntimeMcpReadinessServer;
  private readonly now: () => Date;
  private current: RuntimeCurrentState | undefined;

  constructor(options: RuntimeReadinessOptions) {
    this.stateRoot = resolveUserPath(options.stateRoot);
    this.mcp = options.mcp;
    this.now = options.now ?? (() => new Date());
  }

  get status(): RuntimeCurrentState | undefined {
    return this.current === undefined ? undefined : freezeState(this.current);
  }

  async persistNotReady(): Promise<RuntimeCurrentState> {
    const local = validateLocalMcpEndpoint(this.mcp.origin, this.mcp.mcpUrl);
    const state = freezeState({
      schemaVersion: 1,
      phase: 'not-ready',
      ...local,
      publicOrigin: null,
      publicMcpUrl: null,
      resource: null,
      tunnelMode: null,
      connectorReady: false,
      productionEligible: false,
      updatedAt: this.now().toISOString(),
    });
    await writeRuntimeCurrent(this.stateRoot, state);
    this.current = state;
    return freezeState(state);
  }

  async bindPublicOrigin(input: {
    publicOrigin: string;
    tunnelMode: RuntimeTunnelMode;
  }): Promise<RuntimeCurrentState> {
    const local = validateLocalMcpEndpoint(this.mcp.origin, this.mcp.mcpUrl);
    const publicEndpoint = canonicalPublicEndpoint(input.publicOrigin);
    const state = freezeState({
      schemaVersion: 1,
      phase: 'ready',
      ...local,
      ...publicEndpoint,
      resource: publicEndpoint.publicMcpUrl,
      tunnelMode: input.tunnelMode,
      connectorReady: true,
      productionEligible: input.tunnelMode === 'named',
      updatedAt: this.now().toISOString(),
    });
    await validateRuntimeCurrentTarget(this.stateRoot, state);
    await this.mcp.bindPublicEndpoint(publicEndpoint.publicMcpUrl);
    await writeRuntimeCurrent(this.stateRoot, state);
    this.current = state;
    return freezeState(state);
  }
}

export function formatRuntimeStatusBlock(state: RuntimeCurrentState): string {
  const tunnel = state.tunnelMode === 'quick'
    ? 'Quick'
    : state.tunnelMode === 'named'
      ? 'Named'
      : 'not connected';
  const production = state.productionEligible ? 'eligible' : 'no';
  return [
    `MCP: ${state.phase === 'ready' ? 'ready' : 'not ready'}`,
    `Local MCP: ${state.localMcpUrl}`,
    `Public MCP: ${state.publicMcpUrl ?? 'pending'}`,
    `Tunnel: ${tunnel}`,
    `Connector: ${state.connectorReady ? 'ready' : 'not ready'}`,
    `Production: ${production}`,
    FULL_ACCESS_WARNING,
  ].join('\n');
}
