# Loom Implementation Handoff

**Date and local time:** 2026-07-08 17:56:03 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA before pending commit:** `672ea96578cc3ebe7b42e29c9f7e700a631b317c`
**Repository state:** dirty only with completed T13 implementation and same-commit governance
**Current task:** T13 — Named Tunnel
**Last completed gate:** final full typecheck, 158/158 tests, clean build, 38-test T13 target, and delayed Loom-owned process-residue scan are green
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Completed work

- Added strict named-tunnel config validation and canonical lowercase stable hostnames; rejects `trycloudflare.com`, option-like/trimmed/control-containing names, and names over 128 characters.
- Added stable current-user private regular-file reads for the origin certificate and current credentials JSON, including no-symlink/TOCTOU checks, permission/mode/size bounds, and identity rechecks.
- Validates the origin-certificate `ARGO TUNNEL TOKEN` and exactly `AccountTag`, `TunnelSecret`, `TunnelID`, and `TunnelName`; enforces certificate-account and configured-name matching, canonical 32-byte secret base64, and UUID tunnel ID.
- Added `NamedTunnelManager` on the existing verified direct Cloudflared boundary with explicit `--origincert`, `run --url <bare-loopback-origin>`, `--credentials-file`, and tunnel-name argv.
- Withholds public endpoint and production eligibility until a registered connection is observed within the 15-second readiness deadline.
- Fails immediately on static validation, audit-start, auth, or Cloudflared configuration errors. A benign missing-persistent-config notice remains allowed.
- Retries only transient spawn/edge/readiness failures at most five times with one-second exponential backoff capped at 60 seconds, complete process cleanup, and fresh certificate/credential validation before every attempt.
- Never falls back to Quick Tunnel and never uses persistent ingress as Loom's origin mapping.
- Fails closed when process cleanup is uncertain; an uncleaned process blocks restart.
- Added lifecycle-version plus `AbortController` cancellation so stop wakes readiness/backoff immediately, cancels exactly once, prevents recreation, and remains idempotent.
- Keeps tunnel name, hostname, endpoint, auth paths/values, certificate fields, and Cloudflared output out of audit records.
- Proved stable canonical-hostname restart preserves OAuth generation; a hostname change increments generation and invalidates endpoint-bound state without rotating the persistent owner password.
- Cleanly reconciled concurrent-agent additions for per-attempt auth revalidation, cleanup-failure behavior, hidden pre-ready status, benign config notices, option-like names, and stop-during-startup. Removed a duplicate waiter cancellation path in favor of the single concurrent-agent `AbortController` implementation.
- Updated `SPEC.md`, the canonical plan, central limits, changelog, repository map, and this handoff.

## Required RED evidence

- Initial named validation/manager tests failed because no named APIs, errors, manager, or central constants existed.
- Config tests failed because `trycloudflare.com`, option-like names, and silent hostname casing were accepted.
- Status regression failed because named mode reported production eligibility before registration.
- Adversarial tests exposed missing per-retry credential revalidation and cleanup-failure fail-closed behavior.
- Startup-stop regression first failed with a 15-second readiness timeout, proving stop did not prevent the pending startup loop from continuing.
- Prompt-stop regression then failed as `pending`, proving the readiness/backoff sleep was not interruptible until `AbortController` cancellation was added.

## Exact commands and results

```text
node --test --test-name-pattern='Named Tunnel' dist/test/cloudflare.test.js
PASS — 13/13 named tests

node --test dist/test/cloudflare.test.js dist/test/config.test.js dist/test/limits.test.js
PASS — 38/38

npm run typecheck
PASS

npm test
PASS — 158/158

npm run build
PASS

post-suite delayed Loom-owned process scan
<no matching child-wrapper, loom-process, loom-cloudflared, loom-named, loom-quick, repository Cloudflared, target, or grandchild processes>

unrelated pre-existing infrastructure (not touched)
cloudflared tunnel run devspace
parent: node /opt/homebrew/bin/devspace launch devspace
executable: /opt/homebrew/Cellar/cloudflared/2026.6.1/bin/cloudflared
```

## Known failures

None currently reproducible in deterministic T0–T13 validation.

## Real blockers

- T14 full runtime orchestration is not implemented.
- G5/G6 still require a real named Cloudflare tunnel, eligible ChatGPT custom-connector account/workspace, real OAuth/tool calls, and process/public-access cleanup evidence.
- Deterministic T13 tests do not certify production by themselves.

## Files changed

- `CHANGELOG.md`
- `HANDOFF.md`
- `REPO_MAP.md`
- `SPEC.md`
- `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- `src/cloudflare.ts`
- `src/config.ts`
- `src/limits.ts`
- `test/cloudflare.test.ts`
- `test/config.test.ts`
- `test/limits.test.ts`

## Exact next command

```bash
git add CHANGELOG.md HANDOFF.md REPO_MAP.md SPEC.md docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt src/cloudflare.ts src/config.ts src/limits.ts test/cloudflare.test.ts test/config.test.ts test/limits.test.ts && git diff --cached --check && git commit -m "feat: add named tunnel"
```

## Next expected result

Commit T13 as one clean implementation/governance unit. Then begin T14 by writing the first failing integrated runtime lifecycle test for exact startup order, reverse-order cleanup, runtime lock ownership, signal stop, and public-access termination.
