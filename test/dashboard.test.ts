import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import { LoomDashboardServer } from '../src/dashboard.js';

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  return setCookie.split(';', 1)[0]!;
}

function csrfFrom(html: string): string {
  const match = /<meta name="loom-csrf" content="([^"]+)">/.exec(html);
  assert.ok(match?.[1]);
  return match[1];
}

function rawStatus(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'GET',
      headers: { host },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode ?? 0));
    });
    request.once('error', reject);
    request.end();
  });
}

test('dashboard bootstrap lifetime is unaffected by wall-clock jumps', async (t) => {
  let wallClock = 1_000;
  t.mock.method(Date, 'now', () => wallClock);
  const server = new LoomDashboardServer({
    status: () => ({ phase: 'ready' }),
    actions: {
      rescanCatalog: async () => undefined,
      restartBrowser: async () => undefined,
      revealAuditFolder: async () => undefined,
      updateConfig: async () => undefined,
      rotateOwnerPassword: async () => ({ ownerPassword: 'unused-dashboard-password' }),
      revokeAllOAuth: async () => undefined,
      stopLoom: async () => undefined,
    },
  });
  await server.listen();
  t.after(() => server.close());

  const bootstrapUrl = server.createBootstrapUrl();
  wallClock += 365 * 24 * 60 * 60 * 1_000;
  const bootstrap = await fetch(bootstrapUrl, { redirect: 'manual' });
  assert.equal(bootstrap.status, 303);
});

