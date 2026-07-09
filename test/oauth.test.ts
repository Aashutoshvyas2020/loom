import assert from 'node:assert/strict';
import { randomBytes, scrypt } from 'node:crypto';
import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initializeState } from '../src/config.js';
import { AuthStore, OAuthError } from '../src/oauth.js';

async function scryptLegacy(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error !== null) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

async function tempStateRoot(): Promise<string> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-oauth-')));
  const stateRoot = path.join(parent, '.loom');
  await initializeState(stateRoot);
  return stateRoot;
}

async function configuredStore(now: () => Date) {
  const stateRoot = await tempStateRoot();
  const opened = await AuthStore.open(stateRoot, { now });
  assert.ok(opened.ownerPassword);
  await opened.store.bindEndpoint('https://loom.example.com/mcp');
  return { stateRoot, store: opened.store, ownerPassword: opened.ownerPassword };
}

async function registeredClient(store: AuthStore) {
  return store.registerClient({
    clientName: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/connector/oauth/callback'],
    scopes: ['loom:tools'],
  });
}

async function authorizedTokens(
  store: AuthStore,
  ownerPassword: string,
  client: Awaited<ReturnType<typeof registeredClient>>,
) {
  const verifier = 'v'.repeat(64);
  const challenge = AuthStore.pkceChallenge(verifier);
  const issued = await store.issueAuthorizationCode({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0]!,
    scopes: ['loom:tools'],
    resource: 'https://loom.example.com/mcp',
    ownerPassword,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
  });
  const tokens = await store.exchangeAuthorizationCode({
    code: issued.code,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri: client.redirectUris[0]!,
    resource: 'https://loom.example.com/mcp',
    codeVerifier: verifier,
  });
  return { issued, tokens, verifier };
}

test('owner password is created once, scrypt-verified, private, and persistent across reopen', async () => {
  const stateRoot = await tempStateRoot();
  const now = () => new Date('2026-07-08T07:00:00.000Z');

  const first = await AuthStore.open(stateRoot, { now });
  assert.ok(first.ownerPassword);
  assert.equal(await first.store.verifyOwnerPassword(first.ownerPassword), true);
  assert.equal(await first.store.verifyOwnerPassword('wrong-password'), false);
  assert.equal((await stat(path.join(stateRoot, 'auth.json'))).mode & 0o777, 0o600);

  const second = await AuthStore.open(stateRoot, { now });
  assert.equal(second.ownerPassword, null);
  assert.equal(await second.store.verifyOwnerPassword(first.ownerPassword), true);

  const raw = await readFile(path.join(stateRoot, 'auth.json'), 'utf8');
  assert.equal(raw.includes(first.ownerPassword), false);
  assert.match(raw, /"algorithm": "scrypt"/);
  const parsed = JSON.parse(raw) as {
    owner: { cost: number; blockSize: number; parallelization: number };
  };
  assert.deepEqual(parsed.owner, {
    ...parsed.owner,
    cost: 32_768,
    blockSize: 8,
    parallelization: 3,
  });
});

test('successful owner authorization upgrades a legacy scrypt hash in place', async () => {
  const stateRoot = await tempStateRoot();
  const now = () => new Date('2026-07-08T07:00:00.000Z');
  const first = await AuthStore.open(stateRoot, { now });
  assert.ok(first.ownerPassword);
  const authPath = path.join(stateRoot, 'auth.json');
  const state = JSON.parse(await readFile(authPath, 'utf8')) as Record<string, unknown> & {
    owner: Record<string, unknown>;
  };
  const salt = randomBytes(16);
  const legacyHash = await scryptLegacy(first.ownerPassword, salt);
  state.owner = {
    algorithm: 'scrypt',
    salt: salt.toString('base64'),
    hash: legacyHash.toString('base64'),
    keyLength: 32,
    cost: 16_384,
    blockSize: 8,
    parallelization: 1,
    createdAt: now().getTime(),
  };
  await writeFile(authPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  const reopened = await AuthStore.open(stateRoot, { now });
  await reopened.store.bindEndpoint('https://loom.example.com/mcp');
  const client = await registeredClient(reopened.store);
  await reopened.store.issueAuthorizationCode({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0]!,
    scopes: ['loom:tools'],
    resource: 'https://loom.example.com/mcp',
    ownerPassword: first.ownerPassword,
    codeChallenge: AuthStore.pkceChallenge('u'.repeat(64)),
    codeChallengeMethod: 'S256',
  });

  const upgraded = JSON.parse(await readFile(authPath, 'utf8')) as {
    owner: { cost: number; blockSize: number; parallelization: number };
  };
  assert.equal(upgraded.owner.cost, 32_768);
  assert.equal(upgraded.owner.blockSize, 8);
  assert.equal(upgraded.owner.parallelization, 3);
});

