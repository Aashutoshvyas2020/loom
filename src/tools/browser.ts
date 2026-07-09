import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { AuditLogger, type AuditReceipt } from '../audit.js';
import {
  type BrowserBackend,
  BrowserToolError,
  BrowserNotReadyError,
  BrowserTabNotFoundError,
} from '../browser.js';
import {
  MAX_BROWSER_SNAPSHOT_BYTES,
  MAX_SCREENSHOT_BYTES,
} from '../limits.js';
import type {
  LoomToolDispatcher,
  LoomToolName,
} from './register.js';

export type {
  BrowserBackend,
  BrowserTab,
  BrowserStatusResult,
  BrowserSnapshotResult,
  BrowserScreenshotResult,
  BrowserEvaluationResult,
} from '../browser.js';
export {
  BrowserToolError,
  BrowserNotReadyError,
  BrowserTabNotFoundError,
  BrowserExecutableError,
  BrowserEvaluationTimeoutError,
} from '../browser.js';

export interface BrowserToolServiceOptions {
  backend: BrowserBackend;
  audit: AuditLogger;
}

const TAB_ID_PATTERN = /^tab_[A-Za-z0-9_-]{22}$/;
const MAX_URL_LENGTH = 8_192;
const MAX_SELECTOR_LENGTH = 4_096;
const MAX_TYPED_TEXT_BYTES = 1024 * 1024;
const MAX_EXPRESSION_BYTES = 65_536;
const ALLOWED_PERMISSIONS = new Set([
  'geolocation',
  'notifications',
  'camera',
  'microphone',
  'clipboard-read',
  'clipboard-write',
]);

function validateSafeInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum) {
    throw new BrowserToolError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function validateTabId(value: unknown): string {
  if (typeof value !== 'string' || !TAB_ID_PATTERN.test(value)) {
    throw new BrowserToolError('tabId is malformed.');
  }
  return value;
}

function validateNavigationUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new BrowserToolError(`url must contain 1-${MAX_URL_LENGTH} characters.`);
  }
  if (value === 'about:blank') {
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new BrowserToolError('url must be a valid HTTP(S) URL or about:blank.', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== '') {
    throw new BrowserToolError('url must use HTTP(S) without embedded credentials.');
  }
  return url.toString();
}

function validateOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    throw new BrowserToolError('origin must be a bounded bare HTTP(S) origin.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new BrowserToolError('origin must be a valid bare HTTP(S) origin.', {
      cause: error instanceof Error ? error : undefined,
    });
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== ''
    || url.password !== ''
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== '') {
    throw new BrowserToolError('origin must be a bare HTTP(S) origin without path, query, fragment, or credentials.');
  }
  return url.origin;
}

function validateSelector(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_SELECTOR_LENGTH
    || value.includes('\u0000')) {
    throw new BrowserToolError(`selector must contain 1-${MAX_SELECTOR_LENGTH} NUL-free characters.`);
  }
  return value;
}

function validateTypedText(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\u0000')) {
    throw new BrowserToolError('text must be a NUL-free string.');
  }
  if (Buffer.byteLength(value) > MAX_TYPED_TEXT_BYTES) {
    throw new BrowserToolError(`text exceeds ${MAX_TYPED_TEXT_BYTES} bytes.`);
  }
  return value;
}

function validateExpression(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.includes('\u0000')
    || Buffer.byteLength(value) > MAX_EXPRESSION_BYTES) {
    throw new BrowserToolError(`expression must contain 1-${MAX_EXPRESSION_BYTES} NUL-free bytes.`);
  }
  return value;
}

function validatePermissions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new BrowserToolError('permissions must contain 1-32 supported permission names.');
  }
  const permissions = [...new Set(value.map((permission) => {
    if (typeof permission !== 'string' || !ALLOWED_PERMISSIONS.has(permission)) {
      throw new BrowserToolError(`Unsupported browser permission: ${String(permission)}`);
    }
    return permission;
  }))].sort();
  return permissions;
}

