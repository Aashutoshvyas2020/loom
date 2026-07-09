import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import type { Browser, BrowserContext, Download, Page } from 'playwright-core';

import { AuditLogger, type AuditReceipt } from '../audit.js';
import { atomicWriteFile } from '../atomic-file.js';
import {
  type BrowserBackend,
  BrowserEvaluationTimeoutError,
  BrowserNotReadyError,
  type BrowserEvaluationResult,
  type BrowserScreenshotResult,
  type BrowserSnapshotResult,
  type BrowserStatusResult,
  type BrowserTab,
  BrowserTabNotFoundError,
  BrowserToolError,
} from '../browser.js';
import { MAX_BROWSER_TABS, SHUTDOWN_SOFT_GRACE_MS } from '../limits.js';
import { PathPolicyError, assertNoSymlinkComponents, resolveUserPath } from '../paths.js';
import { ProcessManager } from '../process-manager.js';
import {
  inspectProcess,
  observableIdentityMatches,
  type ProcessObservation,
} from '../watchdog.js';
import { verifyChromiumExecutable } from './setup.js';

const execFileAsync = promisify(execFile);
const DEVTOOLS_FILE_LIMIT = 1024;
const DEFAULT_LAUNCH_TIMEOUT_MS = 20_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_EVALUATION_TIMEOUT_MS = 10_000;
const DEFAULT_PAGE_CLOSE_TIMEOUT_MS = 2_000;
const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

type BrowserJob = Awaited<ReturnType<ProcessManager['start']>>;
type PlaywrightLoader = () => Promise<{ chromium: { connectOverCDP(endpoint: string, options: { timeout: number }): Promise<Browser> } }>;

interface ClosableChromiumBrowser {
  newBrowserCDPSession(): Promise<{ send(command: string): Promise<unknown> }>;
  close(): Promise<void>;
}

interface ClosableBrowserJob {
  wait(): Promise<unknown>;
  cancel(): Promise<unknown>;
}

export interface ManagedChromiumBackendOptions {
  processManager: ProcessManager;
  audit: AuditLogger;
  executablePath: string;
  expectedSha256: string;
  profileDirectory: string;
  runtimeDirectory: string;
  downloadsDirectory: string;
  screenshotsDirectory: string;
  launchTimeoutMs?: number;
  navigationTimeoutMs?: number;
  evaluationTimeoutMs?: number;
  pageCloseTimeoutMs?: number;
  loadPlaywright?: PlaywrightLoader;
  now?: () => Date;
}

interface RecoverablePage {
  close(options: { runBeforeUnload: false }): Promise<void>;
  url(): string;
}

interface EvaluablePage extends RecoverablePage {
  evaluate(expression: string): Promise<unknown>;
}

export interface BrowserLockIdentity {
  pid: number;
  startTime: number;
  executablePath: string;
  launchId: string;
  profilePath: string;
}

export interface RecoverBrowserProfileLocksOptions {
  runtimeDirectory: string;
  profileDirectory: string;
  inspect?: (pid: number) => Promise<ProcessObservation | null>;
  listProcesses?: () => Promise<Array<{ pid: number; command: string }>>;
}

function currentUserId(): number {
  if (process.getuid === undefined) throw new BrowserToolError('Browser ownership checks require POSIX.');
  return process.getuid();
}

function nestedErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function validateDuration(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new BrowserToolError(`${name} must be a positive integer no greater than ${maximum}.`);
  }
  return value;
}

function truncateUtf8(value: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= maxBytes) return { text: value, bytes: bytes.byteLength, truncated: false };
  let end = maxBytes;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  const text = bytes.subarray(0, end).toString('utf8');
  return { text, bytes: Buffer.byteLength(text), truncated: true };
}

function timeout<T>(milliseconds: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new BrowserEvaluationTimeoutError(message)), milliseconds);
  });
}

async function waitForManagedExit(job: ClosableBrowserJob, deadlineMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      job.wait().then(() => undefined),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new BrowserNotReadyError(
            `Chromium did not exit within ${deadlineMs} ms after Browser.close.`,
          )),
          deadlineMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function closeManagedChromium(
  browser: ClosableChromiumBrowser,
  job: ClosableBrowserJob,
  gracefulDeadlineMs = SHUTDOWN_SOFT_GRACE_MS,
): Promise<void> {
  try {
    const session = await browser.newBrowserCDPSession();
    await session.send('Browser.close');
    await waitForManagedExit(job, gracefulDeadlineMs);
  } catch {
    await browser.close().catch(() => undefined);
    await job.cancel();
  }
}