test('authorization code exchange issues endpoint-bound access and refresh tokens', async () => {
  const now = () => new Date('2026-07-08T07:00:00.000Z');
  const { store, ownerPassword } = await configuredStore(now);
  const client = await registeredClient(store);
  const { issued, tokens } = await authorizedTokens(store, ownerPassword!, client);

  assert.equal(issued.expiresIn, 300);
  assert.equal(tokens.tokenType, 'Bearer');
  assert.equal(tokens.expiresIn, 900);
  assert.equal(tokens.resource, 'https://loom.example.com/mcp');
  assert.deepEqual(tokens.scopes, ['loom:tools']);

  const principal = await store.validateAccessToken(tokens.accessToken, {
    resource: 'https://loom.example.com/mcp',
    requiredScopes: ['loom:tools'],
  });
  assert.equal(principal.clientId, client.clientId);
  assert.deepEqual(principal.scopes, ['loom:tools']);
});

test('refresh-token rotation preserves one absolute family expiration', async () => {
  let current = Date.parse('2026-07-08T07:00:00.000Z');
  const now = () => new Date(current);
  const { store, ownerPassword } = await configuredStore(now);
  const client = await registeredClient(store);
  const { tokens } = await authorizedTokens(store, ownerPassword!, client);

  current += 29 * 24 * 60 * 60 * 1_000;
  const rotated = await store.refreshAccessToken({
    refreshToken: tokens.refreshToken,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    resource: 'https://loom.example.com/mcp',
  });

  current += 2 * 24 * 60 * 60 * 1_000;
  await assert.rejects(store.refreshAccessToken({
    refreshToken: rotated.refreshToken,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    resource: 'https://loom.example.com/mcp',
  }), OAuthError);
});

test('codes are single-use and reject wrong verifier, redirect, resource, and client secret', async () => {
  const now = () => new Date('2026-07-08T07:00:00.000Z');
  const { store, ownerPassword } = await configuredStore(now);
  const client = await registeredClient(store);
  const verifier = 'a'.repeat(64);
  const issued = await store.issueAuthorizationCode({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0]!,
    scopes: ['loom:tools'],
    resource: 'https://loom.example.com/mcp',
    ownerPassword: ownerPassword!,
    codeChallenge: AuthStore.pkceChallenge(verifier),
    codeChallengeMethod: 'S256',
  });

  const base = {
    code: issued.code,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri: client.redirectUris[0]!,
    resource: 'https://loom.example.com/mcp',
    codeVerifier: verifier,
  };
  await assert.rejects(
    store.exchangeAuthorizationCode({ ...base, codeVerifier: 'b'.repeat(64) }),
    OAuthError,
  );
  await assert.rejects(
    store.exchangeAuthorizationCode({ ...base, redirectUri: 'https://evil.example/callback' }),
    OAuthError,
  );
  await assert.rejects(
    store.exchangeAuthorizationCode({ ...base, resource: 'https://other.example/mcp' }),
    OAuthError,
  );
  await assert.rejects(
    store.exchangeAuthorizationCode({ ...base, clientSecret: 'wrong' }),
    OAuthError,
  );

  const tokens = await store.exchangeAuthorizationCode(base);
  assert.ok(tokens.accessToken);
  await assert.rejects(store.exchangeAuthorizationCode(base), OAuthError);
});

