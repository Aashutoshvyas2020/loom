import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { ActionApprovals, assertBrowserNetworkUrl } from "./browser-policy.js";
import { imageResult } from "./results.js";

export interface LoomBrowserOptions { profileDirectory: string; downloadsDirectory?: string; headless?: boolean }
type Tab = { id: string; page: Page };
type Ref = { tabId: string; locator: Locator };
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export class LoomBrowser {
  readonly #options: LoomBrowserOptions;
  readonly #tabs = new Map<string, Tab>();
  readonly #refs = new Map<string, Ref>();
  readonly #approvals = new ActionApprovals();
  #context?: BrowserContext;

  constructor(options: LoomBrowserOptions) {
    this.#options = options;
  }

  get tabCount(): number { return this.#tabs.size; }

  async status(): Promise<any> {
    return {
      structuredContent: { ready: Boolean(this.#context), tabCount: this.#tabs.size, profileDirectory: this.#options.profileDirectory },
      content: [{ type: "text", text: this.#context ? `Chromium ready; ${this.#tabs.size} Loom tab(s)` : "Chromium not started" }],
    };
  }

  async tabs(): Promise<any> {
    const tabs = await Promise.all([...this.#tabs.values()].map(async ({ id, page }) => ({ tabId: id, url: page.url(), title: await page.title().catch(() => "") })));
    return { structuredContent: { tabs }, content: [{ type: "text", text: tabs.length ? tabs.map((tab) => `${tab.tabId} ${tab.url}`).join("\n") : "No Loom tabs" }] };
  }

  async open(input: { url?: string }): Promise<any> {
    const url = await assertBrowserNetworkUrl(input.url ?? "about:blank");
    const context = await this.#ensure();
    const claimed = new Set([...this.#tabs.values()].map((tab) => tab.page));
    const page = context.pages().find((candidate) => !claimed.has(candidate) && candidate.url() === "about:blank") ?? await context.newPage();
    const tabId = `tab_${randomUUID()}`;
    this.#tabs.set(tabId, { id: tabId, page });
    page.once("close", () => this.#removeTab(tabId));
    if (url !== "about:blank") await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return { structuredContent: { tabId, url: page.url(), title: await page.title().catch(() => "") }, content: [{ type: "text", text: `Opened ${page.url()}` }] };
  }

  async navigate(input: { tabId: string; url: string }): Promise<any> {
    const url = await assertBrowserNetworkUrl(input.url);
    const page = this.#tab(input.tabId).page;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return { structuredContent: { tabId: input.tabId, url: page.url(), title: await page.title().catch(() => "") }, content: [{ type: "text", text: `Navigated to ${page.url()}` }] };
  }

  async snapshot(input: { tabId: string; maxCharacters?: number }): Promise<any> {
    const page = this.#tab(input.tabId).page;
    const limit = Math.min(200_000, Math.max(1, input.maxCharacters ?? 50_000));
    for (const [id, ref] of this.#refs) if (ref.tabId === input.tabId) this.#refs.delete(id);
    const candidates = page.locator('a,button,input,textarea,select,[role="button"],[role="link"],[tabindex]');
    const count = Math.min(100, await candidates.count());
    const lines = [`URL: ${page.url()}`, `Title: ${await page.title().catch(() => "")}`];
    for (let index = 0; index < count; index += 1) {
      const locator = candidates.nth(index);
      if (!await locator.isVisible().catch(() => false)) continue;
      const id = `e${index + 1}`;
      this.#refs.set(id, { tabId: input.tabId, locator });
      const role = await locator.getAttribute("role") ?? await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "element");
      const name = await locator.getAttribute("aria-label") ?? await locator.getAttribute("placeholder") ?? await locator.innerText().catch(() => "");
      lines.push(`[${id}] ${role}${name ? ` ${JSON.stringify(name.slice(0, 200))}` : ""}`);
    }
    const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (body) lines.push("", body);
    const snapshot = lines.join("\n").slice(0, limit);
    return { structuredContent: { tabId: input.tabId, url: page.url(), characters: snapshot.length, truncated: lines.join("\n").length > limit }, content: [{ type: "text", text: snapshot }] };
  }

  async click(input: { tabId: string; ref: string }): Promise<any> {
    const page = this.#tab(input.tabId).page;
    const locator = this.#locator(input.tabId, input.ref);
    const href = await locator.getAttribute("href");
    if (!href) throw new Error("Non-link browser clicks require prepare then commit");
    await assertBrowserNetworkUrl(new URL(href, page.url()).href);
    await locator.click({ timeout: 10_000 });
    return { structuredContent: { tabId: input.tabId, url: page.url() }, content: [{ type: "text", text: `Clicked ${input.ref}` }] };
  }

  async type(input: { tabId: string; ref: string; text: string }): Promise<any> {
    this.#tab(input.tabId);
    await this.#locator(input.tabId, input.ref).fill(input.text, { timeout: 10_000 });
    return { structuredContent: { tabId: input.tabId, typedCharacters: input.text.length }, content: [{ type: "text", text: `Typed ${input.text.length} characters` }] };
  }

  async prepare(input: { tabId: string; ref: string }): Promise<any> {
    this.#tab(input.tabId);
    const locator = this.#locator(input.tabId, input.ref);
    const target = await locator.getAttribute("aria-label") ?? await locator.innerText().catch(() => "") ?? input.ref;
    const prepared = this.#approvals.prepare({ tabId: input.tabId, ref: input.ref, operation: "click", target: target.slice(0, 200) || input.ref });
    return {
      structuredContent: prepared,
      content: [{ type: "text", text: `Prepared click on ${JSON.stringify(prepared.target)}. Commit action ${prepared.actionId} to execute it.` }],
    };
  }

  async commit(input: { actionId: string }): Promise<any> {
    const prepared = this.#approvals.commit(input.actionId);
    const page = this.#tab(prepared.tabId).page;
    await this.#locator(prepared.tabId, prepared.ref).click({ timeout: 10_000 });
    return {
      structuredContent: { actionId: prepared.actionId, tabId: prepared.tabId, target: prepared.target, url: page.url(), committed: true },
      content: [{ type: "text", text: `Committed click on ${JSON.stringify(prepared.target)}` }],
    };
  }

  async screenshot(input: { tabId: string; fullPage?: boolean }): Promise<any> {
    const page = this.#tab(input.tabId).page;
    const data = await page.screenshot({ type: "png", fullPage: input.fullPage ?? false });
    if (data.length > MAX_SCREENSHOT_BYTES) throw new Error(`Browser screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes`);
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    return imageResult({ data: data.toString("base64"), mimeType: "image/png", sha256: createHash("sha256").update(data).digest("hex"), width, height, bytes: data.length });
  }

  async closeTab(input: { tabId: string }): Promise<any> {
    const tab = this.#tab(input.tabId);
    await tab.page.close();
    this.#removeTab(input.tabId);
    return { structuredContent: { tabId: input.tabId, closed: true }, content: [{ type: "text", text: `Closed ${input.tabId}` }] };
  }

  async close(): Promise<void> {
    const context = this.#context;
    this.#context = undefined;
    this.#tabs.clear();
    this.#refs.clear();
    await context?.close();
  }

  async #ensure(): Promise<BrowserContext> {
    if (this.#context) return this.#context;
    await mkdir(this.#options.profileDirectory, { recursive: true, mode: 0o700 });
    if (this.#options.downloadsDirectory) await mkdir(this.#options.downloadsDirectory, { recursive: true, mode: 0o700 });
    try {
      this.#context = await chromium.launchPersistentContext(this.#options.profileDirectory, {
        headless: this.#options.headless ?? true,
        acceptDownloads: true,
        downloadsPath: this.#options.downloadsDirectory,
        permissions: [],
        viewport: { width: 1280, height: 720 },
      });
      await this.#context.route("**/*", async (route) => {
        try {
          await assertBrowserNetworkUrl(route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
    } catch (error: any) {
      throw new Error(`Dedicated Playwright Chromium could not start. Run 'npx playwright install chromium'. ${error?.message ?? error}`);
    }
    return this.#context;
  }

  #tab(id: string): Tab {
    const tab = this.#tabs.get(id);
    if (!tab) throw new Error(`Unknown Loom browser tab: ${id}`);
    return tab;
  }

  #locator(tabId: string, ref: string): Locator {
    const saved = this.#refs.get(ref);
    if (!saved) throw new Error(`Unknown browser snapshot reference: ${ref}`);
    if (saved.tabId !== tabId) throw new Error(`Browser reference ${ref} belongs to another tab`);
    return saved.locator;
  }

  #removeTab(tabId: string): void {
    this.#tabs.delete(tabId);
    for (const [id, ref] of this.#refs) if (ref.tabId === tabId) this.#refs.delete(id);
  }
}
