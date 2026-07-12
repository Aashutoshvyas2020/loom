import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoomBrowser } from "./browser.js";

const browsers: LoomBrowser[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(browsers.splice(0).map((browser) => browser.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LoomBrowser", () => {
  it("uses a dedicated persistent Chromium profile and returns visible screenshots", async () => {
    const profile = await mkdtemp(join(tmpdir(), "loom-browser-"));
    roots.push(profile);
    const browser = new LoomBrowser({ profileDirectory: profile, headless: true });
    browsers.push(browser);

    expect(await browser.status()).toMatchObject({ structuredContent: { ready: false, tabCount: 0 } });
    const opened = await browser.open({ url: "about:blank" });
    const tabId = opened.structuredContent.tabId;
    expect(tabId).toMatch(/^tab_/);
    expect(await browser.tabs()).toMatchObject({ structuredContent: { tabs: [{ tabId, url: "about:blank" }] } });

    const snapshot = await browser.snapshot({ tabId });
    expect(snapshot.content[0].text).toContain("about:blank");
    await expect(browser.click({ tabId, ref: "button" })).rejects.toThrow(/snapshot reference/i);
    const screenshot = await browser.screenshot({ tabId });
    expect(screenshot.content[0]).toMatchObject({ type: "image", mimeType: "image/png", data: expect.any(String) });
    expect(screenshot.structuredContent).toMatchObject({ width: 1280, height: 720, bytes: expect.any(Number) });

    expect(await browser.closeTab({ tabId })).toMatchObject({ structuredContent: { closed: true } });
  }, 20_000);

  it("rejects active-content and private-network navigation", async () => {
    const profile = await mkdtemp(join(tmpdir(), "loom-browser-policy-"));
    roots.push(profile);
    const browser = new LoomBrowser({ profileDirectory: profile, headless: true });
    browsers.push(browser);
    const tabId = (await browser.open({ url: "about:blank" })).structuredContent.tabId;
    await expect(browser.navigate({ tabId, url: "javascript:alert(1)" })).rejects.toThrow();
    await expect(browser.navigate({ tabId, url: "http://127.0.0.1" })).rejects.toThrow();
  }, 20_000);
});
