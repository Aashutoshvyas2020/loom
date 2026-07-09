# Loom Implementation Handoff

**Date and local time:** 2026-07-08 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA before pending T15.3 commit:** `82412ef4753ba2bff4ea8e47d7cc52a13a0460ce`
**Repository state:** dirty only with completed T15.3 adversarial hardening, tests, evidence, public threat-model updates, regenerated audit dossier, and synchronized governance
**Current task:** T15.3 complete locally; commit pending
**Last completed gate:** typecheck, 214/214 tests, build, ten-run transient-EPERM stress, exact 74-file map/dossier coverage, 22 embedded-source hash checks, 90-file package inspection, isolated tarball installation, supported secret scan, and empty Loom-owned residue scan
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## T15.3 completed work

- Treated all five supplied adversarial reviews as hypotheses and verified consolidated claims against source, the pinned MCP SDK, tests, or controlled local experiments.
- Added `docs/release-evidence/t15.3-adversarial-review.md` with verified/fixed, verified/residual, false-positive/already-mitigated, and intentional-scope classifications.
- Replaced the SDK helper's unbounded JSON parser with explicit localhost Host validation, a pre-SDK 9 MiB MCP body limit, 64 KiB OAuth metadata parsers, and structured 413/400 responses.
- Added monotonic owner-password authorization throttling: ten attempts per 60-second foreground-process window with 429 and `Retry-After`.
- Changed new owner verifiers to scrypt N=32768, r=8, p=3 with explicit memory bounds and transparent atomic migration after successful legacy N=16384, r=8, p=1 verification.
- Added one absolute 30-day refresh-token family expiration across rotation.
- Added fixed C locale, bounded output, and two-second hard timeout to all watchdog `ps`/`lsof` probes.
- Serialized wrapper identity probes, converted wrapper heartbeat age to monotonic time, and distinguished confirmed parent mismatch from temporary process-table unavailability.
- Converted runtime, ProcessManager, dashboard, and MCP session in-process deadlines to monotonic time.
- Canonicalized only macOS `/tmp` and `/var` aliases to `/private/tmp` and `/private/var`.
- Opened final read targets with `O_NONBLOCK | O_NOFOLLOW` before regular-file verification to prevent FIFO/device hangs.
- Rechecked exact memory-tombstone identity immediately before removal.
- Made runtime-lock creation explicitly `O_CREAT | O_EXCL | O_NOFOLLOW`.
- Kept terminal start and capability-increasing browser work audit-fail-closed, while preserving terminal cancellation and browser-tab close as best-effort-audited containment actions.
- Added OSC 52 stripping coverage, a bounded 256 KiB hostile Quick Tunnel parser case, wall-clock-jump dashboard coverage, body-limit/rate-limit/scrypt/refresh/FIFO/tombstone/watchdog regressions, and updated exact limits.
- Controlled output-flood experiment: 64 MiB terminal output completed normally in about 323 ms without false watchdog termination or residue.
- Controlled deliberate-session-escape experiment: a child launched with `start_new_session=True` survived owned-PGID cancellation, was explicitly killed, and is now documented as outside the cleanup guarantee.
- Expanded README, SPEC, security, operator, development, release-certification, release-evidence, and external-audit guidance for prompt injection, provider disclosure, persistent state, login-shell secrets, TCC, LAN pivoting, local-only containment, non-forensic audit, process escape, storage durability, retention, password scrollback, and artifact trust.

## RED/GREEN evidence

```text
MCP body limit RED
new test failed before the explicit pre-SDK parser existed
GREEN: structured 413 and zero sessions

authorization throttle RED
new setup options/behavior absent
GREEN: two attempts accepted in test window, third 429, accepted after monotonic expiry

owner scrypt migration / refresh family RED
new parameters and family expiration absent
GREEN: legacy hash upgraded after correct owner authorization; refresh at day 29 cannot rotate after day 30

watchdog RED
runWatchdogCommand export absent
GREEN: fixed C locale and SIGKILL timeout

FIFO read / macOS aliases / safety cancellation / tombstone identity
new expectations failed or were absent before production changes
GREEN in focused suite

documentation RED
security/operator residual-risk test failed first on missing prompt-injection disclosure
GREEN: docs target passes
```

## Exact final commands and results so far

