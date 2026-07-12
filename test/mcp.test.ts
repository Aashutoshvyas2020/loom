import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { initializeState } from '../src/config.js';
import { LoomMcpHttpServer } from '../src/mcp.js';
import { AuthStore } from '../src/oauth.js';
import { LOOM_TOOL_NAMES } from '../src/tools/register.js';

async function tempStateRoot(): Promise<string> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-mcp-')));
  const stateRoot = path.join(parent, '.loom');
  await initializeState(stateRoot);
  return stateRoot;
}

async function setupServer(options: {
  maxSessions?: number;
  sessionIdleMs?: number;
  maxRequestBytes?: number;
  authorizationAttemptLimit?: number;
  authorizationAttemptWindowMs?: number;
  monotonicNow?: () => number;
} = {}) {
  const stateRoot = await tempStateRoot();
  const opened = await AuthStore.open(stateRoot);
  assert.ok(opened.ownerPassword);
  const server = new LoomMcpHttpServer({
    authStore: opened.store,
    ...(options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions }),
    ...(options.sessionIdleMs === undefined ? {} : { sessionIdleMs: options.sessionIdleMs }),
    ...(options.maxRequestBytes === undefined ? {} : { maxRequestBytes: options.maxRequestBytes }),
    ...(options.authorizationAttemptLimit === undefined
      ? {}
      : { authorizationAttemptLimit: options.authorizationAttemptLimit }),
    ...(options.authorizationAttemptWindowMs === undefined
      ? {}
      : { authorizationAttemptWindowMs: options.authorizationAttemptWindowMs }),
    ...(options.monotonicNow === undefined ? {} : { monotonicNow: options.monotonicNow }),
    dispatcher: async (name, args) => ({
      content: [{ type: 'text', text: `${name}:${JSON.stringify(args)}` }],
    }),
  });
  await server.listen();
  return {
    stateRoot,
    authStore: opened.store,
    ownerPassword: opened.ownerPassword,
    server,
  };
}

async function issueTokens(
  authStore: AuthStore,
  ownerPassword: string,
  resource = 'https://loom.example.com/mcp',
) {
  const client = await authStore.registerClient({
    clientName: 'MCP test client',
    redirectUris: ['https://client.example/callback'],
    scopes: ['loom:tools'],
  });
  const verifier = 'v'.repeat(64);
  const issued = await authStore.issueAuthorizationCode({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0]!,
    scopes: ['loom:tools'],
    resource,
    ownerPassword,
    codeChallenge: AuthStore.pkceChallenge(verifier),
    codeChallengeMethod: 'S256',
  });
  const tokens = await authStore.exchangeAuthorizationCode({
    code: issued.code,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri: client.redirectUris[0]!,
    resource,
    codeVerifier: verifier,
  });
  return { client, tokens };
}

async function rawGetWithHost(url: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: 'GET', headers: { host } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    request.end();
  });
}

function initializeBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'raw-test-client', version: '1.0.0' },
    },
  };
}

test('MCP remains deterministically NOT_READY before public endpoint binding', async (t) => {
  const { server } = await setupServer();
  t.after(() => server.close());

  const response = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify(initializeBody()),
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('www-authenticate'), null);
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0',
    error: {
      code: -32001,
      message: 'NOT_READY: public endpoint OAuth binding is incomplete',
    },
    id: null,
  });
  assert.equal(server.sessionCount, 0);
});

test('MCP JSON parsing rejects oversized bodies before SDK or tool-schema handling', async (t) => {
  const { server } = await setupServer({ maxRequestBytes: 256 });
  t.after(() => server.close());
  await server.bindPublicEndpoint('https://loom.example.com/mcp');

  const response = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...initializeBody(), padding: 'x'.repeat(512) }),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0',
    error: { code: -32006, message: 'MCP request body exceeds 256 bytes' },
    id: null,
  });
  assert.equal(server.sessionCount, 0);
});

test('bound server publishes exact metadata and an unauthenticated MCP challenge', async (t) => {
  const { server } = await setupServer();
  t.after(() => server.close());
  await server.bindPublicEndpoint('https://loom.example.com/mcp');

  const protectedMetadata = await fetch(
    `${server.origin}/.well-known/oauth-protected-resource/mcp`,
  );
  assert.equal(protectedMetadata.status, 200);
  assert.deepEqual(await protectedMetadata.json(), {
    resource: 'https://loom.example.com/mcp',
    authorization_servers: ['https://loom.example.com'],
    scopes_supported: ['loom:tools'],
  });

  const authorizationMetadata = await fetch(
    `${server.origin}/.well-known/oauth-authorization-server`,
  );
  assert.equal(authorizationMetadata.status, 200);
  assert.deepEqual(await authorizationMetadata.json(), {
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

  const response = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify(initializeBody()),
  });
  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get('www-authenticate'),
    'Bearer error="invalid_token", error_description="Missing Authorization header", scope="loom:tools", resource_metadata="https://loom.example.com/.well-known/oauth-protected-resource/mcp"',
  );

});