function validateCoordinate(
  value: unknown,
  name: 'latitude' | 'longitude',
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new BrowserToolError(`${name} must be a finite number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function validateAccuracy(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100_000) {
    throw new BrowserToolError('accuracy must be a finite number greater than 0 and at most 100000.');
  }
  return value;
}

function safeUrlMetadata(value: string): Record<string, unknown> {
  if (value === 'about:blank') {
    return { scheme: 'about', urlBytes: Buffer.byteLength(value) };
  }
  const url = new URL(value);
  return {
    origin: url.origin,
    urlBytes: Buffer.byteLength(value),
    pathBytes: Buffer.byteLength(url.pathname),
    hasQuery: url.search !== '',
    hasFragment: url.hash !== '',
  };
}

function toolResult(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

async function finishAudit(
  audit: AuditLogger,
  receipt: AuditReceipt,
  status: 'ok' | 'error',
): Promise<void> {
  await audit.recordFinish(receipt, status);
}

function wrapBrowserError(error: unknown, operation: string): never {
  if (error instanceof BrowserToolError) {
    throw error;
  }
  throw new BrowserToolError(`Browser ${operation} failed: ${String(error)}`, {
    cause: error instanceof Error ? error : undefined,
  });
}

function truncateUtf8(value: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= maxBytes) {
    return { text: value, bytes: bytes.byteLength, truncated: false };
  }
  let end = maxBytes;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  const text = bytes.subarray(0, end).toString('utf8');
  return { text, bytes: Buffer.byteLength(text), truncated: true };
}


export class BrowserToolService {
  private readonly backend: BrowserBackend;
  private readonly audit: AuditLogger;

  constructor(options: BrowserToolServiceOptions) {
    this.backend = options.backend;
    this.audit = options.audit;
  }

  async status(): Promise<CallToolResult> {
    try {
      const status = await this.backend.status();
      const metadata = {
        running: status.running,
        tabs: validateSafeInteger(status.tabs, 'backend tabs', 0, 10_000),
        version: status.version,
      };
      await this.audit.recordRead('browser.status', metadata);
      return toolResult(status.running ? 'Browser is running.' : 'Browser is stopped.', metadata);
    } catch (error) {
      wrapBrowserError(error, 'status');
    }
  }

  async tabs(): Promise<CallToolResult> {
    try {
      const tabs = await this.backend.tabs();
      for (const tab of tabs) {
        validateTabId(tab.id);
        if (typeof tab.url !== 'string' || typeof tab.title !== 'string') {
          throw new BrowserToolError('Backend returned an invalid tab summary.');
        }
      }
      await this.audit.recordRead('browser.tabs', { tabs: tabs.length });
      return toolResult(JSON.stringify(tabs, null, 2), { tabs });
    } catch (error) {
      wrapBrowserError(error, 'tabs');
    }
  }

  async open(input: { url?: string }): Promise<CallToolResult> {
    const url = input.url === undefined ? undefined : validateNavigationUrl(input.url);
    const receipt = await this.audit.recordMutationStart('browser.open', {
      ...(url === undefined ? { hasUrl: false } : { hasUrl: true, ...safeUrlMetadata(url) }),
    });
    try {
      const tab = await this.backend.open(url === undefined ? {} : { url });
      validateTabId(tab.id);
      await finishAudit(this.audit, receipt, 'ok');
      return toolResult(`Opened browser tab ${tab.id}.`, { ...tab });
    } catch (error) {
      await finishAudit(this.audit, receipt, 'error');
      wrapBrowserError(error, 'open');
    }
  }

  async navigate(input: { tabId: string; url: string }): Promise<CallToolResult> {
    const tabId = validateTabId(input.tabId);
    const url = validateNavigationUrl(input.url);
    const receipt = await this.audit.recordMutationStart('browser.navigate', {
      tabId,
      ...safeUrlMetadata(url),
    });
    try {
      const tab = await this.backend.navigate({ tabId, url });
      await finishAudit(this.audit, receipt, 'ok');
      return toolResult(`Navigated browser tab ${tabId}.`, { ...tab });
    } catch (error) {
      await finishAudit(this.audit, receipt, 'error');
      wrapBrowserError(error, 'navigate');
    }
  }

  async snapshot(input: { tabId: string; maxBytes?: number }): Promise<CallToolResult> {
    const tabId = validateTabId(input.tabId);
    const maxBytes = input.maxBytes === undefined
      ? MAX_BROWSER_SNAPSHOT_BYTES
      : validateSafeInteger(input.maxBytes, 'maxBytes', 1, MAX_BROWSER_SNAPSHOT_BYTES);
    try {
      const result = await this.backend.snapshot({ tabId, maxBytes });
      if (result.tabId !== tabId || Buffer.byteLength(result.text) !== result.bytes || result.bytes > maxBytes) {
        throw new BrowserToolError('Backend returned an invalid or oversized browser snapshot.');
      }
      const metadata = {
        tabId,
        titleBytes: Buffer.byteLength(result.title),
        urlBytes: Buffer.byteLength(result.url),
        bytes: result.bytes,
        truncated: result.truncated,
      };
      await this.audit.recordRead('browser.snapshot', metadata);
      return toolResult(result.text, metadata);
    } catch (error) {
      wrapBrowserError(error, 'snapshot');
    }
  }

  async click(input: { tabId: string; selector: string }): Promise<CallToolResult> {
    const tabId = validateTabId(input.tabId);
    const selector = validateSelector(input.selector);
    return this.mutation(
      'browser.click',
      { tabId, selectorBytes: Buffer.byteLength(selector) },
      async () => {
        const result = await this.backend.click({ tabId, selector });
        return toolResult(`Clicked in browser tab ${tabId}.`, {
          tabId,
          urlBytes: Buffer.byteLength(result.url),
        });
      },
    );
  }

  async type(input: {
    tabId: string;
    selector: string;
    text: string;
    submit?: boolean;
  }): Promise<CallToolResult> {
    const tabId = validateTabId(input.tabId);
    const selector = validateSelector(input.selector);
    const text = validateTypedText(input.text);
    const submit = input.submit ?? false;
    if (typeof submit !== 'boolean') {
      throw new BrowserToolError('submit must be boolean.');
    }
    return this.mutation(
      'browser.type',
      {
        tabId,
        selectorBytes: Buffer.byteLength(selector),
        textBytes: Buffer.byteLength(text),
        submit,
      },
      async () => {
        const result = await this.backend.type({ tabId, selector, text, submit });
        return toolResult(`Typed in browser tab ${tabId}.`, {
          tabId,
          urlBytes: Buffer.byteLength(result.url),
        });
      },
    );
  }

  async evaluate(input: { tabId: string; expression: string }): Promise<CallToolResult> {
    const tabId = validateTabId(input.tabId);
    const expression = validateExpression(input.expression);
    return this.mutation(
      'browser.evaluate',
      { tabId, expressionBytes: Buffer.byteLength(expression) },
      async () => {
        const result = await this.backend.evaluate({
          tabId,
          expression,
          maxBytes: MAX_BROWSER_SNAPSHOT_BYTES,
        });
        if (result.tabId !== tabId
          || Buffer.byteLength(result.json) !== result.bytes
          || result.bytes > MAX_BROWSER_SNAPSHOT_BYTES) {
          throw new BrowserToolError('Backend returned an invalid or oversized evaluation result.');
        }
        return toolResult(result.json, {
          tabId,
          bytes: result.bytes,
          urlBytes: Buffer.byteLength(result.url),
        });
      },
    );
  }

  async screenshot(input: {
    tabId: string;
    fullPage?: boolean;
    maxBytes?: number;
  }): Promise<CallToolResult> {
    const tabId = validateTabId(input.tabId);
    const fullPage = input.fullPage ?? false;
    if (typeof fullPage !== 'boolean') {
      throw new BrowserToolError('fullPage must be boolean.');
    }
    const maxBytes = input.maxBytes === undefined
      ? MAX_SCREENSHOT_BYTES
      : validateSafeInteger(input.maxBytes, 'maxBytes', 1, MAX_SCREENSHOT_BYTES);
    const receipt = await this.audit.recordMutationStart('browser.screenshot', {
      tabId,
      fullPage,
      maxBytes,
    });
    try {
      const result = await this.backend.screenshot({ tabId, fullPage, maxBytes });
      if (result.tabId !== tabId
        || result.mimeType !== 'image/png'
        || result.data.byteLength > maxBytes
        || typeof result.filePath !== 'string'
        || result.filePath.length === 0) {
        throw new BrowserToolError('Backend returned an invalid or oversized screenshot.');
      }
      const metadata = {
        tabId,
        bytes: result.data.byteLength,
        mimeType: result.mimeType,
        fullPage,
        urlBytes: Buffer.byteLength(result.url),
        filePath: result.filePath,
      };
      await finishAudit(this.audit, receipt, 'ok');
      return {
        content: [{
          type: 'image',
          data: result.data.toString('base64'),
          mimeType: result.mimeType,
        }],
        structuredContent: metadata,
      };
    } catch (error) {
      await finishAudit(this.audit, receipt, 'error');
      wrapBrowserError(error, 'screenshot');
    }
  }

  async close(input: { tabId: string }): Promise<CallToolResult> {
    const tabId = validateTabId(input.tabId);
    let receipt: AuditReceipt | undefined;
    try {
      receipt = await this.audit.recordMutationStart('browser.close', { tabId });
    } catch {
      // Closing a tab reduces remote capability and remains available when audit storage fails.
    }
    try {
      const result = await this.backend.close({ tabId });
      if (result.tabId !== tabId) {
        throw new BrowserToolError('Backend close result belongs to another tab.');
      }
      if (receipt !== undefined) await finishAudit(this.audit, receipt, 'ok');
      return toolResult(`Closed browser tab ${tabId}.`, { tabId });
    } catch (error) {
      if (receipt !== undefined) await finishAudit(this.audit, receipt, 'error');
      wrapBrowserError(error, 'browser.close');
    }
  }

  async grantPermissions(input: {
    origin: string;
    permissions: string[];
  }): Promise<CallToolResult> {
    const origin = validateOrigin(input.origin);
    const permissions = validatePermissions(input.permissions);
    return this.mutation(
      'browser.grant_permissions',
      { origin, permissions },
      async () => {
        const result = await this.backend.grantPermissions({ origin, permissions });
        return toolResult('Browser permissions granted.', result);
      },
    );
  }

  async clearPermissions(input: { origin?: string }): Promise<CallToolResult> {
    const origin = input.origin === undefined ? undefined : validateOrigin(input.origin);
    return this.mutation(
      'browser.clear_permissions',
      origin === undefined ? { allOrigins: true } : { allOrigins: false, origin },
      async () => {
        const result = await this.backend.clearPermissions(
          origin === undefined ? {} : { origin },
        );
        return toolResult('Browser permissions cleared.', result);
      },
    );
  }

  async setGeolocation(input: {
    origin: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
  }): Promise<CallToolResult> {
    const origin = validateOrigin(input.origin);
    const latitude = validateCoordinate(input.latitude, 'latitude', -90, 90);
    const longitude = validateCoordinate(input.longitude, 'longitude', -180, 180);
    const accuracy = validateAccuracy(input.accuracy);
    return this.mutation(
      'browser.set_geolocation',
      {
        origin,
        latitude,
        longitude,
        ...(accuracy === undefined ? {} : { accuracy }),
      },
      async () => {
        const result = await this.backend.setGeolocation({
          origin,
          latitude,
          longitude,
          ...(accuracy === undefined ? {} : { accuracy }),
        });
        return toolResult('Browser geolocation updated.', result);
      },
    );
  }

  private async mutation(
    operation: string,
    metadata: Record<string, unknown>,
    action: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> {
    const receipt = await this.audit.recordMutationStart(operation, metadata);
    try {
      const result = await action();
      await finishAudit(this.audit, receipt, 'ok');
      return result;
    } catch (error) {
      await finishAudit(this.audit, receipt, 'error');
      wrapBrowserError(error, operation);
    }
  }
}


export function createBrowserToolDispatcher(
  service: BrowserToolService,
  fallback: LoomToolDispatcher,
): LoomToolDispatcher {
  return async (name: LoomToolName, arguments_: Record<string, unknown>) => {
    if (name !== 'loom_browser') {
      return fallback(name, arguments_);
    }
    const { action, ...input } = arguments_;
    switch (action) {
      case 'status':
        return service.status();
      case 'tabs':
        return service.tabs();
      case 'open':
        return service.open(input as { url?: string });
      case 'navigate':
        return service.navigate(input as { tabId: string; url: string });
      case 'snapshot':
        return service.snapshot(input as { tabId: string; maxBytes?: number });
      case 'click':
        return service.click(input as { tabId: string; selector: string });
      case 'type':
        return service.type(input as {
          tabId: string;
          selector: string;
          text: string;
          submit?: boolean;
        });
      case 'evaluate':
        return service.evaluate(input as { tabId: string; expression: string });
      case 'screenshot':
        return service.screenshot(input as {
          tabId: string;
          fullPage?: boolean;
          maxBytes?: number;
        });
      case 'close':
        return service.close(input as { tabId: string });
      case 'grant_permissions':
        return service.grantPermissions(input as {
          origin: string;
          permissions: string[];
        });
      case 'clear_permissions':
        return service.clearPermissions(input as { origin?: string });
      case 'set_geolocation':
        return service.setGeolocation(input as {
          origin: string;
          latitude: number;
          longitude: number;
          accuracy?: number;
        });
      default:
        throw new BrowserToolError(`Unsupported loom_browser action: ${String(action)}`);
    }
  };
}