```text
mandatory startup gate at 82412ef
npm ci
PASS — 106 packages, 0 vulnerabilities
npm run typecheck
PASS
npm test
PASS — 205/205 baseline
npm run build
PASS
repository map
PASS — 73/73 before T15.3 edits

focused hardening target
PASS — 68/68

dashboard/runtime/process monotonic target
PASS — 31/31

browser/terminal containment target
PASS — 27/27

transient EPERM isolated stress after wrapper fix
PASS — 10/10

complete current gate
npm run typecheck
PASS
npm test
PASS — 214/214
npm run build
PASS

npm pack --dry-run --json
PASS — 90 files, 194258 bytes
forbidden internal paths: none

actual hardened tarball
loom-mcp-0.1.0.tgz
bytes: 194258
SHA-256: 31c0f309a0bb94d3b974a852f0510282898ec5087c98f1229fe94c8203f1a491

isolated prefix/HOME install
loom --version: 0.1.0
loom --help: PASS
loom-certify --help: PASS
plain launch: exit 2
sessionless YOLO launch: exit 2
state created: no
```

## Review classification highlights

Already mitigated or false-positive claims include loopback CDP binding, cryptographic OAuth transaction and job IDs, 0600 config backup, launch-time Cloudflared re-verification, absence of public `z.coerce`, exact environment-key grammar, OSC 52 passage, Quick-parser ReDoS, `--` tunnel-name injection, active-request decrement without `finally`, and hard-link overwrite through atomic rename.

Verified residual risks now disclosed include indirect prompt injection/cross-tool escalation, authorized-client/provider data exposure, persistent browser/memory/artifacts, login-shell/inherited secrets, macOS TCC, localhost/private-network pivoting, local-only incident containment, privacy-oriented non-forensic audit, deliberate `setsid()` escape, finite process-identity precision, local-filesystem/power-loss assumptions, operator-managed retention, terminal scrollback, and no out-of-band package-signing root.

## Known failures and corrections

- The first T15.3 full suite reached 213/214. The transient-EPERM escalation test intermittently observed no SIGKILL retry because overlapping wrapper fallback probes and transient bounded `lsof` failure could trigger false orphan cleanup while heartbeats were healthy.
- Root correction serialized wrapper identity probes, used monotonic heartbeat age, and distinguished `unknown` observation from `mismatch`. The isolated test then passed ten consecutive runs and the full suite passed 214/214.
- The deliberate process-session escape is not a failed test or claimed fix; it is an experimentally verified residual limitation.

## Real blockers

- G5 requires an eligible current ChatGPT workspace/account, a real stable Named Tunnel, real DNS/public `/mcp` routing, and public OAuth discovery.
- G6 requires real ChatGPT authorization, all seven real tool categories, access-token refresh/reconnect, public-access termination, and process tables for Ctrl+C, SIGTERM, terminal close, and forced parent death.
- T16 still requires remaining manual sleep/wake, connector persistence, real owner-password lifecycle, clean supported-Mac evidence, sanitized committed external artifacts, and human review.
- G7 remains blocked. T15.3 does not turn residual unrestricted-agent risks into mitigations and does not grant production certification.

## Files changed

- `CHANGELOG.md`
- `EXTERNAL_AUDIT.md`
- `HANDOFF.md`
- `README.md`
- `REPO_MAP.md`
- `SPEC.md`
- `docs/DEVELOPMENT.md`
- `docs/OPERATOR.md`
- `docs/RELEASE_CERTIFICATION.md`
- `docs/SECURITY.md`
- `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- `docs/release-evidence/README.md`
- `docs/release-evidence/t15.3-adversarial-review.md`
- `src/child-wrapper.ts`
- `src/dashboard.ts`
- `src/limits.ts`
- `src/mcp.ts`
- `src/oauth.ts`
- `src/paths.ts`
- `src/process-manager.ts`
- `src/runtime.ts`
- `src/tools/browser.ts`
- `src/tools/files.ts`
- `src/tools/memory.ts`
- `src/tools/terminal.ts`
- `src/watchdog.ts`
- `test/browser.test.ts`
- `test/cloudflare.test.ts`
- `test/dashboard.test.ts`
- `test/docs.test.ts`
- `test/files.test.ts`
- `test/limits.test.ts`
- `test/mcp.test.ts`
- `test/memory.test.ts`
- `test/oauth.test.ts`
- `test/output.test.ts`
- `test/paths.test.ts`
- `test/terminal.test.ts`
- `test/watchdog.test.ts`

## Final dossier and integrity evidence

```text
EXTERNAL_AUDIT.md represented files: 74
static test declarations: 214
embedded canonical sources: 22
missing mapped paths: none
package files: 90
package bytes: 194258
supported secret findings: none
Loom-owned process residue: none
```

## Exact next command

```bash
git add CHANGELOG.md EXTERNAL_AUDIT.md HANDOFF.md README.md REPO_MAP.md SPEC.md docs src test && git diff --cached --check && git commit -m "fix: harden adversarial security boundaries"
```

## Next expected result

A single clean T15.3 local commit with the regenerated 74-file audit dossier, 214/214 tests, unchanged 90-file public allowlist, exact hardened tarball evidence, no secrets or Loom-owned residue, and all external/manual certification gates still honestly blocked. No push, publication, or deployment.