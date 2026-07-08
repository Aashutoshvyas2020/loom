import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { chmod, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { atomicWriteFile } from './atomic-file.js';
import { initializeState } from './config.js';
import { assertNoSymlinkComponents, resolveUserPath } from './paths.js';

export class OAuthError extends Error {
  readonly code: string;

  constructor(message: string, code = 'invalid_request', options?: ErrorOptions) {
    super(message, options);
    this.name = 'OAuthError';
    this.code = code;
  }
}

export interface AuthStoreOptions {
  now?: () => Date;
}

export interface OpenAuthStoreResult {
  store: AuthStore;
  ownerPassword: string | null;
}

export interface RegisterClientInput {
  clientName?: string;
  redirectUris: string[];
  scopes?: string[];
}

export interface RegisteredClient {
  clientId: string;
  clientSecret: string;
  clientName: string | null;
  redirectUris: string[];
  scopes: string[];
}

export interface IssueAuthorizationCodeInput {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  resource: string;
  ownerPassword: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export interface IssuedAuthorizationCode {
  code: string;
  expiresIn: number;
}

export interface ExchangeAuthorizationCodeInput {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  resource: string;
  codeVerifier: string;
}

export interface RefreshAccessTokenInput {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  resource: string;
  scopes?: string[];
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scopes: string[];
  resource: string;
}

export interface AccessTokenPrincipal {
  clientId: string;
  scopes: string[];
  resource: string;
  expiresAt: number;
  generation: number;
}

export interface ValidateAccessTokenOptions {
  resource: string;
  requiredScopes?: string[];
}

export interface EndpointBindingResult {
  changed: boolean;
  generation: number;
  resource: string;
}

export interface ResetOwnerCredentialResult {
  ownerPassword: string;
  generation: number;
}

export interface RevokeClientTokenInput {
  token: string;
  clientId: string;
  clientSecret: string;
}

const ownerSchema = z.object({
  algorithm: z.literal('scrypt'),
  salt: z.string().min(1),
  hash: z.string().min(1),
  keyLength: z.number().int().positive(),
  cost: z.number().int().positive(),
  blockSize: z.number().int().positive(),
  parallelization: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
}).strict();

const clientSchema = z.object({
  clientName: z.string().nullable(),
  secretHash: z.string().regex(/^[a-f0-9]{64}$/),
  redirectUris: z.array(z.string()).min(1),
  scopes: z.array(z.string()).min(1),
  resource: z.string().url(),
  generation: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
}).strict();

const authorizationCodeSchema = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()).min(1),
  resource: z.string().url(),
  generation: z.number().int().nonnegative(),
  codeChallenge: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
}).strict();

const tokenSchema = z.object({
  clientId: z.string().min(1),
  scopes: z.array(z.string()).min(1),
  resource: z.string().url(),
  generation: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
}).strict();

const authStateSchema = z.object({
  version: z.literal(1),
  installationId: z.string().min(1),
  owner: ownerSchema,
  endpoint: z.object({
    resourceUri: z.string().url().nullable(),
    generation: z.number().int().nonnegative(),
  }).strict(),
  clients: z.record(z.string(), clientSchema),
  authorizationCodes: z.record(z.string(), authorizationCodeSchema),
  accessTokens: z.record(z.string(), tokenSchema),
  refreshTokens: z.record(z.string(), tokenSchema),
  pendingTransactions: z.record(z.string(), z.unknown()),
}).strict();

type AuthState = z.infer<typeof authStateSchema>;
type ClientRecord = z.infer<typeof clientSchema>;
type AuthorizationCodeRecord = z.infer<typeof authorizationCodeSchema>;
type TokenRecord = z.infer<typeof tokenSchema>;

const OWNER_KEY_LENGTH = 32;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const CODE_TTL_SECONDS = 300;
const ACCESS_TTL_SECONDS = 900;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const ALLOWED_SCOPES = ['loom:tools'] as const;
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve(derivedKey as Buffer);
      }
    });
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function currentUserId(): number {
  if (process.getuid === undefined) {
    throw new OAuthError('OAuth state ownership checks require a POSIX user ID.', 'server_error');
  }
  return process.getuid();
}