test('refresh rotates both tokens, prevents replay, and cannot expand scopes or change resource', async () => {
  const now = () => new Date('2026-07-08T07:00:00.000Z');
  const { store, ownerPassword } = await configuredStore(now);
  const client = await registeredClient(store);
  const { tokens } = await authorizedTokens(store, ownerPassword!, client);

  const rotated = await store.refreshAccessToken({
    refreshToken: tokens.refreshToken,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    resource: 'https://loom.example.com/mcp',
    scopes: ['loom:tools'],
  });
  assert.notEqual(rotated.refreshToken, tokens.refreshToken);
  assert.notEqual(rotated.accessToken, tokens.accessToken);

  await assert.rejects(store.refreshAccessToken({
    refreshToken: tokens.refreshToken,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    resource: 'https://loom.example.com/mcp',
  }), OAuthError);
  await assert.rejects(store.refreshAccessToken({
    refreshToken: rotated.refreshToken,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    resource: 'https://other.example/mcp',
  }), OAuthError);
  await assert.rejects(store.refreshAccessToken({
    refreshToken: rotated.refreshToken,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    resource: 'https://loom.example.com/mcp',
    scopes: ['loom:tools', 'admin'],
  }), OAuthError);
});

test('expiry and revocation reject codes, access tokens, and refresh tokens', async () => {
  const clock = new Date('2026-07-08T07:00:00.000Z');
  const now = () => new Date(clock);
  const { store, ownerPassword } = await configuredStore(now);
  const client = await registeredClient(store);

  const verifier = 'c'.repeat(64);
  const code = await store.issueAuthorizationCode({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0]!,
    scopes: ['loom:tools'],
    resource: 'https://loom.example.com/mcp',
    ownerPassword: ownerPassword!,
    codeChallenge: AuthStore.pkceChallenge(verifier),
    codeChallengeMethod: 'S256',
  });
  clock.setTime(clock.getTime() + 301_000);
  await assert.rejects(store.exchangeAuthorizationCode({
    code: code.code,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri: client.redirectUris[0]!,
    resource: 'https://loom.example.com/mcp',
    codeVerifier: verifier,
  }), OAuthError);

  clock.setTime(new Date('2026-07-08T07:00:00.000Z').getTime());
  const { tokens } = await authorizedTokens(store, ownerPassword!, client);
  assert.equal(await store.revokeToken(tokens.accessToken), true);
  await assert.rejects(store.validateAccessToken(tokens.accessToken, {
    resource: 'https://loom.example.com/mcp',
  }), OAuthError);

  clock.setTime(clock.getTime() + 31 * 24 * 60 * 60 * 1_000);
  await assert.rejects(store.refreshAccessToken({
    refreshToken: tokens.refreshToken,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    resource: 'https://loom.example.com/mcp',
  }), OAuthError);
});

test('endpoint change invalidates clients and tokens without rotating owner password', async () => {
  const now = () => new Date('2026-07-08T07:00:00.000Z');
  const { store, ownerPassword } = await configuredStore(now);
  const client = await registeredClient(store);
  const { tokens } = await authorizedTokens(store, ownerPassword!, client);

  const unchanged = await store.bindEndpoint('https://loom.example.com/mcp');
  assert.equal(unchanged.changed, false);
  assert.equal(await store.verifyOwnerPassword(ownerPassword!), true);

  const changed = await store.bindEndpoint('https://new.example.com/mcp');
  assert.equal(changed.changed, true);
  assert.equal(changed.generation, unchanged.generation + 1);
  assert.equal(await store.verifyOwnerPassword(ownerPassword!), true);
  await assert.rejects(store.validateAccessToken(tokens.accessToken, {
    resource: 'https://new.example.com/mcp',
  }), OAuthError);
  await assert.rejects(store.issueAuthorizationCode({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0]!,
    scopes: ['loom:tools'],
    resource: 'https://new.example.com/mcp',
    ownerPassword: ownerPassword!,
    codeChallenge: AuthStore.pkceChallenge('d'.repeat(64)),
    codeChallengeMethod: 'S256',
  }), OAuthError);
});

