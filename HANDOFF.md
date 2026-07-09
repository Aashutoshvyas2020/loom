# Loom Implementation Handoff

**Date and local time:** 2026-07-08 17:37:06 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA before pending amend:** `57cb57a62195758d9402702074333ec0dbd41f08`
**Repository state:** dirty only with the reviewed T12.1 test-isolation follow-up and same-commit governance
**Current task:** T12.1 — transient process-group signal hardening
**Last completed gate:** process-manager/watchdog 12-test target and delayed process-residue scan are green after the concurrent refinement
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Completed work

- Promoted the repeated negative-PGID `SIGKILL` `EPERM` into an explicit release-blocking T12.1 plan amendment before T13.
- Added deterministic transient and persistent `EPERM` real-process regressions while a managed target ignores `SIGTERM`.
- Replaced the former single-attempt signal path with an owned-group signal helper.
- Preserved `ESRCH` as already-gone.
- On `EPERM`, revalidates the recorded wrapper PID/start-time/executable identity and current process-group membership before retrying.
- Uses only the existing absolute shutdown deadline as the retry bound; persistent `EPERM` fails closed.
- Preserved cancelled results and complete process-group cleanup after a transient error.
- Reviewed concurrent agent work rather than overwriting it. Removed its unapproved fixed three-retry policy because the existing deadline is the canonical bound.
- Preserved a later concurrent refinement that isolates signal-fault injection from global `process.kill`; simplified the draft system-call object/interface to one optional constructor function.
- Updated the specification, canonical plan, changelog, repository map, and handoff.

## Exact commands and results

```text
npm run build && node --test --test-name-pattern='EPERM' dist/test/process-manager.test.js
PASS — 2/2

npm run build && node --test dist/test/process-manager.test.js dist/test/watchdog.test.js
PASS — 12/12 after isolated signal injection

npm run typecheck
PASS

npm test
PASS — 145/145 before the test-isolation amend

npm run build
PASS

post-suite delayed process scan
<no matching wrapper, target, or grandchild processes>

REPO_MAP tracked-path comparison
<no output>
```

## RED evidence

The deterministic transient regression failed under the inherited implementation with raw `Error: kill EPERM` from the single-attempt negative-PGID signal call. The persistent regression also failed with the same unwrapped error. Intentional failing runs initially exposed test cleanup residue; the harness now forcibly removes only its known test group. The later test-isolation refinement changes no production behavior.

## Known failures

None currently reproducible in T0–T12.1 deterministic validation.

## Real blockers

None for T12.1. T13 remains unimplemented and must add named-tunnel stable-hostname validation, origin-certificate and matching credential validation, explicit ephemeral origin mapping, no Quick fallback, transient retry classification, capped exponential backoff, and auth/config fail-fast behavior.

## Files changed since `57cb57a`

- `CHANGELOG.md`
- `HANDOFF.md`
- `REPO_MAP.md`
- `src/process-manager.ts`
- `test/process-manager.test.ts`

## Exact next command

```bash
npm run typecheck && npm test && npm run build && git diff --check && git add CHANGELOG.md HANDOFF.md REPO_MAP.md src/process-manager.ts test/process-manager.test.ts && git diff --cached --check && git commit --amend --no-edit
```

## Next expected result

Amend the unpushed T12.1 commit with isolated deterministic signal injection, verify a clean tree, then begin T13 with a failing named-tunnel test for strict hostname, origin-certificate, and matching credential validation before process launch.
