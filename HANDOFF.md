# Loom Implementation Handoff

**Date and local time:** 2026-07-08 00:46:43 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA:** `2d212c20c8bac3efb012943922a4fe1e308cfd5e`
**Repository state:** dirty; completed T4 OAuth/auth-reset changes are not yet committed
**Current task:** T4 — OAuth and endpoint-bound state
**Last completed gate:** G2
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Commands run for T4

```bash
npm run build
npm run build && node --test dist/test/oauth.test.js
npm run build && node --test dist/test/cli.test.js
ps -axo pid,ppid,pgid,command | grep -E 'dist/test/cli.test.js|dist/src/cli.js auth reset|/usr/bin/expect' | grep -v grep
kill -TERM -68593; kill -KILL -68593
/usr/bin/expect -d -c '<config reset trace>'
node /private/tmp/loom-old-confirm.mjs
node /private/tmp/loom-fixed-confirm.mjs
node /private/tmp/loom-direct-confirm.mjs
npm run build && node --test dist/test/cli.test.js
node --test dist/test/oauth.test.js dist/test/cli.test.js
npm run typecheck && npm test && npm run build
```

## Results

- T3 was committed cleanly at `2d212c20c8bac3efb012943922a4fe1e308cfd5e`.
- T4 began test-first. Required OAuth RED: build failed because `src/oauth.ts` did not exist.
- Added persistent private OAuth state with a scrypt owner credential and hashed client/code/access/refresh secrets.
- Owner password is created once, returned only on first installation creation, and remains unchanged across reopen and endpoint lifecycle.
- Endpoint binding requires the exact public HTTPS URL ending `/mcp`. A changed endpoint increments generation and atomically revokes clients, codes, access tokens, refresh tokens, and pending transactions without rotating the owner password.
- Added dynamic registration, registered redirect validation, fixed scopes, owner-password authorization, mandatory S256 PKCE, single-use expiring codes, access-token validation, rotating refresh tokens, replay prevention, expiry, revocation, and exact metadata.
- Added `loom auth reset`. It refuses a live matching runtime lock before local confirmation, rechecks afterward, rotates only the owner credential, revokes OAuth state, and preserves endpoint/config/memory/browser state.
- Confirmation and password output use bounded direct `/dev/tty` FileHandle I/O. A detached `setsid()` child proves there is no non-terminal fallback.
- The first shared readline/stream terminal helper deadlocked after receiving confirmation. Expect debug traces showed the prompt matched and input arrived, but stream/descriptor shutdown never completed. Isolated tests confirmed the issue. Replacing streams with direct bounded descriptor reads/writes fixed it.
- One connector-interrupted CLI run left an isolated test PGID. It was identified with `ps`, terminated, and subsequent tests left no known test processes.
- Targeted OAuth validation: 8 passed, 0 failed.
- Targeted CLI validation: 8 passed, 0 failed.
- Combined T4 validation: 16 passed, 0 failed.
- Full validation: typecheck passed, full tests passed 57/57, build passed.

## Known failures

None in T4 automated validation.

## Real blockers

None.

## Files changed since HEAD

- `CHANGELOG.md`
- `HANDOFF.md`
- `REPO_MAP.md`
- `src/cli.ts`
- `src/oauth.ts`
- `test/cli.test.ts`
- `test/oauth.test.ts`

## Exact next command

```bash
git add CHANGELOG.md HANDOFF.md REPO_MAP.md src/cli.ts src/oauth.ts test/cli.test.ts test/oauth.test.ts && actual=$(mktemp) && mapped=$(mktemp) && git ls-files | sort > "$actual" && grep '^### `' REPO_MAP.md | sed -E 's/^### `([^`]*)`$/\1/' | sort > "$mapped" && comm -3 "$actual" "$mapped" && git diff --cached --check && rm -f "$actual" "$mapped"
```

## Next expected result

The staged index and repository map match exactly with no diff-check errors. Commit T4, verify a clean repository, then begin T5 test-first with a loopback Streamable HTTP MCP listener that remains deterministically NOT_READY until endpoint-bound OAuth is configured, publishes path-correct metadata/challenges, manages bounded sessions, and registers exactly seven tools.