export async function runBoundedPageOperation<T>(input: {
  page: RecoverablePage;
  operation: () => Promise<T>;
  timeoutMs: number;
  timeoutMessage: string;
  closeTimeoutMs: number;
  verifyHealthy: () => Promise<void>;
  restartBrowser: () => Promise<void>;
}): Promise<T> {
  try {
    return await Promise.race([
      input.operation(),
      timeout<T>(input.timeoutMs, input.timeoutMessage),
    ]);
  } catch (error) {
    if (!(error instanceof BrowserEvaluationTimeoutError)) throw error;
    try {
      await Promise.race([
        input.page.close({ runBeforeUnload: false }),
        timeout(input.closeTimeoutMs, `Timed-out tab did not close within ${input.closeTimeoutMs} ms.`),
      ]);
      await input.verifyHealthy();
    } catch {
      await input.restartBrowser();
    }
    throw error;
  }
}

export async function runBoundedEvaluation(input: {
  page: EvaluablePage;
  expression: string;
  evaluationTimeoutMs: number;
  closeTimeoutMs: number;
  verifyHealthy: () => Promise<void>;
  restartBrowser: () => Promise<void>;
}): Promise<unknown> {
  return runBoundedPageOperation({
    page: input.page,
    operation: () => input.page.evaluate(input.expression),
    timeoutMs: input.evaluationTimeoutMs,
    timeoutMessage: `Browser evaluation exceeded ${input.evaluationTimeoutMs} ms.`,
    closeTimeoutMs: input.closeTimeoutMs,
    verifyHealthy: input.verifyHealthy,
    restartBrowser: input.restartBrowser,
  });
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'item';
}

function browserLockPath(runtimeDirectory: string): string {
  return path.join(resolveUserPath(runtimeDirectory), 'browser.lock');
}

function validateBrowserLock(value: unknown): BrowserLockIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BrowserNotReadyError('Browser lock is malformed.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'executablePath,launchId,pid,profilePath,startTime'
    || !Number.isSafeInteger(record.pid)
    || (record.pid as number) <= 0
    || typeof record.startTime !== 'number'
    || !Number.isFinite(record.startTime)
    || (record.startTime as number) < 0
    || typeof record.executablePath !== 'string'
    || !path.isAbsolute(record.executablePath)
    || typeof record.launchId !== 'string'
    || record.launchId.length === 0
    || typeof record.profilePath !== 'string'
    || !path.isAbsolute(record.profilePath)) {
    throw new BrowserNotReadyError('Browser lock is malformed.');
  }
  return record as unknown as BrowserLockIdentity;
}

async function readBrowserLock(runtimeDirectory: string): Promise<BrowserLockIdentity | null> {
  const lockPath = browserLockPath(runtimeDirectory);
  try {
    await assertNoSymlinkComponents(lockPath);
    const stats = await lstat(lockPath);
    if (stats.isSymbolicLink()
      || !stats.isFile()
      || stats.uid !== currentUserId()
      || (stats.mode & 0o777) !== 0o600) {
      throw new BrowserNotReadyError(`Browser lock must be a private 0600 regular file: ${lockPath}`);
    }
    return validateBrowserLock(JSON.parse(await readFile(lockPath, 'utf8')) as unknown);
  } catch (error) {
    if (nestedErrorCode(error) === 'ENOENT') return null;
    if (error instanceof BrowserNotReadyError) throw error;
    throw new BrowserNotReadyError(`Unable to read browser lock: ${String(error)}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export async function writeBrowserLock(
  runtimeDirectory: string,
  identity: BrowserLockIdentity,
): Promise<void> {
  const parsed = validateBrowserLock(identity);
  const directory = resolveUserPath(runtimeDirectory);
  await assertNoSymlinkComponents(directory);
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== currentUserId()) {
    throw new BrowserNotReadyError(`Unsafe browser runtime directory: ${directory}`);
  }
  await atomicWriteFile(
    browserLockPath(directory),
    Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`),
  );
}