test('owner reset changes only the credential, revokes OAuth state, and preserves endpoint binding', async () => {
  const now = () => new Date('2026-07-08T07:00:00.000Z');
  const { store, ownerPassword } = await configuredStore(now);
  const client = await registeredClient(store);
  const { tokens } = await authorizedTokens(store, ownerPassword!, client);

  const reset = await store.resetOwnerCredential();

  assert.notEqual(reset.ownerPassword, ownerPassword);
  assert.equal(await store.verifyOwnerPassword(ownerPassword!), false);
  assert.equal(await store.verifyOwnerPassword(reset.ownerPassword), true);
  assert.equal(store.resourceUri, 'https://loom.example.com/mcp');
  await assert.rejects(store.validateAccessToken(tokens.accessToken, {
    resource: 'https://loom.example.com/mcp',
  }), OAuthError);
});

test('metadata is exact for the bound MCP resource and secrets are hashed at rest', async () => {
  const now = () => new Date('2026-07-08T07:00:00.000Z');
  const { stateRoot, store, ownerPassword } = await configuredStore(now);
  const client = await registeredClient(store);
  const { issued, tokens } = await authorizedTokens(store, ownerPassword!, client);

  assert.deepEqual(store.protectedResourceMetadata(), {
    resource: 'https://loom.example.com/mcp',
    authorization_servers: ['https://loom.example.com'],
    scopes_supported: ['loom:tools'],
  });
  assert.deepEqual(store.authorizationServerMetadata(), {
    issuer: 'https://loom.example.com',
    authorization_endpoint: 'https://loom.example.com/oauth/authorize',
    token_endpoint: 'https://loom.example.com/oauth/token',
    registration_endpoint: 'https://loom.example.com/oauth/register',
    revocation_endpoint: 'https://loom.example.com/oauth/revoke',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['loom:tools'],
  });

  const raw = await readFile(path.join(stateRoot, 'auth.json'), 'utf8');
  for (const secret of [
    ownerPassword!,
    client.clientSecret,
    issued.code,
    tokens.accessToken,
    tokens.refreshToken,
  ]) {
    assert.equal(raw.includes(secret), false);
  }
});

test('revokeAllOAuth preserves owner credential and endpoint while invalidating OAuth state', async () => {
  const root = await tempStateRoot();
  const opened = await AuthStore.open(root);
  assert.ok(opened.ownerPassword);
  await opened.store.bindEndpoint('https://loom.example.com/mcp');
  const client = await opened.store.registerClient({
    clientName: 'revoke-all-test',
    redirectUris: ['https://client.example/callback'],
    scopes: ['loom:tools'],
  });
  const { tokens } = await authorizedTokens(opened.store, opened.ownerPassword, client);
  const beforeGeneration = opened.store.generation;
  const revoked = await opened.store.revokeAllOAuth();
  assert.equal(revoked.generation, beforeGeneration + 1);
  assert.equal(revoked.resource, 'https://loom.example.com/mcp');
  assert.equal(opened.store.resourceUri, 'https://loom.example.com/mcp');
  assert.equal(await opened.store.verifyOwnerPassword(opened.ownerPassword), true);
  await assert.rejects(opened.store.validateAccessToken(tokens.accessToken, {
    resource: 'https://loom.example.com/mcp',
  }), OAuthError);
  const replacement = await opened.store.registerClient({
    clientName: 'replacement',
    redirectUris: client.redirectUris,
    scopes: ['loom:tools'],
  });
  assert.equal(replacement.redirectUris[0], client.redirectUris[0]);
});