function canonicalResource(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new OAuthError('OAuth resource must be a valid URL.', 'invalid_target', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if (url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || !url.pathname.endsWith('/mcp')
    || url.pathname.endsWith('/mcp/')) {
    throw new OAuthError('OAuth resource must be the exact public HTTPS MCP URL ending in /mcp.', 'invalid_target');
  }
  return url.toString();
}

function canonicalRedirectUri(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new OAuthError('redirect_uri must be a valid URL.', 'invalid_redirect_uri', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const localHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if ((url.protocol !== 'https:' && !localHttp)
    || url.username !== ''
    || url.password !== ''
    || url.hash !== '') {
    throw new OAuthError('redirect_uri must use HTTPS or loopback HTTP and must not contain credentials or a fragment.', 'invalid_redirect_uri');
  }
  return url.toString();
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  const requested = scopes ?? [...ALLOWED_SCOPES];
  if (requested.length === 0) {
    throw new OAuthError('At least one OAuth scope is required.', 'invalid_scope');
  }
  const unique = [...new Set(requested)].sort();
  for (const scope of unique) {
    if (!ALLOWED_SCOPES.includes(scope as (typeof ALLOWED_SCOPES)[number])) {
      throw new OAuthError(`Unsupported OAuth scope: ${scope}`, 'invalid_scope');
    }
  }
  return unique;
}

function scopesAreSubset(requested: string[], allowed: string[]): boolean {
  const allowedSet = new Set(allowed);
  return requested.every((scope) => allowedSet.has(scope));
}

function safeHashEquals(expectedHex: string, value: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(sha256(value), 'hex');
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}

async function deriveOwner(password: string, createdAt: number): Promise<AuthState['owner']> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, OWNER_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return {
    algorithm: 'scrypt',
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    keyLength: OWNER_KEY_LENGTH,
    cost: SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
    createdAt,
  };
}

async function verifyOwner(owner: AuthState['owner'], password: string): Promise<boolean> {
  try {
    const expected = Buffer.from(owner.hash, 'base64');
    const actual = await scryptAsync(password, Buffer.from(owner.salt, 'base64'), owner.keyLength, {
      N: owner.cost,
      r: owner.blockSize,
      p: owner.parallelization,
    });
    return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function serializeState(state: AuthState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function parseState(raw: Buffer, authPath: string): AuthState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new OAuthError(`Invalid JSON in ${authPath}.`, 'server_error', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const result = authStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new OAuthError(`Invalid OAuth state in ${authPath}: ${z.prettifyError(result.error)}`, 'server_error');
  }
  return result.data;
}

function clearOAuthState(state: AuthState): void {
  state.clients = {};
  state.authorizationCodes = {};
  state.accessTokens = {};
  state.refreshTokens = {};
  state.pendingTransactions = {};
}

export class AuthStore {
  private state: AuthState;
  private fileHash: string;
  private readonly authPath: string;
  private readonly now: () => Date;
  private operationChain: Promise<void> = Promise.resolve();

  private constructor(authPath: string, state: AuthState, fileHash: string, now: () => Date) {
    this.authPath = authPath;
    this.state = state;
    this.fileHash = fileHash;
    this.now = now;
  }

  static async open(inputStateRoot: string, options: AuthStoreOptions = {}): Promise<OpenAuthStoreResult> {
    const stateRoot = resolveUserPath(inputStateRoot);
    await initializeState(stateRoot);
    const authPath = path.join(stateRoot, 'auth.json');
    const now = options.now ?? (() => new Date());

    try {
      await assertNoSymlinkComponents(authPath);
      const stats = await lstat(authPath);
      if (stats.isSymbolicLink() || !stats.isFile() || stats.uid !== currentUserId()) {
        throw new OAuthError(`Unsafe OAuth state file: ${authPath}`, 'server_error');
      }
      if ((stats.mode & 0o777) !== 0o600) {
        await chmod(authPath, 0o600);
      }
      const raw = await readFile(authPath);
      const state = parseState(raw, authPath);
      return {
        store: new AuthStore(authPath, state, sha256(raw), now),
        ownerPassword: null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const ownerPassword = randomSecret(32);
    const createdAt = now().getTime();
    const state: AuthState = {
      version: 1,
      installationId: randomSecret(24),
      owner: await deriveOwner(ownerPassword, createdAt),
      endpoint: { resourceUri: null, generation: 0 },
      clients: {},
      authorizationCodes: {},
      accessTokens: {},
      refreshTokens: {},
      pendingTransactions: {},
    };
    const written = await atomicWriteFile(authPath, serializeState(state));
    return {
      store: new AuthStore(authPath, state, written.sha256, now),
      ownerPassword,
    };
  }

  static pkceChallenge(verifier: string): string {
    if (!PKCE_VERIFIER.test(verifier)) {
      throw new OAuthError('PKCE verifier must contain 43-128 unreserved characters.', 'invalid_grant');
    }
    return createHash('sha256').update(verifier).digest('base64url');
  }

  get resourceUri(): string | null {
    return this.state.endpoint.resourceUri;
  }

  get generation(): number {
    return this.state.endpoint.generation;
  }

  verifyOwnerPassword(password: string): Promise<boolean> {
    return this.exclusive(() => verifyOwner(this.state.owner, password));
  }

  bindEndpoint(inputResource: string): Promise<EndpointBindingResult> {
    const resource = canonicalResource(inputResource);
    return this.exclusive(async () => {
      if (this.state.endpoint.resourceUri === resource) {
        return {
          changed: false,
          generation: this.state.endpoint.generation,
          resource,
        };
      }
      return this.mutate(async (state) => {
        state.endpoint.resourceUri = resource;
        state.endpoint.generation += 1;
        clearOAuthState(state);
        return {
          changed: true,
          generation: state.endpoint.generation,
          resource,
        };
      });
    });
  }

  registerClient(input: RegisterClientInput): Promise<RegisteredClient> {
    return this.exclusive(() => this.mutate(async (state) => {
      const resource = this.requireBoundResource(state);
      if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0) {
        throw new OAuthError('At least one redirect_uri is required.', 'invalid_client_metadata');
      }
      const redirectUris = [...new Set(input.redirectUris.map(canonicalRedirectUri))];
      const scopes = normalizeScopes(input.scopes);
      const clientId = `loom_${randomSecret(18)}`;
      const clientSecret = randomSecret(32);
      const clientName = input.clientName?.trim().slice(0, 128) || null;
      state.clients[clientId] = {
        clientName,
        secretHash: sha256(clientSecret),
        redirectUris,
        scopes,
        resource,
        generation: state.endpoint.generation,
        createdAt: this.now().getTime(),
      };
      return { clientId, clientSecret, clientName, redirectUris, scopes };
    }));
  }

  issueAuthorizationCode(input: IssueAuthorizationCodeInput): Promise<IssuedAuthorizationCode> {
    return this.exclusive(async () => {
      if (!await verifyOwner(this.state.owner, input.ownerPassword)) {
        throw new OAuthError('Owner password is invalid.', 'access_denied');
      }
      return this.mutate(async (state) => {
        const resource = this.requireExactResource(state, input.resource);
        const client = this.requireCurrentClient(state, input.clientId);
        const redirectUri = canonicalRedirectUri(input.redirectUri);
        if (!client.redirectUris.includes(redirectUri)) {
          throw new OAuthError('redirect_uri does not match the registered client.', 'invalid_redirect_uri');
        }
        const scopes = normalizeScopes(input.scopes);
        if (!scopesAreSubset(scopes, client.scopes)) {
          throw new OAuthError('Requested scopes exceed the client registration.', 'invalid_scope');
        }
        if (input.codeChallengeMethod !== 'S256' || !PKCE_CHALLENGE.test(input.codeChallenge)) {
          throw new OAuthError('S256 PKCE is required.', 'invalid_request');
        }

        const code = randomSecret(32);
        const createdAt = this.now().getTime();
        state.authorizationCodes[sha256(code)] = {
          clientId: input.clientId,
          redirectUri,
          scopes,
          resource,
          generation: state.endpoint.generation,
          codeChallenge: input.codeChallenge,
          expiresAt: createdAt + CODE_TTL_SECONDS * 1_000,
          createdAt,
        };
        return { code, expiresIn: CODE_TTL_SECONDS };
      });
    });
  }

  exchangeAuthorizationCode(input: ExchangeAuthorizationCodeInput): Promise<OAuthTokenResponse> {
    return this.exclusive(() => this.mutate(async (state) => {
      const resource = this.requireExactResource(state, input.resource);
      this.requireClientSecret(state, input.clientId, input.clientSecret);
      const codeHash = sha256(input.code);
      const code = state.authorizationCodes[codeHash];
      if (code === undefined) {
        throw new OAuthError('Authorization code is invalid or has already been used.', 'invalid_grant');
      }
      this.validateCodeRecord(state, code, input.clientId, input.redirectUri, resource, input.codeVerifier);
      delete state.authorizationCodes[codeHash];
      return this.issueTokens(state, code.clientId, code.scopes, resource);
    }));
  }

  refreshAccessToken(input: RefreshAccessTokenInput): Promise<OAuthTokenResponse> {
    return this.exclusive(() => this.mutate(async (state) => {
      const resource = this.requireExactResource(state, input.resource);
      this.requireClientSecret(state, input.clientId, input.clientSecret);
      const refreshHash = sha256(input.refreshToken);
      const refresh = state.refreshTokens[refreshHash];
      if (refresh === undefined) {
        throw new OAuthError('Refresh token is invalid or has already been used.', 'invalid_grant');
      }
      this.validateTokenRecord(state, refresh, resource);
      if (refresh.clientId !== input.clientId) {
        throw new OAuthError('Refresh token is bound to another client.', 'invalid_grant');
      }
      const scopes = input.scopes === undefined ? refresh.scopes : normalizeScopes(input.scopes);
      if (!scopesAreSubset(scopes, refresh.scopes)) {
        throw new OAuthError('Refresh cannot expand scopes.', 'invalid_scope');
      }

      delete state.refreshTokens[refreshHash];
      return this.issueTokens(state, refresh.clientId, scopes, resource);
    }));
  }

  validateAccessToken(token: string, options: ValidateAccessTokenOptions): Promise<AccessTokenPrincipal> {
    return this.exclusive(async () => {
      const resource = this.requireExactResource(this.state, options.resource);
      const record = this.state.accessTokens[sha256(token)];
      if (record === undefined) {
        throw new OAuthError('Access token is invalid or revoked.', 'invalid_token');
      }
      this.validateTokenRecord(this.state, record, resource);
      const required = options.requiredScopes === undefined
        ? []
        : normalizeScopes(options.requiredScopes);
      if (!scopesAreSubset(required, record.scopes)) {
        throw new OAuthError('Access token lacks required scope.', 'insufficient_scope');
      }
      return {
        clientId: record.clientId,
        scopes: [...record.scopes],
        resource: record.resource,
        expiresAt: record.expiresAt,
        generation: record.generation,
      };
    });
  }

  revokeToken(token: string): Promise<boolean> {
    return this.exclusive(async () => {
      const tokenHash = sha256(token);
      if (this.state.accessTokens[tokenHash] === undefined
        && this.state.refreshTokens[tokenHash] === undefined) {
        return false;
      }
      return this.mutate(async (state) => {
        delete state.accessTokens[tokenHash];
        delete state.refreshTokens[tokenHash];
        return true;
      });
    });
  }

  revokeClientToken(input: RevokeClientTokenInput): Promise<boolean> {
    return this.exclusive(async () => {
      this.requireClientSecret(this.state, input.clientId, input.clientSecret);
      const tokenHash = sha256(input.token);
      const access = this.state.accessTokens[tokenHash];
      const refresh = this.state.refreshTokens[tokenHash];
      const record = access ?? refresh;
      if (record === undefined || record.clientId !== input.clientId) {
        return false;
      }
      return this.mutate(async (state) => {
        delete state.accessTokens[tokenHash];
        delete state.refreshTokens[tokenHash];
        return true;
      });
    });
  }

  resetOwnerCredential(): Promise<ResetOwnerCredentialResult> {
    return this.exclusive(async () => {
      const ownerPassword = randomSecret(32);
      const owner = await deriveOwner(ownerPassword, this.now().getTime());
      return this.mutate(async (state) => {
        state.owner = owner;
        state.endpoint.generation += 1;
        clearOAuthState(state);
        return { ownerPassword, generation: state.endpoint.generation };
      });
    });
  }

  protectedResourceMetadata(): Record<string, unknown> {
    const resource = this.requireBoundResource(this.state);
    const issuer = new URL(resource).origin;
    return {
      resource,
      authorization_servers: [issuer],
      scopes_supported: [...ALLOWED_SCOPES],
    };
  }

  authorizationServerMetadata(): Record<string, unknown> {
    const resource = this.requireBoundResource(this.state);
    const issuer = new URL(resource).origin;
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      scopes_supported: [...ALLOWED_SCOPES],
    };
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationChain.then(operation, operation);
    this.operationChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async mutate<T>(operation: (state: AuthState) => Promise<T>): Promise<T> {
    const previousState = structuredClone(this.state);
    const previousHash = this.fileHash;
    try {
      const result = await operation(this.state);
      const written = await atomicWriteFile(this.authPath, serializeState(this.state), {
        expectedSha256: this.fileHash,
      });
      this.fileHash = written.sha256;
      return result;
    } catch (error) {
      this.state = previousState;
      this.fileHash = previousHash;
      throw error;
    }
  }

  private requireBoundResource(state: AuthState): string {
    if (state.endpoint.resourceUri === null) {
      throw new OAuthError('OAuth endpoint is not bound to a public MCP resource.', 'temporarily_unavailable');
    }
    return state.endpoint.resourceUri;
  }

  private requireExactResource(state: AuthState, input: string): string {
    const expected = this.requireBoundResource(state);
    const actual = canonicalResource(input);
    if (actual !== expected) {
      throw new OAuthError('OAuth resource/audience does not match the active MCP endpoint.', 'invalid_target');
    }
    return expected;
  }

  private requireCurrentClient(state: AuthState, clientId: string): ClientRecord {
    const client = state.clients[clientId];
    const resource = this.requireBoundResource(state);
    if (client === undefined
      || client.generation !== state.endpoint.generation
      || client.resource !== resource) {
      throw new OAuthError('OAuth client is unknown or stale.', 'invalid_client');
    }
    return client;
  }

  private requireClientSecret(state: AuthState, clientId: string, clientSecret: string): ClientRecord {
    const client = this.requireCurrentClient(state, clientId);
    if (!safeHashEquals(client.secretHash, clientSecret)) {
      throw new OAuthError('OAuth client authentication failed.', 'invalid_client');
    }
    return client;
  }

  private validateCodeRecord(
    state: AuthState,
    code: AuthorizationCodeRecord,
    clientId: string,
    inputRedirectUri: string,
    resource: string,
    verifier: string,
  ): void {
    if (code.expiresAt <= this.now().getTime()) {
      throw new OAuthError('Authorization code expired.', 'invalid_grant');
    }
    if (code.clientId !== clientId
      || code.generation !== state.endpoint.generation
      || code.resource !== resource) {
      throw new OAuthError('Authorization code binding is invalid.', 'invalid_grant');
    }
    if (code.redirectUri !== canonicalRedirectUri(inputRedirectUri)) {
      throw new OAuthError('Authorization code redirect_uri mismatch.', 'invalid_grant');
    }
    if (AuthStore.pkceChallenge(verifier) !== code.codeChallenge) {
      throw new OAuthError('PKCE verification failed.', 'invalid_grant');
    }
  }

  private validateTokenRecord(state: AuthState, record: TokenRecord, resource: string): void {
    if (record.expiresAt <= this.now().getTime()) {
      throw new OAuthError('OAuth token expired.', 'invalid_token');
    }
    if (record.generation !== state.endpoint.generation || record.resource !== resource) {
      throw new OAuthError('OAuth token is stale for the active endpoint.', 'invalid_token');
    }
    this.requireCurrentClient(state, record.clientId);
  }

  private issueTokens(
    state: AuthState,
    clientId: string,
    scopes: string[],
    resource: string,
  ): OAuthTokenResponse {
    const accessToken = randomSecret(32);
    const refreshToken = randomSecret(48);
    const createdAt = this.now().getTime();
    const common = {
      clientId,
      scopes: [...scopes],
      resource,
      generation: state.endpoint.generation,
      createdAt,
    };
    state.accessTokens[sha256(accessToken)] = {
      ...common,
      expiresAt: createdAt + ACCESS_TTL_SECONDS * 1_000,
    };
    state.refreshTokens[sha256(refreshToken)] = {
      ...common,
      expiresAt: createdAt + REFRESH_TTL_SECONDS * 1_000,
    };
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TTL_SECONDS,
      scopes: [...scopes],
      resource,
    };
  }
}
