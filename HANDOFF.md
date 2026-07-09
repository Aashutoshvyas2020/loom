# Loom Implementation Handoff

**Date and local time:** 2026-07-08 23:26 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**Base SHA before T15.5:** `d8261ba48133b77b5fdb6b87bffe7dafa4ac20f4`
**Current task:** T15.5 real ChatGPT OAuth interoperability
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Failure reproduced

The named tunnel registered and Loom printed `Connector: ready`, but ChatGPT rejected the public MCP URL as not implementing OAuth. Comparing Loom with the already working DevSpace server identified three compatibility problems:

1. Loom applied localhost-only Host validation globally, so Cloudflare-forwarded requests using the public hostname were rejected before OAuth discovery routes ran.
2. DevSpace and the pinned MCP SDK support public OAuth clients using `token_endpoint_auth_method=none`; Loom supported only `client_secret_post`.
3. Loom required a nonstandard `TunnelName` field in Cloudflare credentials and rejected Cloudflare's standard optional `Endpoint` field.

## T15.5 implementation

- Host validation now allows loopback and, after endpoint binding, only the exact canonical public resource hostname. Other hosts remain 403.
- OAuth metadata and DCR now support both `client_secret_post` and public-client `none`.
- Authorization-code exchange, refresh, and revocation work for both methods.
- Endpoint/resource binding, PKCE S256, rotating refresh tokens, authorization throttling, and the server-side authorization transaction remain unchanged.
- Named-tunnel credentials now accept Cloudflare's standard fields: `AccountTag`, `TunnelSecret`, `TunnelID`, and optional string `Endpoint`; the file must be named `<TunnelID>.json` and match the origin-certificate account.
- The canonical plan, specification, changelog, repository map, and tests are synchronized.

## RED/GREEN evidence

```text
RED — raw public Host discovery: expected 200, received 403
RED — authorization metadata omitted token method none
RED — public-client DCR: expected 201, received 400
GREEN — public Host / hostile Host / metadata / public DCR: 3/3
GREEN — integrated OAuth + MCP + Cloudflare: 52/52
```

## Current external state

- DevSpace is running at `devspace.aashutoshvyas.com` and provides the current control channel.
- Loom should use a dedicated named tunnel and `loom.aashutoshvyas.com`; sharing one tunnel between DevSpace and Loom can split traffic.
- Rotate the local owner credential before final authorization because an earlier value was exposed in conversation.

## Completed local gates

- Exact repository-map equality: PASS for all 75 tracked files.
- Active runtime: typecheck PASS, tests 216/216, build PASS.
- Node v22.23.1: typecheck PASS, tests 216/216, build PASS.
- Package dry run: 90 approved files, 195236 bytes.
- Diff check: PASS.
- Loom-owned process residue: none.

## Remaining gates

- Commit T15.5 and record the exact implementation SHA.
- Create the dedicated `loom` named tunnel and DNS route, update `~/.loom/config.json`, rotate the owner credential locally, and launch Loom in a visible terminal.
- Verify public OAuth discovery, complete the real ChatGPT connector flow, refresh/reconnect, and representative core tool calls.
- G6/G7 remain blocked until that real evidence exists.

## Exact next command

```bash
cd /Users/aashu/loom && git add CHANGELOG.md EXTERNAL_AUDIT.md HANDOFF.md REPO_MAP.md SPEC.md docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt src/cloudflare.ts src/mcp.ts src/oauth.ts test/cloudflare.test.ts test/mcp.test.ts test/oauth.test.ts
```

Do not push, publish, or claim production certification before the real ChatGPT evidence is complete and publication is explicitly authorized.