test('dashboard bootstrap is loopback-only, single-use, strict-headered, session-bound, and CSRF protected', async (t) => {
  const actions: Array<[string, unknown]> = [];
  const server = new LoomDashboardServer({
    status: async () => ({
      phase: 'ready',
      ownerPassword: 'must-not-leak',
      nested: { accessToken: 'also-secret', publicEndpoint: 'https://loom.example/mcp' },
    }),
    actions: {
      rescanCatalog: async () => { actions.push(['rescan_catalog', null]); },
      restartBrowser: async () => { actions.push(['restart_browser', null]); },
      revealAuditFolder: async () => { actions.push(['reveal_audit_folder', null]); },
      updateConfig: async (input) => { actions.push(['update_config', input]); },
      rotateOwnerPassword: async () => ({ ownerPassword: 'unused-dashboard-password' }),
      revokeAllOAuth: async () => { actions.push(['revoke_all_oauth', null]); },
      stopLoom: async () => { actions.push(['stop_loom', null]); },
    },
  });
  await server.listen();
  t.after(() => server.close());

  const bootstrapUrl = server.createBootstrapUrl();
  const bootstrap = await fetch(bootstrapUrl, { redirect: 'manual' });
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.get('location'), '/dashboard');
  assert.equal(bootstrap.headers.get('x-frame-options'), 'DENY');
  assert.match(bootstrap.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(bootstrap.headers.get('cache-control'), 'no-store');
  const cookie = cookieFrom(bootstrap);
  assert.match(cookie, /^loom_dashboard_session=/);

  const replay = await fetch(bootstrapUrl, { redirect: 'manual' });
  assert.equal(replay.status, 403);

  const dashboard = await fetch(`${server.origin}/dashboard`, {
    headers: { cookie },
  });
  assert.equal(dashboard.status, 200);
  const html = await dashboard.text();
  const csrf = csrfFrom(html);
  assert.doesNotMatch(html, /must-not-leak|also-secret/);

  const status = await fetch(`${server.origin}/api/status`, { headers: { cookie } });
  assert.equal(status.status, 200);
  const statusBody = await status.json() as Record<string, unknown>;
  assert.equal(statusBody.phase, 'ready');
  assert.equal(statusBody.ownerPassword, '[REDACTED]');
  assert.deepEqual(statusBody.nested, {
    accessToken: '[REDACTED]',
    publicEndpoint: 'https://loom.example/mcp',
  });

  const noSession = await fetch(`${server.origin}/api/actions/rescan_catalog`, {
    method: 'POST',
    headers: { origin: server.origin, 'x-loom-csrf': csrf },
  });
  assert.equal(noSession.status, 401);

  const wrongOrigin = await fetch(`${server.origin}/api/actions/rescan_catalog`, {
    method: 'POST',
    headers: { cookie, origin: 'https://attacker.example', 'x-loom-csrf': csrf },
  });
  assert.equal(wrongOrigin.status, 403);

  const wrongCsrf = await fetch(`${server.origin}/api/actions/rescan_catalog`, {
    method: 'POST',
    headers: { cookie, origin: server.origin, 'x-loom-csrf': 'wrong' },
  });
  assert.equal(wrongCsrf.status, 403);

  const accepted = await fetch(`${server.origin}/api/actions/update_config`, {
    method: 'POST',
    headers: {
      cookie,
      origin: server.origin,
      'content-type': 'application/json',
      'x-loom-csrf': csrf,
    },
    body: JSON.stringify({ tunnel: { type: 'quick' }, extraRoots: ['/Users/example'] }),
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(actions, [[
    'update_config',
    { tunnel: { type: 'quick' }, extraRoots: ['/Users/example'] },
  ]]);
});

test('dashboard rotates the owner password only through the action response body', async (t) => {
  let rotations = 0;
  const server = new LoomDashboardServer({
    status: async () => ({ phase: 'ready', ownerPassword: 'must-not-leak' }),
    actions: {
      rescanCatalog: async () => undefined,
      restartBrowser: async () => undefined,
      revealAuditFolder: async () => undefined,
      updateConfig: async () => undefined,
      rotateOwnerPassword: async () => {
        rotations += 1;
        return { ownerPassword: 'rotated-owner-password' };
      },
      revokeAllOAuth: async () => undefined,
      stopLoom: async () => undefined,
    },
  });
  await server.listen();
  t.after(() => server.close());

  const bootstrap = await fetch(server.createBootstrapUrl(), { redirect: 'manual' });
  const cookie = cookieFrom(bootstrap);
  const dashboard = await fetch(`${server.origin}/dashboard`, { headers: { cookie } });
  const csrf = csrfFrom(await dashboard.text());

  const rotate = await fetch(`${server.origin}/api/actions/rotate_owner_password`, {
    method: 'POST',
    headers: {
      cookie,
      origin: server.origin,
      'content-type': 'application/json',
      'x-loom-csrf': csrf,
    },
    body: JSON.stringify({}),
  });
  assert.equal(rotate.status, 200);
  assert.deepEqual(await rotate.json(), {
    ok: true,
    ownerPassword: 'rotated-owner-password',
  });
  assert.equal(rotations, 1);

  const status = await fetch(`${server.origin}/api/status`, { headers: { cookie } });
  assert.equal(status.status, 200);
  const statusBody = await status.json() as Record<string, unknown>;
  assert.equal(statusBody.ownerPassword, '[REDACTED]');

  const missing = await fetch(`${server.origin}/api/owner-password`, { headers: { cookie } });
  assert.equal(missing.status, 404);
});

test('dashboard rejects incorrect Host and exposes only allowlisted actions', async (t) => {
  const server = new LoomDashboardServer({
    status: async () => ({ phase: 'ready' }),
    actions: {
      rescanCatalog: async () => undefined,
      restartBrowser: async () => undefined,
      revealAuditFolder: async () => undefined,
      updateConfig: async () => undefined,
      rotateOwnerPassword: async () => ({ ownerPassword: 'unused-dashboard-password' }),
      revokeAllOAuth: async () => undefined,
      stopLoom: async () => undefined,
    },
  });
  await server.listen();
  t.after(() => server.close());

  assert.equal(
    await rawStatus(`${server.origin}/api/status`, 'attacker.example'),
    403,
  );

  const bootstrap = await fetch(server.createBootstrapUrl(), { redirect: 'manual' });
  const cookie = cookieFrom(bootstrap);
  const dashboard = await fetch(`${server.origin}/dashboard`, { headers: { cookie } });
  const csrf = csrfFrom(await dashboard.text());
  const unknown = await fetch(`${server.origin}/api/actions/run_command`, {
    method: 'POST',
    headers: { cookie, origin: server.origin, 'x-loom-csrf': csrf },
  });
  assert.equal(unknown.status, 404);
});
