import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { once } from 'node:events';

import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import { AuthStore, OAuthError } from './oauth.js';
import { registerLoomTools, type LoomToolDispatcher } from './tools/register.js';

export class McpHttpError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'McpHttpError';
  }
}

export interface LoomMcpHttpServerOptions {
  authStore: AuthStore;
  dispatcher: LoomToolDispatcher;
  maxSessions?: number;
  sessionIdleMs?: number;
}

interface SessionRecord {
  id: string;
  clientId: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivity: number;
  activeRequests: number;
  closing: boolean;
}

interface RequiredServerOptions {
  maxSessions: number;
  sessionIdleMs: number;
}

const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_SESSION_IDLE_MS = 15 * 60 * 1_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const PUBLIC_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
const AUTHORIZATION_METADATA_PATH = '/.well-known/oauth-authorization-server';
const OPENID_METADATA_PATH = '/.well-known/openid-configuration';
const MCP_PATH = '/mcp';

function bearerChallenge(
  response: Response,
  status: number,
  error: 'invalid_token' | 'insufficient_scope',
  description: string,
  metadataUrl: URL,
): void {
  const challenge = `Bearer error="${error}", error_description="${description}", scope="loom:tools", resource_metadata="${metadataUrl.href}"`;
  response
    .status(status)
    .set('WWW-Authenticate', challenge)
    .set('Cache-Control', 'no-store')
    .json({ error, error_description: description });
}

function jsonRpcError(
  response: Response,
  status: number,
  code: number,
  message: string,
): void {
  response.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OAuthError(`${field} is required.`, 'invalid_request');
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string')) {
    throw new OAuthError(`${field} must be a non-empty string array.`, 'invalid_client_metadata');
  }
  return value as string[];
}

function scopeList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new OAuthError('scope must be a space-delimited string.', 'invalid_scope');
  }
  return value.split(/\s+/).filter(Boolean);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function oauthStatus(error: OAuthError): number {
  switch (error.code) {
    case 'invalid_client':
      return 401;
    case 'access_denied':
      return 403;
    case 'temporarily_unavailable':
      return 503;
    default:
      return 400;
  }
}

function oauthFailure(response: Response, error: unknown): void {
  if (error instanceof OAuthError) {
    response.status(oauthStatus(error)).json({
      error: error.code,
      error_description: error.message,
    });
    return;
  }
  response.status(500).json({
    error: 'server_error',
    error_description: 'Internal Server Error',
  });
}

function setAuthorizationSecurityHeaders(response: Response): Response {
  return response
    .set('Cache-Control', 'no-store')
    .set(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    )
    .set('X-Frame-Options', 'DENY')
    .set('X-Content-Type-Options', 'nosniff')
    .set('Referrer-Policy', 'no-referrer');
}

