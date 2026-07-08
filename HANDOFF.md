# Loom Implementation Handoff

**Date and local time:** 2026-07-08 01:26:39 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA:** `e11ee08d0172447d90adbcc93f8a706b9ba95877`
**Repository state:** dirty; completed T5 MCP transport/tool-registry changes are not yet committed
**Current task:** T5 — MCP transport and seven-tool registration
**Last completed gate:** G2
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Commands run for T5

```bash
find node_modules/@modelcontextprotocol/sdk/dist ...
grep/read pinned Streamable HTTP, Express, bearer, metadata, server, and client examples/types
npm run build
node --test dist/test/mcp.test.js
node --input-type=module '<stale-token HTTP reproduction>'
npm run typecheck && npm test && npm run build
ps -axo pid,ppid,pgid,command | grep -E 'dist/test/mcp.test.js|loom-mcp-|dist/src/mcp.js' | grep -v grep
```

## Results

- T4 was committed cleanly at `e11ee08d0172447d90adbcc93f8a706b9ba95877`.
- T5 began test-first. Required RED: build failed because `src/mcp.ts` and `src/tools/register.ts` did not exist.
- Added a loopback-only HTTP server using the pinned MCP SDK’s stateful Streamable HTTP transport.
- `/mcp` returns deterministic structured `NOT_READY` before a public resource is bound.
- After binding, the server publishes path-correct protected-resource metadata, authorization-server metadata, and bearer challenges containing the public metadata URL.
- Added HTTP OAuth registration, authorization form/POST, code exchange, refresh, replay prevention, authenticated revocation, and no-store responses over the T4 AuthStore.
- Added exactly seven tools with strict Zod schemas and an injected dispatcher: terminal, read, write, edit, skills, memory, browser.
- Browser schemas reject dangerous `javascript:` and `file:` URL schemes; permission/geolocation inputs require bare HTTP(S) origins.
- Sessions validate ID format, bind to the initiating OAuth client, enforce capacity including concurrent pending initializations, track active requests, reap only inactive sessions, and close on shutdown or endpoint change.
- Rebinding the same endpoint preserves sessions. Changing endpoint closes sessions, updates metadata/challenges, and invalidates old tokens.
- A real SDK client listed exactly seven tools and called every schema safely.
- The endpoint-change test found a real pinned SDK middleware bug: stale-token verification yielded a 500 because its catch path dereferenced an undefined error. A standalone HTTP reproduction confirmed the failure was inside that middleware, not AuthStore. Loom replaced only the bearer boundary with a defensive equivalent that preserves the standard challenge and `req.auth`; stale/revoked tokens now return 401.
- The pinned SDK also has a TypeScript 6 exact-optional transport incompatibility; a narrow cast to its own `Transport` interface is documented in production and tests.
- Targeted MCP validation: 9 passed, 0 failed.
- Full validation: typecheck passed, full tests passed 66/66, build passed.
- Post-suite process scan produced no output for MCP test processes/listeners.

## Known failures

None in T5 automated validation.

## Real blockers

None.

## Files changed since HEAD

- `CHANGELOG.md`
- `HANDOFF.md`
- `REPO_MAP.md`
- `src/mcp.ts`
- `src/oauth.ts`
- `src/tools/register.ts`
- `test/mcp.test.ts`

## Exact next command

```bash
git add CHANGELOG.md HANDOFF.md REPO_MAP.md src/mcp.ts src/oauth.ts src/tools/register.ts test/mcp.test.ts && actual=$(mktemp) && mapped=$(mktemp) && git ls-files | sort > "$actual" && grep '^### `' REPO_MAP.md | sed -E 's/^### `([^`]*)`$/\1/' | sort > "$mapped" && comm -3 "$actual" "$mapped" && git diff --cached --check && rm -f "$actual" "$mapped"
```

## Next expected result

The staged index and repository map match exactly with no diff-check errors. Commit T5, verify a clean repository, then begin T6 test-first with bounded file/image reads, stable hashes and MIME metadata, atomic writes, exact edit conflicts, path/symlink defenses, and audit-before-mutation integration.