test('public OAuth discovery accepts only the bound public hostname and loopback hosts', async (t) => {
  const { server } = await setupServer();
  t.after(() => server.close());
  await server.bindPublicEndpoint('https://loom.example.com/mcp');

  const publicHost = await rawGetWithHost(
    `${server.origin}/.well-known/oauth-protected-resource/mcp`,
    'loom.example.com',
  );
  assert.equal(publicHost.status, 200);
  assert.equal(
    (JSON.parse(publicHost.body) as { resource: string }).resource,
    'https://loom.example.com/mcp',
  );

  const rejectedHost = await rawGetWithHost(
    `${server.origin}/.well-known/oauth-protected-resource/mcp`,
    'attacker.example',
  );
  assert.equal(rejectedHost.status, 403);
});

test('owner-password authorization attempts are globally bounded by a monotonic window', async (t) => {
  let monotonic = 100;
  const { server, ownerPassword } = await setupServer({
    authorizationAttemptLimit: 2,
    authorizationAttemptWindowMs: 1_000,
    monotonicNow: () => monotonic,
  });
  t.after(() => server.close());
  const resource = 'https://loom.example.com/mcp';
  await server.bindPublicEndpoint(resource);
  const registration = await fetch(`${server.origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'rate-limit-test',
      redirect_uris: ['https://client.example/callback'],
      scope: 'loom:tools',
    }),
  }).then(async (response) => response.json() as Promise<{ client_id: string; redirect_uris: string[] }>);
  const verifier = 'r'.repeat(64);
  const authorizeUrl = new URL(`${server.origin}/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: registration.redirect_uris[0]!,
    scope: 'loom:tools',
    code_challenge: AuthStore.pkceChallenge(verifier),
    code_challenge_method: 'S256',
    resource,
  }).toString();
  const html = await fetch(authorizeUrl).then((response) => response.text());
  const transactionId = /name="transaction_id" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(transactionId);

  const attempt = (password: string) => fetch(`${server.origin}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ transaction_id: transactionId, owner_password: password }),
  });
  assert.equal((await attempt('wrong-one')).status, 403);
  assert.equal((await attempt('wrong-two')).status, 403);
  const limited = await attempt(ownerPassword);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');

  monotonic += 1_001;
  const accepted = await attempt(ownerPassword);
  assert.equal(accepted.status, 302);
});

test('standard HTTP OAuth registration, authorization, exchange, refresh, and revocation work', async (t) => {
  const { server, ownerPassword } = await setupServer();
  t.after(() => server.close());
  const resource = 'https://loom.example.com/mcp';
  await server.bindPublicEndpoint(resource);

  const registrationResponse = await fetch(`${server.origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'ChatGPT',
      redirect_uris: ['https://client.example/callback'],
      scope: 'loom:tools',
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json() as {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };

  const verifier = 'p'.repeat(64);
  const authorizeUrl = new URL(`${server.origin}/oauth/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: registration.redirect_uris[0]!,
    scope: 'loom:tools',
    state: 'state-123',
    code_challenge: AuthStore.pkceChallenge(verifier),
    code_challenge_method: 'S256',
    resource,
  }).toString();
  const authorizationPage = await fetch(authorizeUrl);
  assert.equal(authorizationPage.status, 200);
  assert.equal(authorizationPage.headers.get('x-frame-options'), 'DENY');
  assert.match(
    authorizationPage.headers.get('content-security-policy') ?? '',
    /frame-ancestors 'none'/,
  );
  assert.match(
    authorizationPage.headers.get('content-security-policy') ?? '',
    /form-action 'self' https:\/\/client\.example/,
  );
  const authorizationHtml = await authorizationPage.text();
  const transactionId = /name="transaction_id" value="([^"]+)"/.exec(authorizationHtml)?.[1];
  assert.ok(transactionId);
  assert.doesNotMatch(authorizationHtml, /name="client_id"/);
  assert.doesNotMatch(authorizationHtml, /name="redirect_uri"/);

  const authorizationResponse = await fetch(`${server.origin}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      transaction_id: transactionId,
      owner_password: ownerPassword,
      client_id: 'attacker-controlled-client',
      redirect_uri: 'https://attacker.example/callback',
      resource: 'https://attacker.example/mcp',
    }),
  });
  assert.equal(authorizationResponse.status, 302);
  const redirect = new URL(authorizationResponse.headers.get('location')!);
  assert.equal(redirect.origin + redirect.pathname, 'https://client.example/callback');
  assert.equal(redirect.searchParams.get('state'), 'state-123');
  const code = redirect.searchParams.get('code');
  assert.ok(code);

  const replayAuthorization = await fetch(`${server.origin}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      transaction_id: transactionId,
      owner_password: ownerPassword,
    }),
  });
  assert.equal(replayAuthorization.status, 400);
  assert.equal(
    (await replayAuthorization.json() as { error: string }).error,
    'invalid_request',
  );

  const tokenResponse = await fetch(`${server.origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: registration.client_id,
      client_secret: registration.client_secret,
      redirect_uri: registration.redirect_uris[0]!,
      code_verifier: verifier,
      resource,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  assert.equal(tokens.token_type, 'bearer');
  assert.equal(tokens.scope, 'loom:tools');
  assert.equal('resource' in tokens, false);

  const refreshResponse = await fetch(`${server.origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: registration.client_id,
      client_secret: registration.client_secret,
      resource,
      scope: 'loom:tools',
    }),
  });
  assert.equal(refreshResponse.status, 200);
  const refreshed = await refreshResponse.json() as {
    access_token: string;
    refresh_token: string;
  };
  assert.notEqual(refreshed.access_token, tokens.access_token);
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token);

  const replay = await fetch(`${server.origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: registration.client_id,
      client_secret: registration.client_secret,
      resource,
    }),
  });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json() as { error: string }).error, 'invalid_grant');

  const revoke = await fetch(`${server.origin}/oauth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: refreshed.access_token,
      client_id: registration.client_id,
      client_secret: registration.client_secret,
    }),
  });
  assert.equal(revoke.status, 200);

  const revokedMcp = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${refreshed.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(initializeBody()),
  });
  assert.equal(revokedMcp.status, 401);
});

test('dynamic registration supports DevSpace-compatible public clients without a secret', async (t) => {
  const { server, authStore, ownerPassword } = await setupServer();
  t.after(() => server.close());
  const resource = 'https://loom.example.com/mcp';
  await server.bindPublicEndpoint(resource);

  const registrationResponse = await fetch(`${server.origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'ChatGPT',
      redirect_uris: ['https://client.example/callback'],
      scope: 'loom:tools',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  assert.equal(registrationResponse.status, 201);
  const registration = await registrationResponse.json() as {
    client_id: string;
    client_secret?: string;
    redirect_uris: string[];
    token_endpoint_auth_method: string;
  };
  assert.equal(registration.token_endpoint_auth_method, 'none');
  assert.equal(registration.client_secret, undefined);

  const verifier = 'q'.repeat(64);
  const issued = await authStore.issueAuthorizationCode({
    clientId: registration.client_id,
    redirectUri: registration.redirect_uris[0]!,
    scopes: ['loom:tools'],
    resource,
    ownerPassword,
    codeChallenge: AuthStore.pkceChallenge(verifier),
    codeChallengeMethod: 'S256',
  });
  const tokenResponse = await fetch(`${server.origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: issued.code,
      client_id: registration.client_id,
      redirect_uri: registration.redirect_uris[0]!,
      code_verifier: verifier,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json() as { access_token: string; refresh_token: string };

  const refreshResponse = await fetch(`${server.origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: registration.client_id,
    }),
  });
  assert.equal(refreshResponse.status, 200);
  const refreshed = await refreshResponse.json() as { access_token: string };

  const revokeResponse = await fetch(`${server.origin}/oauth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: refreshed.access_token,
      client_id: registration.client_id,
    }),
  });
  assert.equal(revokeResponse.status, 200);
});

test('a real SDK client sees exactly seven Loom tools and can call the injected dispatcher', async (t) => {
  const { server, authStore, ownerPassword } = await setupServer();
  t.after(() => server.close());
  const resource = 'https://loom.example.com/mcp';
  await server.bindPublicEndpoint(resource);
  const { tokens } = await issueTokens(authStore, ownerPassword, resource);

  const transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
    requestInit: {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    },
  });
  const client = new Client(
    { name: 'loom-test-client', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport as unknown as Transport);

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [...LOOM_TOOL_NAMES].sort(),
  );
  assert.equal(listed.tools.length, 7);

  const called = await client.callTool({
    name: 'loom_read',
    arguments: { path: '/tmp/example.txt' },
  });
  assert.deepEqual(called.content, [{
    type: 'text',
    text: 'loom_read:{"path":"/tmp/example.txt"}',
  }]);
  assert.equal(server.sessionCount, 1);

  await transport.terminateSession();
  await client.close();
  assert.equal(server.sessionCount, 0);
});

test('same endpoint preserves sessions while an endpoint change closes sessions and invalidates tokens', async (t) => {
  const { server, authStore, ownerPassword } = await setupServer();
  t.after(() => server.close());
  const originalResource = 'https://loom.example.com/mcp';
  await server.bindPublicEndpoint(originalResource);
  const { tokens } = await issueTokens(authStore, ownerPassword, originalResource);
  const transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
    requestInit: { headers: { authorization: `Bearer ${tokens.accessToken}` } },
  });
  const client = new Client(
    { name: 'loom-endpoint-test', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport as unknown as Transport);
  assert.equal(server.sessionCount, 1);

  await server.bindPublicEndpoint(originalResource);
  assert.equal(server.sessionCount, 1);

  const changedResource = 'https://new.example.com/mcp';
  await server.bindPublicEndpoint(changedResource);
  assert.equal(server.sessionCount, 0);
  const metadata = await fetch(`${server.origin}/.well-known/oauth-protected-resource/mcp`);
  assert.equal((await metadata.json() as { resource: string }).resource, changedResource);

  const oldToken = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tokens.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(initializeBody()),
  });
  assert.equal(oldToken.status, 401);
  assert.match(
    oldToken.headers.get('www-authenticate') ?? '',
    /resource_metadata="https:\/\/new\.example\.com\/\.well-known\/oauth-protected-resource\/mcp"/,
  );
  await client.close();
});

test('session IDs are validated, client-bound, bounded, and reported with structured errors', async (t) => {
  const { server, authStore, ownerPassword } = await setupServer({ maxSessions: 1 });
  t.after(() => server.close());
  const resource = 'https://loom.example.com/mcp';
  await server.bindPublicEndpoint(resource);
  const first = await issueTokens(authStore, ownerPassword, resource);
  const second = await issueTokens(authStore, ownerPassword, resource);
  const baseHeaders = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };

  const initialized = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: { ...baseHeaders, authorization: `Bearer ${first.tokens.accessToken}` },
    body: JSON.stringify(initializeBody()),
  });
  assert.equal(initialized.status, 200);
  const sessionId = initialized.headers.get('mcp-session-id');
  assert.ok(sessionId);
  await initialized.text();

  const malformed = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      authorization: `Bearer ${first.tokens.accessToken}`,
      'mcp-session-id': '../bad',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json() as { error: { code: number } }).error.code, -32002);

  const wrongClient = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      authorization: `Bearer ${second.tokens.accessToken}`,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
  });
  assert.equal(wrongClient.status, 403);
  assert.equal((await wrongClient.json() as { error: { code: number } }).error.code, -32003);

  const overCapacity = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: { ...baseHeaders, authorization: `Bearer ${second.tokens.accessToken}` },
    body: JSON.stringify(initializeBody()),
  });
  assert.equal(overCapacity.status, 503);
  assert.equal((await overCapacity.json() as { error: { code: number } }).error.code, -32004);

  const terminated = await fetch(server.mcpUrl, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${first.tokens.accessToken}`,
      'mcp-session-id': sessionId,
    },
  });
  assert.equal(terminated.status >= 200 && terminated.status < 300, true);
  assert.equal(server.sessionCount, 0);
});

test('inactive sessions are closed and removed within the configured bound', async (t) => {
  const { server, authStore, ownerPassword } = await setupServer({ sessionIdleMs: 50 });
  t.after(() => server.close());
  const resource = 'https://loom.example.com/mcp';
  await server.bindPublicEndpoint(resource);
  const { tokens } = await issueTokens(authStore, ownerPassword, resource);

  const initialized = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tokens.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(initializeBody()),
  });
  assert.equal(initialized.status, 200);
  await initialized.text();
  assert.equal(server.sessionCount, 1);

  const deadline = Date.now() + 1_000;
  while (server.sessionCount > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(server.sessionCount, 0);
});
