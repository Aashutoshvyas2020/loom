import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { Server as HttpServer } from 'node:http';

import express, { type NextFunction, type Request, type Response } from 'express';

import { DASHBOARD_BOOTSTRAP_NONCE_TTL_MS } from './limits.js';

export class DashboardError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DashboardError';
  }
}

export interface DashboardActions {
  rescanCatalog(): Promise<void>;
  restartBrowser(): Promise<void>;
  revealAuditFolder(): Promise<void>;
  updateConfig(input: unknown): Promise<void>;
  revokeAllOAuth(): Promise<void>;
  stopLoom(): Promise<void>;
}

export interface LoomDashboardServerOptions {
  status(): Promise<unknown> | unknown;
  actions: DashboardActions;
  now?: () => number;
  nonceTtlMs?: number;
  sessionTtlMs?: number;
}

interface Session {
  csrf: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_COOKIE = 'loom_dashboard_session';
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const MAX_SESSIONS = 8;
const sensitiveKey = /(?:password|passwd|secret|token|authorization|cookie|environment|\benv\b|command|content|output|typed|screenshot|page.?text|body|header)/i;
const MAX_REDACTION_DEPTH = 8;
const MAX_REDACTION_ITEMS = 100;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function secret(): string {
  return randomBytes(32).toString('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

function cookies(request: Request): Record<string, string> {
  const header = request.headers.cookie;
  if (header === undefined) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key !== '' && value !== '') {
      result[key] = value;
    }
  }
  return result;
}

function redact(value: unknown, key?: string, depth = 0, seen = new WeakSet<object>()): unknown {
  if (key !== undefined && sensitiveKey.test(key)) {
    return '[REDACTED]';
  }
  if (depth > MAX_REDACTION_DEPTH) {
    return '[REDACTED:DEPTH]';
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value !== 'object') {
    return '[UNSUPPORTED]';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (seen.has(value)) {
    return '[REDACTED:CIRCULAR]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_REDACTION_ITEMS).map((item) => redact(item, undefined, depth + 1, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_REDACTION_ITEMS)) {
    output[entryKey] = redact(entryValue, entryKey, depth + 1, seen);
  }
  return output;
}

function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response
    .set('Cache-Control', 'no-store')
    .set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
    .set('X-Frame-Options', 'DENY')
    .set('X-Content-Type-Options', 'nosniff')
    .set('Referrer-Policy', 'no-referrer')
    .set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

export class LoomDashboardServer {
  private readonly statusProvider: LoomDashboardServerOptions['status'];
  private readonly actions: DashboardActions;
  private readonly now: () => number;
  private readonly nonceTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly app = express();
  private readonly nonces = new Map<string, number>();
  private readonly sessions = new Map<string, Session>();
  private httpServer: HttpServer | undefined;
  private port: number | undefined;
  private expectedHost: string | undefined;
  private dashboardTemplate: string | undefined;
  private dashboardCss: string | undefined;
  private dashboardJs: string | undefined;

  constructor(options: LoomDashboardServerOptions) {
    this.statusProvider = options.status;
    this.actions = options.actions;
    this.now = options.now ?? Date.now;
    this.nonceTtlMs = options.nonceTtlMs ?? DASHBOARD_BOOTSTRAP_NONCE_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    if (!Number.isSafeInteger(this.nonceTtlMs) || this.nonceTtlMs <= 0) {
      throw new DashboardError('nonceTtlMs must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(this.sessionTtlMs) || this.sessionTtlMs <= 0) {
      throw new DashboardError('sessionTtlMs must be a positive safe integer.');
    }
    this.app.disable('x-powered-by');
    this.app.use(securityHeaders);
    this.app.use((request, response, next) => this.requireExpectedHost(request, response, next));
    this.app.use(express.json({ limit: '64kb', strict: true }));
    this.configureRoutes();
  }

  get origin(): string {
    if (this.port === undefined) {
      throw new DashboardError('Dashboard is not listening.');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  async listen(): Promise<void> {
    if (this.httpServer !== undefined) {
      throw new DashboardError('Dashboard is already listening.');
    }
    const [html, css, js] = await Promise.all([
      readFile(new URL('../../public/dashboard.html', import.meta.url), 'utf8'),
      readFile(new URL('../../public/dashboard.css', import.meta.url), 'utf8'),
      readFile(new URL('../../public/dashboard.js', import.meta.url), 'utf8'),
    ]);
    this.dashboardTemplate = html;
    this.dashboardCss = css;
    this.dashboardJs = js;
    this.httpServer = this.app.listen(0, '127.0.0.1');
    await once(this.httpServer, 'listening');
    const address = this.httpServer.address();
    if (address === null || typeof address === 'string') {
      throw new DashboardError('Dashboard did not receive a TCP port.');
    }
    this.port = address.port;
    this.expectedHost = `127.0.0.1:${address.port}`;
  }

  createBootstrapUrl(): string {
    this.requireListening();
    this.prune();
    const nonce = secret();
    this.nonces.set(digest(nonce), this.now() + this.nonceTtlMs);
    return `${this.origin}/?nonce=${encodeURIComponent(nonce)}`;
  }

  async close(): Promise<void> {
    const server = this.httpServer;
    this.httpServer = undefined;
    this.port = undefined;
    this.expectedHost = undefined;
    this.nonces.clear();
    this.sessions.clear();
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  }

  private configureRoutes(): void {
    this.app.get('/', (request, response) => {
      this.prune();
      const nonce = typeof request.query.nonce === 'string' ? request.query.nonce : '';
      const nonceHash = digest(nonce);
      const expiresAt = this.nonces.get(nonceHash);
      if (nonce === '' || expiresAt === undefined || expiresAt <= this.now()) {
        response.status(403).type('text').send('Invalid or expired dashboard bootstrap.');
        return;
      }
      this.nonces.delete(nonceHash);
      this.pruneSessionsForCapacity();
      const sessionId = secret();
      this.sessions.set(digest(sessionId), {
        csrf: secret(),
        createdAt: this.now(),
        expiresAt: this.now() + this.sessionTtlMs,
      });
      response
        .set('Set-Cookie', `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.sessionTtlMs / 1_000)}`)
        .redirect(303, '/dashboard');
    });

    this.app.get('/dashboard', (request, response) => {
      const session = this.requireSession(request, response);
      if (session === null) {
        return;
      }
      response.type('html').send(
        this.requireAsset(this.dashboardTemplate, 'dashboard HTML')
          .replace('{{LOOM_CSRF}}', session.csrf),
      );
    });

    this.app.get('/dashboard.css', (request, response) => {
      if (this.requireSession(request, response) === null) {
        return;
      }
      response.type('css').send(this.requireAsset(this.dashboardCss, 'dashboard CSS'));
    });

    this.app.get('/dashboard.js', (request, response) => {
      if (this.requireSession(request, response) === null) {
        return;
      }
      response.type('js').send(this.requireAsset(this.dashboardJs, 'dashboard JS'));
    });

    this.app.get('/api/status', async (request, response) => {
      if (this.requireSession(request, response) === null) {
        return;
      }
      try {
        response.json(redact(await this.statusProvider()));
      } catch {
        response.status(500).json({ error: 'Unable to read dashboard status.' });
      }
    });

    const actionNames = [
      'rescan_catalog',
      'restart_browser',
      'reveal_audit_folder',
      'update_config',
      'revoke_all_oauth',
      'stop_loom',
    ] as const;
    for (const actionName of actionNames) {
      this.app.post(`/api/actions/${actionName}`, async (request, response) => {
        const session = this.requireSession(request, response);
        if (session === null || !this.requireMutationBoundary(request, response, session)) {
          return;
        }
        try {
          switch (actionName) {
            case 'rescan_catalog':
              await this.actions.rescanCatalog();
              break;
            case 'restart_browser':
              await this.actions.restartBrowser();
              break;
            case 'reveal_audit_folder':
              await this.actions.revealAuditFolder();
              break;
            case 'update_config':
              await this.actions.updateConfig(request.body);
              break;
            case 'revoke_all_oauth':
              await this.actions.revokeAllOAuth();
              break;
            case 'stop_loom':
              await this.actions.stopLoom();
              break;
          }
          response.json({ ok: true });
        } catch {
          response.status(500).json({ error: 'Dashboard action failed.' });
        }
      });
    }

    this.app.use((_request, response) => {
      response.status(404).json({ error: 'Not found.' });
    });
  }

  private requireExpectedHost(request: Request, response: Response, next: NextFunction): void {
    if (this.expectedHost === undefined || request.headers.host !== this.expectedHost) {
      response.status(403).type('text').send('Invalid Host.');
      return;
    }
    next();
  }

  private requireSession(request: Request, response: Response): Session | null {
    this.prune();
    const sessionId = cookies(request)[SESSION_COOKIE];
    if (sessionId === undefined) {
      response.status(401).json({ error: 'Dashboard session required.' });
      return null;
    }
    const session = this.sessions.get(digest(sessionId));
    if (session === undefined || session.expiresAt <= this.now()) {
      response.status(401).json({ error: 'Dashboard session expired.' });
      return null;
    }
    return session;
  }

  private requireMutationBoundary(request: Request, response: Response, session: Session): boolean {
    if (request.headers.origin !== this.origin) {
      response.status(403).json({ error: 'Invalid Origin.' });
      return false;
    }
    const csrf = request.headers['x-loom-csrf'];
    if (typeof csrf !== 'string' || !safeEqual(csrf, session.csrf)) {
      response.status(403).json({ error: 'Invalid CSRF token.' });
      return false;
    }
    return true;
  }

  private prune(): void {
    const now = this.now();
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt <= now) {
        this.nonces.delete(nonce);
      }
    }
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private pruneSessionsForCapacity(): void {
    this.prune();
    while (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()]
        .sort((left, right) => left[1].createdAt - right[1].createdAt)[0];
      if (oldest === undefined) {
        break;
      }
      this.sessions.delete(oldest[0]);
    }
  }

  private requireListening(): void {
    if (this.httpServer === undefined || this.port === undefined || this.expectedHost === undefined) {
      throw new DashboardError('Dashboard is not listening.');
    }
  }

  private requireAsset(asset: string | undefined, label: string): string {
    if (asset === undefined) {
      throw new DashboardError(`${label} is unavailable.`);
    }
    return asset;
  }
}