async function removeBrowserLock(
  runtimeDirectory: string,
  expected?: BrowserLockIdentity,
): Promise<void> {
  const current = await readBrowserLock(runtimeDirectory);
  if (current === null) return;
  if (expected !== undefined && JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new BrowserNotReadyError('Browser lock changed; refusing to remove an unowned lock.');
  }
  const lockPath = browserLockPath(runtimeDirectory);
  await rm(lockPath);
  await syncDirectory(path.dirname(lockPath));
}

async function defaultProfileProcesses(): Promise<Array<{ pid: number; command: string }>> {
  const { stdout } = await execFileAsync(
    '/bin/ps',
    ['-axo', 'pid=,command='],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  const processes: Array<{ pid: number; command: string }> = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    const pid = Number(match[1]);
    if (Number.isSafeInteger(pid) && pid > 0) {
      processes.push({ pid, command: match[2]! });
    }
  }
  return processes;
}

function isChromiumExecutable(executablePath: string): boolean {
  const executableName = path.basename(executablePath).toLowerCase();
  return executableName.startsWith('google chrome for testing')
    || executableName.startsWith('chromium');
}

export async function recoverBrowserProfileLocks(
  options: RecoverBrowserProfileLocksOptions,
): Promise<void> {
  const runtimeDirectory = resolveUserPath(options.runtimeDirectory);
  const profileDirectory = resolveUserPath(options.profileDirectory);
  await assertNoSymlinkComponents(runtimeDirectory);
  await assertNoSymlinkComponents(profileDirectory);
  const inspect = options.inspect ?? inspectProcess;
  const listProcesses = options.listProcesses ?? defaultProfileProcesses;
  const lock = await readBrowserLock(runtimeDirectory);
  let staleLock: BrowserLockIdentity | undefined;
  if (lock !== null) {
    if (lock.profilePath !== profileDirectory) {
      throw new BrowserNotReadyError('Browser lock profile path does not match the active profile; identity is uncertain.');
    }
    const observed = await inspect(lock.pid);
    if (observed !== null) {
      if (observableIdentityMatches(lock, observed)) {
        throw new BrowserNotReadyError('The recorded Loom browser process is still live.');
      }
      throw new BrowserNotReadyError('Browser lock process identity is uncertain.');
    }
    staleLock = lock;
  }

  for (const processEntry of await listProcesses()) {
    if (!processEntry.command.includes(profileDirectory)) continue;
    let observed: ProcessObservation | null;
    try {
      observed = await inspect(processEntry.pid);
    } catch (error) {
      throw new BrowserNotReadyError(
        `Unable to verify process ${processEntry.pid} referencing the dedicated Loom browser profile.`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
    if (observed !== null && isChromiumExecutable(observed.executablePath)) {
      throw new BrowserNotReadyError('A live Chromium process still references the dedicated Loom browser profile.');
    }
  }
  if (staleLock !== undefined) {
    await removeBrowserLock(runtimeDirectory, staleLock);
  }

  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const target = path.join(profileDirectory, name);
    try {
      const stats = await lstat(target);
      if (stats.uid !== currentUserId() || stats.isDirectory()) {
        throw new BrowserNotReadyError(`Unsafe browser profile lock artifact: ${name}`);
      }
      await rm(target, { force: true });
    } catch (error) {
      if (nestedErrorCode(error) !== 'ENOENT') throw error;
    }
  }
  await syncDirectory(profileDirectory);
}

export async function writeExclusiveReadable(
  targetPath: string,
  stream: AsyncIterable<Buffer | Uint8Array | string>,
): Promise<void> {
  const target = resolveUserPath(targetPath);
  await assertNoSymlinkComponents(target);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    created = true;
    let offset = 0;
    for await (const chunk of stream) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
      let written = 0;
      while (written < bytes.byteLength) {
        const result = await handle.write(
          bytes,
          written,
          bytes.byteLength - written,
          offset,
        );
        written += result.bytesWritten;
        offset += result.bytesWritten;
      }
    }
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    handle = undefined;
    if (created) await rm(target, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
  await syncDirectory(path.dirname(target));
}

export class ManagedChromiumBackend implements BrowserBackend {
  private readonly processManager: ProcessManager;
  private readonly audit: AuditLogger;
  private readonly executablePath: string;
  private readonly expectedSha256: string;
  private readonly profileDirectory: string;
  private readonly runtimeDirectory: string;
  private readonly downloadsDirectory: string;
  private readonly screenshotsDirectory: string;
  private readonly launchTimeoutMs: number;
  private readonly navigationTimeoutMs: number;
  private readonly evaluationTimeoutMs: number;
  private readonly pageCloseTimeoutMs: number;
  private readonly loadPlaywright: PlaywrightLoader;
  private readonly now: () => Date;
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private job: BrowserJob | undefined;
  private starting: Promise<void> | undefined;
  private shuttingDown = false;
  private initialPage: Page | undefined;
  private readonly idsByPage = new WeakMap<Page, string>();
  private readonly pagesById = new Map<string, Page>();
  private readonly permissionGrants = new Map<string, Set<string>>();
  private activeLock: BrowserLockIdentity | undefined;
  private screenshotCounter = 0;
  private downloadCounter = 0;

  constructor(options: ManagedChromiumBackendOptions) {
    this.processManager = options.processManager;
    this.audit = options.audit;
    this.executablePath = options.executablePath;
    this.expectedSha256 = options.expectedSha256;
    this.profileDirectory = resolveUserPath(options.profileDirectory);
    this.runtimeDirectory = resolveUserPath(options.runtimeDirectory);
    this.downloadsDirectory = resolveUserPath(options.downloadsDirectory);
    this.screenshotsDirectory = resolveUserPath(options.screenshotsDirectory);
    this.launchTimeoutMs = validateDuration(options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS, 'launchTimeoutMs', 120_000);
    this.navigationTimeoutMs = validateDuration(options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS, 'navigationTimeoutMs', 120_000);
    this.evaluationTimeoutMs = validateDuration(options.evaluationTimeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS, 'evaluationTimeoutMs', 60_000);
    this.pageCloseTimeoutMs = validateDuration(options.pageCloseTimeoutMs ?? DEFAULT_PAGE_CLOSE_TIMEOUT_MS, 'pageCloseTimeoutMs', 10_000);
    this.loadPlaywright = options.loadPlaywright ?? (async () => import('playwright-core'));
    this.now = options.now ?? (() => new Date());
  }

  async status(): Promise<BrowserStatusResult> {
    const running = this.browser !== undefined && this.browser.isConnected() && this.context !== undefined;
    return { running, tabs: running ? this.pagesById.size : 0, version: running ? this.browser!.version() : null };
  }

  async tabs(): Promise<BrowserTab[]> {
    if (this.context === undefined || this.browser === undefined || !this.browser.isConnected()) return [];
    const tabs: BrowserTab[] = [];
    for (const page of this.context.pages()) if (!page.isClosed()) tabs.push(await this.tabSummary(page));
    return tabs;
  }

  async open(input: { url?: string }): Promise<BrowserTab> {
    await this.ensureStarted();
    let page: Page;
    if (this.initialPage !== undefined && !this.initialPage.isClosed()) {
      page = this.initialPage;
      this.initialPage = undefined;
    } else {
      if (this.pagesById.size >= MAX_BROWSER_TABS) {
        throw new BrowserToolError(`Browser tab limit ${MAX_BROWSER_TABS} reached.`);
      }
      page = await this.context!.newPage();
      this.registerPage(page);
    }
    if (input.url !== undefined && input.url !== 'about:blank') {
      await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: this.navigationTimeoutMs });
    }
    return this.tabSummary(page);
  }

  async navigate(input: { tabId: string; url: string }): Promise<BrowserTab> {
    const page = this.requirePage(input.tabId);
    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: this.navigationTimeoutMs });
    return this.tabSummary(page);
  }

  async snapshot(input: { tabId: string; maxBytes: number }): Promise<BrowserSnapshotResult> {
    const page = this.requirePage(input.tabId);
    const payload = await runBoundedPageOperation({
      page,
      operation: () => page.evaluate(({ maximumCharacters }) => {
        const bodyText = document.body?.innerText ?? '';
        const controls = [...document.querySelectorAll('a,button,input,textarea,select,[role]')].slice(0, 200).map((element) => {
          const html = element as HTMLElement;
          const form = element as HTMLInputElement;
          return { tag: element.tagName.toLowerCase(), id: html.id || null, role: html.getAttribute('role'), name: html.getAttribute('aria-label') || form.placeholder || html.innerText?.trim().slice(0, 256) || null, type: form.type || null, href: element instanceof HTMLAnchorElement ? element.href : null };
        });
        return { title: document.title, url: location.href, text: bodyText.slice(0, maximumCharacters), controls, sourceTruncated: bodyText.length > maximumCharacters };
      }, { maximumCharacters: Math.min(input.maxBytes, 256 * 1024) }),
      timeoutMs: this.evaluationTimeoutMs,
      timeoutMessage: `Browser snapshot evaluation exceeded ${this.evaluationTimeoutMs} ms.`,
      closeTimeoutMs: this.pageCloseTimeoutMs,
      verifyHealthy: () => this.verifyBrowserHealth(page),
      restartBrowser: () => this.shutdown(),
    });
    const rendered = [`Title: ${payload.title}`, `URL: ${payload.url}`, '', 'Text:', payload.text, '', 'Controls:', JSON.stringify(payload.controls, null, 2)].join('\n');
    const bounded = truncateUtf8(rendered, input.maxBytes);
    return { tabId: input.tabId, url: payload.url, title: payload.title, text: bounded.text, bytes: bounded.bytes, truncated: bounded.truncated || payload.sourceTruncated };
  }

  async click(input: { tabId: string; selector: string }): Promise<{ tabId: string; url: string }> {
    const page = this.requirePage(input.tabId);
    await page.locator(input.selector).first().click({ timeout: this.navigationTimeoutMs });
    return { tabId: input.tabId, url: page.url() };
  }

  async type(input: { tabId: string; selector: string; text: string; submit: boolean }): Promise<{ tabId: string; url: string }> {
    const page = this.requirePage(input.tabId);
    const locator = page.locator(input.selector).first();
    await locator.fill(input.text, { timeout: this.navigationTimeoutMs });
    if (input.submit) await locator.press('Enter', { timeout: this.navigationTimeoutMs });
    return { tabId: input.tabId, url: page.url() };
  }

  async evaluate(input: { tabId: string; expression: string; maxBytes: number }): Promise<BrowserEvaluationResult> {
    const page = this.requirePage(input.tabId);
    const value = await runBoundedEvaluation({
      page,
      expression: input.expression,
      evaluationTimeoutMs: this.evaluationTimeoutMs,
      closeTimeoutMs: this.pageCloseTimeoutMs,
      verifyHealthy: () => this.verifyBrowserHealth(page),
      restartBrowser: () => this.shutdown(),
    });
    let json: string;
    try { json = JSON.stringify(value) ?? 'undefined'; }
    catch (error) { throw new BrowserToolError('Browser evaluation result is not JSON-serializable.', { cause: error instanceof Error ? error : undefined }); }
    const bytes = Buffer.byteLength(json);
    if (bytes > input.maxBytes) throw new BrowserToolError(`Browser evaluation result exceeds ${input.maxBytes} bytes.`);
    return { tabId: input.tabId, url: page.url(), json, bytes };
  }

  async screenshot(input: { tabId: string; fullPage: boolean; maxBytes: number }): Promise<BrowserScreenshotResult> {
    const page = this.requirePage(input.tabId);
    const data = await page.screenshot({ type: 'png', fullPage: input.fullPage, animations: 'disabled', caret: 'hide' });
    if (data.byteLength > input.maxBytes) throw new BrowserToolError(`Browser screenshot exceeds ${input.maxBytes} bytes.`);
    const filePath = await this.persistBuffer(this.screenshotsDirectory, this.screenshotName(input.tabId), data);
    return { tabId: input.tabId, url: page.url(), data, mimeType: 'image/png', filePath };
  }

  async close(input: { tabId: string }): Promise<{ tabId: string }> {
    const page = this.requirePage(input.tabId);
    await page.close({ runBeforeUnload: false });
    this.pagesById.delete(input.tabId);
    return { tabId: input.tabId };
  }

  async grantPermissions(input: { origin: string; permissions: string[] }): Promise<{ origin: string; permissions: string[] }> {
    await this.ensureStarted();
    const existing = this.permissionGrants.get(input.origin) ?? new Set<string>();
    input.permissions.forEach((permission) => existing.add(permission));
    const permissions = [...existing].sort();
    await this.context!.grantPermissions(permissions, { origin: input.origin });
    this.permissionGrants.set(input.origin, existing);
    return { origin: input.origin, permissions };
  }

  async clearPermissions(input: { origin?: string }): Promise<{ origin?: string }> {
    if (this.context === undefined || this.browser === undefined || !this.browser.isConnected()) throw new BrowserNotReadyError('Browser is not running.');
    await this.context.clearPermissions();
    if (input.origin === undefined) { this.permissionGrants.clear(); return {}; }
    this.permissionGrants.delete(input.origin);
    for (const [origin, permissions] of this.permissionGrants) await this.context.grantPermissions([...permissions].sort(), { origin });
    return { origin: input.origin };
  }

  async setGeolocation(input: { origin: string; latitude: number; longitude: number; accuracy?: number }): Promise<{ origin: string; latitude: number; longitude: number; accuracy?: number }> {
    await this.ensureStarted();
    const existing = this.permissionGrants.get(input.origin) ?? new Set<string>();
    existing.add('geolocation');
    await this.context!.grantPermissions([...existing].sort(), { origin: input.origin });
    this.permissionGrants.set(input.origin, existing);
    await this.context!.setGeolocation({ latitude: input.latitude, longitude: input.longitude, ...(input.accuracy === undefined ? {} : { accuracy: input.accuracy }) });
    return input;
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const browser = this.browser;
    const job = this.job;
    const lock = this.activeLock;
    this.browser = undefined; this.context = undefined; this.job = undefined; this.starting = undefined; this.initialPage = undefined; this.activeLock = undefined;
    this.pagesById.clear(); this.permissionGrants.clear();
    try {
      if (browser !== undefined && job !== undefined) {
        await closeManagedChromium(browser, job);
      } else {
        await browser?.close().catch(() => undefined);
        await job?.cancel().catch(() => undefined);
      }
      if (lock !== undefined) await removeBrowserLock(this.runtimeDirectory, lock);
    } finally {
      this.shuttingDown = false;
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.browser !== undefined && this.browser.isConnected() && this.context !== undefined) return;
    if (this.starting !== undefined) return this.starting;
    this.starting = this.startBrowser();
    try { await this.starting; } finally { this.starting = undefined; }
  }

  private async startBrowser(): Promise<void> {
    if (this.shuttingDown) throw new BrowserNotReadyError('Browser shutdown is in progress.');
    const verified = await verifyChromiumExecutable({ executablePath: this.executablePath, expectedSha256: this.expectedSha256 });
    await Promise.all([
      this.ensurePrivateDirectory(this.profileDirectory),
      this.ensurePrivateDirectory(this.runtimeDirectory),
      this.ensurePrivateDirectory(this.downloadsDirectory),
      this.ensurePrivateDirectory(this.screenshotsDirectory),
    ]);
    await recoverBrowserProfileLocks({
      runtimeDirectory: this.runtimeDirectory,
      profileDirectory: this.profileDirectory,
    });
    const devtoolsFile = path.join(this.profileDirectory, 'DevToolsActivePort');
    await this.removeStaleRegularFile(devtoolsFile, 'DevToolsActivePort');
    const args = ['--headless=new', `--user-data-dir=${this.profileDirectory}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--no-service-autorun', '--password-store=basic', '--use-mock-keychain', 'about:blank'];
    let job: BrowserJob | undefined;
    let browser: Browser | undefined;
    let lock: BrowserLockIdentity | undefined;
    try {
      job = await this.processManager.start({ executable: verified.executablePath, args, cwd: this.profileDirectory });
      lock = {
        pid: job.metadata.wrapperPid,
        startTime: job.metadata.wrapperStartTime,
        executablePath: job.metadata.wrapperExecutablePath,
        launchId: job.metadata.launchId,
        profilePath: this.profileDirectory,
      };
      await writeBrowserLock(this.runtimeDirectory, lock);
      this.activeLock = lock;
      const endpoint = await this.waitForDevToolsEndpoint(devtoolsFile);
      const playwright = await this.loadPlaywright();
      browser = await playwright.chromium.connectOverCDP(endpoint, { timeout: this.launchTimeoutMs });
      const contexts = browser.contexts();
      if (contexts.length !== 1) throw new BrowserNotReadyError(`Expected one persistent Chromium context, received ${contexts.length}.`);
      this.job = job; this.browser = browser; this.context = contexts[0]!;
      for (const page of this.context.pages()) this.registerPage(page);
      if (this.context.pages().length === 1 && this.context.pages()[0]!.url() === 'about:blank') this.initialPage = this.context.pages()[0];
      this.context.on('page', (page) => this.registerPage(page));
      browser.on('disconnected', () => {
        const disconnectedJob = this.job;
        const disconnectedLock = this.activeLock;
        this.browser = undefined; this.context = undefined; this.job = undefined; this.initialPage = undefined; this.activeLock = undefined;
        this.pagesById.clear(); this.permissionGrants.clear();
        void (async () => {
          await disconnectedJob?.cancel().catch(() => undefined);
          if (disconnectedLock !== undefined) {
            await removeBrowserLock(this.runtimeDirectory, disconnectedLock).catch(() => undefined);
          }
        })();
      });
    } catch (error) {
      this.activeLock = undefined;
      await browser?.close().catch(() => undefined);
      await job?.cancel().catch(() => undefined);
      if (lock !== undefined) await removeBrowserLock(this.runtimeDirectory, lock).catch(() => undefined);
      throw error instanceof BrowserToolError ? error : new BrowserNotReadyError(`Unable to start managed Chromium: ${String(error)}`, { cause: error instanceof Error ? error : undefined });
    }
  }

  private async ensurePrivateDirectory(directoryPath: string): Promise<void> {
    try {
      await mkdir(directoryPath, { recursive: true, mode: 0o700 });
      await assertNoSymlinkComponents(directoryPath);
      const stats = await lstat(directoryPath);
      if (stats.isSymbolicLink() || !stats.isDirectory() || stats.uid !== currentUserId()) throw new BrowserToolError(`Unsafe browser directory: ${directoryPath}`);
      if ((stats.mode & 0o777) !== 0o700) await chmod(directoryPath, 0o700);
    } catch (error) {
      if (error instanceof BrowserToolError) throw error;
      if (error instanceof PathPolicyError) throw new BrowserToolError(error.message, { cause: error });
      throw new BrowserToolError(`Unable to initialize browser directory: ${String(error)}`, { cause: error instanceof Error ? error : undefined });
    }
  }

  private async removeStaleRegularFile(filePath: string, label: string): Promise<void> {
    try {
      const stats = await lstat(filePath);
      if (stats.isSymbolicLink() || !stats.isFile() || stats.uid !== currentUserId()) throw new BrowserToolError(`Unsafe stale ${label} file.`);
      await rm(filePath);
    } catch (error) {
      if (nestedErrorCode(error) !== 'ENOENT') throw error;
    }
  }

  private async waitForDevToolsEndpoint(devtoolsFile: string): Promise<string> {
    const deadline = Date.now() + this.launchTimeoutMs;
    while (Date.now() < deadline) {
      try {
        await assertNoSymlinkComponents(devtoolsFile);
        const stats = await lstat(devtoolsFile);
        if (stats.isSymbolicLink() || !stats.isFile() || stats.uid !== currentUserId() || stats.size <= 0 || stats.size > DEVTOOLS_FILE_LIMIT) throw new BrowserNotReadyError('Chromium produced unsafe DevTools metadata.');
        const [portLine, websocketPath] = fatalUtf8Decoder.decode(await readFile(devtoolsFile)).trim().split('\n');
        const port = Number(portLine);
        if (!Number.isInteger(port) || port < 1 || port > 65_535 || websocketPath === undefined || !websocketPath.startsWith('/devtools/browser/')) throw new BrowserNotReadyError('Chromium produced malformed DevTools metadata.');
        return `http://127.0.0.1:${port}`;
      } catch (error) {
        if (error instanceof BrowserNotReadyError) throw error;
        if (nestedErrorCode(error) !== 'ENOENT') throw new BrowserNotReadyError(`Unable to read DevTools endpoint: ${String(error)}`, { cause: error instanceof Error ? error : undefined });
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new BrowserNotReadyError(`Chromium did not publish DevToolsActivePort within ${this.launchTimeoutMs} ms.`);
  }

  private registerPage(page: Page): string {
    const existing = this.idsByPage.get(page);
    if (existing !== undefined) return existing;
    let id: string;
    do { id = `tab_${randomBytes(16).toString('base64url')}`; } while (this.pagesById.has(id));
    this.idsByPage.set(page, id); this.pagesById.set(id, page);
    page.on('close', () => { this.pagesById.delete(id); if (this.initialPage === page) this.initialPage = undefined; });
    page.on('download', (download) => { void this.persistDownload(download, id); });
    return id;
  }

  private async persistDownload(download: Download, tabId: string): Promise<void> {
    let receipt: AuditReceipt | undefined;
    try {
      const suggested = safeFilenamePart(download.suggestedFilename());
      receipt = await this.audit.recordMutationStart('browser.download', { tabId, suggestedFilenameBytes: Buffer.byteLength(download.suggestedFilename()) });
      const target = this.downloadName(tabId, suggested);
      await this.ensurePrivateDirectory(this.downloadsDirectory);
      const stream = await download.createReadStream();
      if (stream === null) throw new BrowserToolError('Browser download stream is unavailable.');
      await writeExclusiveReadable(target, stream as Readable);
      const stats = await lstat(target);
      if (!stats.isFile() || stats.uid !== currentUserId() || (stats.mode & 0o777) !== 0o600) {
        throw new BrowserToolError('Browser download did not produce a private regular file.');
      }
      await this.audit.recordFinish(receipt, 'ok');
    } catch {
      if (receipt !== undefined) await this.audit.recordFinish(receipt, 'error');
    }
  }

  private async persistBuffer(directory: string, filename: string, data: Buffer): Promise<string> {
    await this.ensurePrivateDirectory(directory);
    const target = path.join(directory, filename);
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(directory);
    return target;
  }

  private timestamp(): string { return this.now().toISOString().replace(/[-:]/g, '').replace('.','_'); }
  private screenshotName(tabId: string): string { this.screenshotCounter += 1; return `${this.timestamp()}-${safeFilenamePart(tabId)}-${String(this.screenshotCounter).padStart(6,'0')}-${randomBytes(6).toString('hex')}.png`; }
  private downloadName(tabId: string, suggested: string): string { this.downloadCounter += 1; return path.join(this.downloadsDirectory, `${this.timestamp()}-${safeFilenamePart(tabId)}-${String(this.downloadCounter).padStart(6,'0')}-${randomBytes(6).toString('hex')}-${suggested}`); }

  private async verifyBrowserHealth(excludedPage: Page): Promise<void> {
    const browser = this.browser;
    const context = this.context;
    if (browser === undefined || context === undefined || !browser.isConnected()) {
      throw new BrowserNotReadyError('Browser CDP connection is unavailable after tab recovery.');
    }
    const survivor = context.pages().find((page) => page !== excludedPage && !page.isClosed());
    if (survivor !== undefined) {
      await Promise.race([
        survivor.title(),
        timeout(this.pageCloseTimeoutMs, 'Surviving browser tab did not respond after evaluation timeout.'),
      ]);
    }
  }

  private requirePage(tabId: string): Page {
    if (this.context === undefined || this.browser === undefined || !this.browser.isConnected()) throw new BrowserNotReadyError('Browser is not running. Open a tab first.');
    const page = this.pagesById.get(tabId);
    if (page === undefined || page.isClosed()) { this.pagesById.delete(tabId); throw new BrowserTabNotFoundError(`Unknown or closed browser tab: ${tabId}`); }
    return page;
  }

  private async tabSummary(page: Page): Promise<BrowserTab> {
    const id = this.registerPage(page);
    let title = '';
    try { title = await page.title(); } catch { if (page.isClosed()) throw new BrowserTabNotFoundError(`Browser tab closed while reading summary: ${id}`); }
    return { id, url: page.url(), title };
  }
}
