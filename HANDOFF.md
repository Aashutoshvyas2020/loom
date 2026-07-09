# Loom Implementation Handoff

**Date and local time:** 2026-07-08 22:58 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**Completed T15.4 implementation SHA:** `5ee5dd9524940fd87432f4727178fbfdbeecb08e`
**Repository state after implementation commit:** clean
**Current task:** T15.4 complete; next action is the owner's real foreground launch and connector test
**Last completed gate:** Node 22 and active-runtime typecheck, 214/214 tests, build, exact 75-file map, 90-file package inspection, staged secret scan, and empty Loom-owned residue scan
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Why T15.4 was required

The package and public documentation declare Node.js 22+ support, but the previous agent had only run the complete suite on Node 26. A fresh Node v22.23.1 run completed 185/214 tests and cancelled 29 because several awaited deadline/lifecycle promises relied only on unreferenced timers. Node 22 allowed the event loop to exit before those promises settled.

This was a real supported-runtime release blocker. It did not indicate a missing browser feature.

## T15.4 implementation

- Kept browser evaluation and graceful-shutdown deadline timers referenced until their awaited promises settle.
- Kept Quick and Named Tunnel polling sleeps referenced until their awaited operations settle.
- Replaced Cloudflared download use of `AbortSignal.timeout()` with an explicit referenced `AbortController` timer while preserving the bounded timeout and error behavior.
- Added `.github/workflows/ci.yml` with a `macos-14` matrix for Node 22 and Node 26 running `npm ci`, typecheck, full tests, and build.
- Added T15.4 to the canonical plan and synchronized SPEC, CHANGELOG, repository map, and this handoff.
- No browser feature, public tool schema, security boundary, dependency, package command, tunnel policy, or certification claim was expanded.

## RED/GREEN evidence

```text
RED — Node v22.23.1 complete suite before correction
pass 185
cancelled 29
exit 1

RED isolation
browser: pass 14/19, cancelled 5
cloudflare: pass 6/30, cancelled 24

GREEN — Node v22.23.1 targeted browser suite
pass 19/19
cancelled 0

GREEN — Node v22.23.1 targeted Cloudflare suite
pass 30/30
cancelled 0

GREEN — Node v22.23.1 complete gate
npm run typecheck: PASS
npm test: PASS — 214/214
npm run build: PASS
```

## Core MCP status

The core release path remains implemented and covered:

- endpoint-bound Streamable HTTP MCP and OAuth
- exactly seven public Loom tools
- unrestricted noninteractive terminal jobs and process-group cleanup
- text/image read, atomic write, and exact edit
- skills catalog and Loom-owned memory
- owner-password persistence and explicit reset
- loopback dashboard and foreground runtime lifecycle
- Quick Tunnel testing path and Named Tunnel production path

Browser behavior was not expanded during T15.4. The existing browser implementation remains in place and its deterministic suite also passes on Node 22.

## Remaining real blockers

- G5: real stable Named Tunnel, DNS/public `/mcp`, eligible ChatGPT account/workspace, and public OAuth discovery.
- G6: real ChatGPT authorization, representative calls across all seven tool categories, refresh/reconnect, public-access termination, and process-table cleanup evidence.
- T16: clean supported-Mac package install, real browser profile persistence, owner-password lifecycle, sleep/wake, connector persistence, sanitized committed evidence, and human review.
- G7 remains blocked until those external/manual gates pass. Deterministic local success is not production certification.

## Files changed in T15.4

- `.github/workflows/ci.yml`
- `CHANGELOG.md`
- `HANDOFF.md`
- `REPO_MAP.md`
- `SPEC.md`
- `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- `src/browser/backend.ts`
- `src/cloudflare.ts`

## Exact next command: owner live test

```bash
cd /Users/aashu/loom && npm run build && node dist/src/cli.js launch --yolo
```

The owner should now exercise the foreground launch, copy the printed public `/mcp` endpoint, authorize through the owner-password flow, and call the core MCP tools. G5/G6 evidence must still be collected before a production-certification claim. Do not push, publish, or deploy until the user explicitly authorizes it.