function authorizationForm(transactionId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Authorize Loom</title>
</head>
<body>
<main>
<h1>Authorize Loom</h1>
<p>This client is requesting full access to the Loom tools enabled on this Mac.</p>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="transaction_id" value="${escapeHtml(transactionId)}">
<label>Owner password <input type="password" name="owner_password" autocomplete="current-password" required></label>
<button type="submit">Authorize</button>
</form>
</main>
</body>
</html>`;
}

function tokenResponse(tokens: Awaited<ReturnType<AuthStore['exchangeAuthorizationCode']>>): Record<string, unknown> {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: tokens.tokenType,
    expires_in: tokens.expiresIn,
    scope: tokens.scopes.join(' '),
    resource: tokens.resource,
  };
}

export class LoomMcpHttpServer {
  private readonly authStore: AuthStore;
  private readonly dispatcher: LoomToolDispatcher;
  private readonly options: RequiredServerOptions;
  private readonly app = createMcpExpressApp({ host: '127.0.0.1' });
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly reaper: NodeJS.Timeout;
  private httpServer: HttpServer | undefined;
  private port: number | undefined;
  private publicResource: string | undefined;
  private bearerMiddleware: RequestHandler | undefined;
  private pendingInitializations = 0;
  private closing = false;

  constructor(options: LoomMcpHttpServerOptions) {
    const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    const sessionIdleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS;
    if (!Number.isSafeInteger(maxSessions) || maxSessions <= 0) {
      throw new McpHttpError('maxSessions must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(sessionIdleMs) || sessionIdleMs <= 0) {
      throw new McpHttpError('sessionIdleMs must be a positive safe integer.');
    }

    this.authStore = options.authStore;
    this.dispatcher = options.dispatcher;
    this.options = { maxSessions, sessionIdleMs };
    this.configureRoutes();

    const reaperInterval = Math.max(10, Math.min(1_000, Math.floor(sessionIdleMs / 2)));
    this.reaper = setInterval(() => {
      void this.reapInactiveSessions();
    }, reaperInterval);
    this.reaper.unref();
  }

  get origin(): string {
    if (this.port === undefined) {
      throw new McpHttpError('MCP HTTP server is not listening.');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  get mcpUrl(): string {
    return `${this.origin}${MCP_PATH}`;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  async listen(): Promise<void> {
    if (this.httpServer !== undefined) {
      throw new McpHttpError('MCP HTTP server is already listening.');
    }
    this.httpServer = this.app.listen(0, '127.0.0.1');
    await once(this.httpServer, 'listening');
    const address = this.httpServer.address();
    if (address === null || typeof address === 'string') {
      throw new McpHttpError('MCP HTTP server did not receive a TCP port.');
    }
    this.port = address.port;
  }

  async bindPublicEndpoint(resource: string): Promise<void> {
    const binding = await this.authStore.bindEndpoint(resource);
    if (binding.changed) {
      await this.closeAllSessions();
    }
    this.publicResource = binding.resource;
    const metadataUrl = new URL(
      getOAuthProtectedResourceMetadataUrl(new URL(binding.resource)),
    );
    this.bearerMiddleware = async (request, response, next) => {
      const authorization = request.headers.authorization;
      if (authorization === undefined) {
        bearerChallenge(
          response,
          401,
          'invalid_token',
          'Missing Authorization header',
          metadataUrl,
        );
        return;
      }
      const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
      if (match === null) {
        bearerChallenge(
          response,
          401,
          'invalid_token',
          'Invalid Authorization header format',
          metadataUrl,
        );
        return;
      }

      try {
        const token = match[1]!;
        const principal = await this.authStore.validateAccessToken(token, {
          resource: binding.resource,
          requiredScopes: ['loom:tools'],
        });
        (request as Request & { auth?: Record<string, unknown> }).auth = {
          token,
          clientId: principal.clientId,
          scopes: principal.scopes,
          expiresAt: Math.floor(principal.expiresAt / 1_000),
          resource: new URL(principal.resource),
          extra: { generation: principal.generation },
        };
        next();
      } catch (error) {
        const insufficient = error instanceof OAuthError && error.code === 'insufficient_scope';
        bearerChallenge(
          response,
          insufficient ? 403 : 401,
          insufficient ? 'insufficient_scope' : 'invalid_token',
          insufficient ? 'Insufficient scope' : 'Invalid or expired access token',
          metadataUrl,
        );
      }
    };
  }

  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    clearInterval(this.reaper);
    await this.closeAllSessions();

    const server = this.httpServer;
    this.httpServer = undefined;
    this.port = undefined;
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    }
  }

  private configureRoutes(): void {
    this.app.use(express.urlencoded({ extended: false, limit: '64kb' }));

    this.app.get(PUBLIC_RESOURCE_METADATA_PATH, (request, response) => {
      if (!this.requireReady(response)) {
        return;
      }
      response.set('Cache-Control', 'no-store').json(this.authStore.protectedResourceMetadata());
    });

    const authorizationMetadata = (_request: Request, response: Response) => {
      if (!this.requireReady(response)) {
        return;
      }
      response.set('Cache-Control', 'no-store').json(this.authStore.authorizationServerMetadata());
    };
    this.app.get(AUTHORIZATION_METADATA_PATH, authorizationMetadata);
    this.app.get(OPENID_METADATA_PATH, authorizationMetadata);

    this.app.post('/oauth/register', async (request, response) => {
      if (!this.requireReady(response)) {
        return;
      }
      try {
        const body = request.body as Record<string, unknown>;
        if (body.token_endpoint_auth_method !== undefined
          && body.token_endpoint_auth_method !== 'client_secret_post') {
          throw new OAuthError(
            'Only client_secret_post is supported.',
            'invalid_client_metadata',
          );
        }
        if (body.grant_types !== undefined) {
          const grants = stringArray(body.grant_types, 'grant_types');
          if (grants.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token')) {
            throw new OAuthError('Unsupported grant_types.', 'invalid_client_metadata');
          }
        }
        if (body.response_types !== undefined) {
          const responses = stringArray(body.response_types, 'response_types');
          if (responses.length !== 1 || responses[0] !== 'code') {
            throw new OAuthError('Only response_type code is supported.', 'invalid_client_metadata');
          }
        }

        const clientName = optionalString(body.client_name);
        const scopes = scopeList(body.scope);
        const registered = await this.authStore.registerClient({
          redirectUris: stringArray(body.redirect_uris, 'redirect_uris'),
          ...(clientName === undefined ? {} : { clientName }),
          ...(scopes === undefined ? {} : { scopes }),
        });
        response.status(201).json({
          client_id: registered.clientId,
          client_secret: registered.clientSecret,
          client_name: registered.clientName,
          redirect_uris: registered.redirectUris,
          scope: registered.scopes.join(' '),
          token_endpoint_auth_method: 'client_secret_post',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          client_id_issued_at: Math.floor(Date.now() / 1_000),
          client_secret_expires_at: 0,
        });
      } catch (error) {
        oauthFailure(response, error);
      }
    });

    this.app.get('/oauth/authorize', async (request, response) => {
      if (!this.requireReady(response)) {
        return;
      }
      setAuthorizationSecurityHeaders(response);
      try {
        const query = request.query as Record<string, unknown>;
        if (query.response_type !== 'code') {
          throw new OAuthError('Only response_type=code is supported.', 'unsupported_response_type');
        }
        if (query.code_challenge_method !== 'S256') {
          throw new OAuthError('S256 PKCE is required.', 'invalid_request');
        }
        const state = optionalString(query.state);
        const transaction = await this.authStore.createAuthorizationTransaction({
          clientId: requiredString(query.client_id, 'client_id'),
          redirectUri: requiredString(query.redirect_uri, 'redirect_uri'),
          scopes: scopeList(query.scope) ?? ['loom:tools'],
          resource: requiredString(query.resource, 'resource'),
          ...(state === undefined ? {} : { state }),
          codeChallenge: requiredString(query.code_challenge, 'code_challenge'),
          codeChallengeMethod: 'S256',
        });
        response.type('html').send(authorizationForm(transaction.transactionId));
      } catch (error) {
        oauthFailure(response, error);
      }
    });

    this.app.post('/oauth/authorize', async (request, response) => {
      if (!this.requireReady(response)) {
        return;
      }
      setAuthorizationSecurityHeaders(response);
      try {
        const body = request.body as Record<string, unknown>;
        const issued = await this.authStore.consumeAuthorizationTransaction({
          transactionId: requiredString(body.transaction_id, 'transaction_id'),
          ownerPassword: requiredString(body.owner_password, 'owner_password'),
        });
        const location = new URL(issued.redirectUri);
        location.searchParams.set('code', issued.code);
        if (issued.state !== null) {
          location.searchParams.set('state', issued.state);
        }
        response.redirect(302, location.toString());
      } catch (error) {
        oauthFailure(response, error);
      }
    });

    this.app.post('/oauth/token', async (request, response) => {
      if (!this.requireReady(response)) {
        return;
      }
      try {
        const body = request.body as Record<string, unknown>;
        const grantType = requiredString(body.grant_type, 'grant_type');
        if (grantType === 'authorization_code') {
          const tokens = await this.authStore.exchangeAuthorizationCode({
            code: requiredString(body.code, 'code'),
            clientId: requiredString(body.client_id, 'client_id'),
            clientSecret: requiredString(body.client_secret, 'client_secret'),
            redirectUri: requiredString(body.redirect_uri, 'redirect_uri'),
            resource: requiredString(body.resource, 'resource'),
            codeVerifier: requiredString(body.code_verifier, 'code_verifier'),
          });
          response.set('Cache-Control', 'no-store').json(tokenResponse(tokens));
          return;
        }
        if (grantType === 'refresh_token') {
          const scopes = scopeList(body.scope);
          const tokens = await this.authStore.refreshAccessToken({
            refreshToken: requiredString(body.refresh_token, 'refresh_token'),
            clientId: requiredString(body.client_id, 'client_id'),
            clientSecret: requiredString(body.client_secret, 'client_secret'),
            resource: requiredString(body.resource, 'resource'),
            ...(scopes === undefined ? {} : { scopes }),
          });
          response.set('Cache-Control', 'no-store').json(tokenResponse(tokens));
          return;
        }
        throw new OAuthError(`Unsupported grant_type: ${grantType}`, 'unsupported_grant_type');
      } catch (error) {
        oauthFailure(response, error);
      }
    });

    this.app.post('/oauth/revoke', async (request, response) => {
      if (!this.requireReady(response)) {
        return;
      }
      try {
        const body = request.body as Record<string, unknown>;
        await this.authStore.revokeClientToken({
          token: requiredString(body.token, 'token'),
          clientId: requiredString(body.client_id, 'client_id'),
          clientSecret: requiredString(body.client_secret, 'client_secret'),
        });
        response.status(200).end();
      } catch (error) {
        oauthFailure(response, error);
      }
    });

    const readiness: RequestHandler = (_request, response, next) => {
      if (this.requireReady(response)) {
        next();
      }
    };
    const authentication: RequestHandler = (request, response, next) => {
      const middleware = this.bearerMiddleware;
      if (middleware === undefined) {
        jsonRpcError(
          response,
          503,
          -32001,
          'NOT_READY: public endpoint OAuth binding is incomplete',
        );
        return;
      }
      middleware(request, response, next);
    };

    this.app.post(MCP_PATH, readiness, authentication, (request, response) => {
      void this.handleMcpPost(request, response);
    });
    this.app.get(MCP_PATH, readiness, authentication, (request, response) => {
      void this.handleExistingSession(request, response);
    });
    this.app.delete(MCP_PATH, readiness, authentication, (request, response) => {
      void this.handleExistingSession(request, response, true);
    });
    this.app.all(MCP_PATH, (_request, response) => {
      jsonRpcError(response, 405, -32005, 'Method not allowed');
    });
  }

  private requireReady(response: Response): boolean {
    if (this.publicResource !== undefined) {
      return true;
    }
    jsonRpcError(
      response,
      503,
      -32001,
      'NOT_READY: public endpoint OAuth binding is incomplete',
    );
    return false;
  }

  private async handleMcpPost(request: Request, response: Response): Promise<void> {
    try {
      const sessionHeader = request.headers['mcp-session-id'];
      if (sessionHeader !== undefined) {
        await this.handleExistingSession(request, response);
        return;
      }

      if (!isInitializeRequest(request.body)) {
        jsonRpcError(response, 400, -32000, 'Missing Mcp-Session-Id for non-initialization request');
        return;
      }
      if (this.sessions.size + this.pendingInitializations >= this.options.maxSessions) {
        jsonRpcError(response, 503, -32004, 'MCP session capacity reached');
        return;
      }
      this.pendingInitializations += 1;

      const clientId = this.requestClientId(request);
      const mcpServer = new McpServer(
        { name: 'loom', version: '0.1.0' },
        { capabilities: { tools: {} } },
      );
      registerLoomTools(mcpServer, this.dispatcher);

      let sessionId: string | undefined;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (initializedId) => {
          sessionId = initializedId;
          this.sessions.set(initializedId, {
            id: initializedId,
            clientId,
            transport,
            server: mcpServer,
            lastActivity: Date.now(),
            activeRequests: 1,
            closing: false,
          });
        },
        onsessionclosed: (closedId) => {
          void this.closeSession(closedId);
        },
      });
      transport.onclose = () => {
        if (sessionId !== undefined) {
          void this.closeSession(sessionId);
        }
      };

      await mcpServer.connect(transport as unknown as Transport);
      try {
        await transport.handleRequest(request, response, request.body);
        if (sessionId !== undefined) {
          const record = this.sessions.get(sessionId);
          if (record !== undefined) {
            record.lastActivity = Date.now();
          }
        }
      } catch (error) {
        if (sessionId !== undefined) {
          await this.closeSession(sessionId);
        } else {
          await Promise.allSettled([transport.close(), mcpServer.close()]);
        }
        throw error;
      } finally {
        this.pendingInitializations -= 1;
        if (sessionId !== undefined) {
          const record = this.sessions.get(sessionId);
          if (record !== undefined) {
            record.activeRequests = Math.max(0, record.activeRequests - 1);
            record.lastActivity = Date.now();
          }
        }
      }
    } catch (error) {
      if (!response.headersSent) {
        jsonRpcError(response, 500, -32603, 'Internal MCP server error');
      }
    }
  }

  private async handleExistingSession(
    request: Request,
    response: Response,
    forceClose = false,
  ): Promise<void> {
    try {
      const sessionId = this.parseSessionId(request.headers['mcp-session-id']);
      if (sessionId === null) {
        jsonRpcError(response, 400, -32000, 'Mcp-Session-Id is required');
        return;
      }
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        jsonRpcError(response, 400, -32002, 'Invalid Mcp-Session-Id format');
        return;
      }
      const record = this.sessions.get(sessionId);
      if (record === undefined) {
        jsonRpcError(response, 404, -32001, 'Unknown or expired MCP session');
        return;
      }
      if (record.clientId !== this.requestClientId(request)) {
        jsonRpcError(response, 403, -32003, 'MCP session belongs to another OAuth client');
        return;
      }

      record.lastActivity = Date.now();
      record.activeRequests += 1;
      try {
        await record.transport.handleRequest(request, response, request.body);
      } finally {
        const current = this.sessions.get(sessionId);
        if (current !== undefined) {
          current.activeRequests = Math.max(0, current.activeRequests - 1);
          current.lastActivity = Date.now();
        }
      }
      if (forceClose && this.sessions.has(sessionId)) {
        await this.closeSession(sessionId);
      }
    } catch (error) {
      if (!response.headersSent) {
        jsonRpcError(response, 500, -32603, 'Internal MCP server error');
      }
    }
  }

  private requestClientId(request: Request): string {
    const auth = (request as Request & { auth?: { clientId?: unknown } }).auth;
    if (auth === undefined || typeof auth.clientId !== 'string' || auth.clientId.length === 0) {
      throw new McpHttpError('Authenticated MCP request is missing client identity.');
    }
    return auth.clientId;
  }

  private parseSessionId(header: string | string[] | undefined): string | null {
    if (header === undefined) {
      return null;
    }
    return Array.isArray(header) ? header.join(',') : header;
  }

  private async reapInactiveSessions(): Promise<void> {
    const cutoff = Date.now() - this.options.sessionIdleMs;
    const stale = [...this.sessions.values()]
      .filter((record) => record.activeRequests === 0 && record.lastActivity <= cutoff)
      .map((record) => record.id);
    await Promise.all(stale.map((sessionId) => this.closeSession(sessionId)));
  }

  private async closeSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (record === undefined || record.closing) {
      return;
    }
    record.closing = true;
    this.sessions.delete(sessionId);
    await Promise.allSettled([
      record.transport.close(),
      record.server.close(),
    ]);
  }

  private async closeAllSessions(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.closeSession(sessionId)));
  }
}
