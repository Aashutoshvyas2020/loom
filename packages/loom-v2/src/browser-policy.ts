import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b, c] = octets as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") ||
    (normalized.startsWith("::ffff:") && privateIpv4(normalized.slice(7)));
}

export function assertBrowserUrl(input: string): string {
  if (input === "about:blank") return input;
  if (input.length > 2_048) throw new Error("Browser URL is too long");

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Browser URL is invalid");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser URL must use HTTP or HTTPS");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname === "metadata.google.internal" || isPrivateAddress(hostname)) {
    throw new Error("Browser URL targets a blocked local or private network");
  }
  return url.href;
}

export async function assertBrowserNetworkUrl(input: string): Promise<string> {
  const normalized = assertBrowserUrl(input);
  if (normalized === "about:blank") return normalized;
  const hostname = new URL(normalized).hostname;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Browser URL resolves to a blocked local or private network");
  }
  return normalized;
}

export interface PreparedAction {
  actionId: string;
  tabId: string;
  ref: string;
  operation: "click" | "type";
  target: string;
  expiresAt: number;
}

export class ActionApprovals {
  readonly #actions = new Map<string, PreparedAction & { used: boolean }>();

  constructor(private readonly ttlMs = 30_000) {}

  prepare(input: Omit<PreparedAction, "actionId" | "expiresAt">): PreparedAction {
    if (!input.target.trim()) throw new Error("Action target is required");
    const prepared = { ...input, actionId: randomUUID(), expiresAt: Date.now() + this.ttlMs };
    this.#actions.set(prepared.actionId, { ...prepared, used: false });
    return prepared;
  }

  commit(actionId: string): PreparedAction {
    const action = this.#actions.get(actionId);
    if (!action) throw new Error("Prepared action is unknown");
    if (action.used) throw new Error("Prepared action was already used");
    if (Date.now() > action.expiresAt) throw new Error("Prepared action expired");
    action.used = true;
    const { used: _used, ...prepared } = action;
    return prepared;
  }
}
