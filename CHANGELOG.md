# Changelog

All notable implementation and governance changes are recorded here with command evidence.

## 2026-07-07

### T0 — repository initialization (in progress)

- Initialized `/Users/aashu/loom` as a fresh Git repository on `planning/loom-v1-cavekit`.
- Created the required Cavekit governance artifacts and initial package metadata.
- Pinned runtime dependencies after querying the npm registry: MCP SDK 1.29.0, Express 5.2.1, Zod 4.4.3, Playwright Core 1.61.1.
- Local toolchain observed: Node v26.0.0, npm 11.12.1. The package contract remains Node 22+.
- No code, external tunnel, OAuth, ChatGPT integration, package publication, push, or deployment has been claimed or performed.

Validation and commit evidence will be added before T0 is marked complete.

### G0 — governance baseline prepared

- Restored the full canonical implementation plan at `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt` and incorporated the independent audit corrections.
- Made `loom launch --yolo` the sole unrestricted launch path; plain `loom launch` must not start listeners.
- Locked the production floor to macOS 14+ and preserved Node.js 22+.
- Added fail-closed MCP startup, exact `/mcp` endpoint-bound OAuth, refresh-token rotation, wrapper-owned Chromium, `cloudflared --no-autoupdate`, named-tunnel ephemeral origin routing, and precise watchdog/shutdown deadlines to the approved baseline.
- Generated `package-lock.json` with exact direct versions. `npm install` added 106 packages and reported zero vulnerabilities.
- Removed the incomplete `.transfer/part-0.b64` fragment and temporary `docs/plans/transfer-test.txt` file; neither belongs in the tracked repository.
- Created exhaustive `REPO_MAP.md` for the intended G0 tracked baseline. Production source remains intentionally absent until G0 is committed.

Evidence:

```text
npm ls --depth=0
@modelcontextprotocol/sdk@1.29.0
express@5.2.1
playwright-core@1.61.1
zod@4.4.3
typescript@6.0.3
@types/node@26.1.0
@types/express@5.0.6

wc -l ALGORITHM.md
17 ALGORITHM.md
```

## 2026-07-08

### G0 — governance baseline complete

- Committed the exact thirteen-file governance baseline at `868d20d2d2cf17bef2992abe6b95d9d4152cd223`.
- Staged-index paths and `REPO_MAP.md` paths matched with an empty `comm -3` result.
- `git diff --cached --check` returned no errors.
- Repository was clean immediately after the commit.

### T0 — minimum CLI/package bootstrap

- Added a real subprocess test before production code.
- Initial test compilation failed because Node types were not explicitly loaded; added `types: ["node"]` to `tsconfig.json` and reran.
- Required RED then failed because `dist/src/cli.js` did not exist: metadata test passed and three CLI behavior tests failed as expected.
- Added the minimum `src/cli.ts` implementation for `--version`, `--help`, and refusal of plain `loom launch` with the explicit `loom launch --yolo` instruction.
- Targeted GREEN: 4 tests passed, 0 failed.
- Full clean-install validation passed: `npm ci`, typecheck, full tests, and build; npm reported zero vulnerabilities.

Evidence:

```text
node --test dist/test/cli.test.js
pass 4
fail 0

npm ci
added 106 packages, audited 107 packages
found 0 vulnerabilities

npm run typecheck
PASS
npm test
PASS (4/4)
npm run build
PASS
```

### T1 — central limits and path-policy foundation

- Added the approved central limits as one dependency-free module.
- Added absolute/`~/` path resolution with rejection of empty input, bare relative paths, alternate-user home syntax, NUL bytes, and malformed UTF-16 surrogate sequences.
- Added real `lstat` component walking for mutating paths: existing symbolic-link parents and final symlinks are rejected, non-directory intermediate components fail, and a missing tail beneath real directories is allowed for later atomic creation.
- Required RED: TypeScript failed because `src/limits.ts` and `src/paths.ts` did not exist.
- First GREEN attempt exposed one production bug and two test-platform issues: an unmatched high surrogate was not rejected because `charCodeAt` returned `NaN`; ESM namespace objects have a null prototype; and macOS `/var` is itself a symlink to `/private/var`.
- Fixed the Unicode check and canonicalized test temporary roots with `realpath` without weakening the production symlink policy.
- Targeted GREEN: 5/5 tests passed.
- Full validation: typecheck, 9/9 tests, and build passed.

Evidence:

```text
node --test dist/test/limits.test.js dist/test/paths.test.js
pass 5
fail 0

npm run typecheck
PASS
npm test
PASS (9/9)
npm run build
PASS
```

### T1 — atomic-file primitive

- Added a same-directory atomic writer with per-canonical-path serialization.
- New files default to mode 0600; existing regular-file mode is preserved.
- Content is capped by `MAX_WRITE_BYTES`, temporary files use exclusive creation, file data and the parent directory are synced, and uncommitted temporary files are removed on failure.
- Existing symbolic-link components and non-regular targets are rejected through the shared path policy.
- Optional expected SHA-256 detects stale callers. Target identity is rechecked immediately before rename so external replacement or mutation fails closed.
- Required RED: build failed because `src/atomic-file.ts` did not exist.
- Targeted GREEN: 5/5 real-filesystem tests passed, including a concurrency proof where two writers share the same expected hash and exactly one succeeds.
- Full validation: typecheck, 14/14 tests, and build passed.

Evidence:

```text
node --test dist/test/atomic-file.test.js
pass 5
fail 0

npm run typecheck
PASS
npm test
PASS (14/14)
npm run build
PASS
```

### T1 — secure state, configuration, and runtime-lock identity

- Added strict versioned configuration for Quick Tunnel and named-tunnel modes, with absolute/`~/` path validation, duplicate-root rejection, unknown-key rejection, and named-tunnel completeness checks.
- Added exact Loom state initialization for `audit`, `browser-profile`, `cloudflared`, `downloads/screenshots`, `memory`, and `runtime`; directories are 0700 and state files are 0600.
- Existing current-user permissions are repaired. Symbolic-link state roots, wrong file kinds, and wrong ownership fail closed.
- `checkConfig` validates without writing or changing timestamps.
- `resetConfig` preserves invalid original bytes to a timestamped private backup, then writes valid defaults atomically.
- Added strict private `runtime/loom.lock` read/write with PID, process start time, canonical executable, launch ID, and state path; identity matching requires every field.
- Wired `loom config check` and `loom config reset`; reset has no noninteractive bypass and requires typing `RESET` through `/dev/tty`.
- Required RED: build failed because `src/config.ts` did not exist. A later RED showed runtime-lock exports were absent, then CLI routing remained the sole failing behavior.
- A real PTY test initially failed because macOS Expect does not accept `spawn --`; debug output proved Node never launched. Removing the unsupported Expect flag made the unchanged Loom confirmation test pass.
- Targeted validation: 13/13 CLI/config tests passed, including a real pseudo-terminal reset and invalid-config backup.
- Full validation: typecheck, 23/23 tests, and build passed.

Evidence:

```text
node --test dist/test/cli.test.js dist/test/config.test.js
pass 13
fail 0

npm run typecheck
PASS
npm test
PASS (23/23)
npm run build
PASS
```

### T2 — bounded terminal output

- Added one ordered stream model for separately piped stdout and stderr.
- ANSI escape sequences and unsafe controls are stripped; invalid UTF-8 or NUL-containing chunks become deterministic binary-suppression markers.
- Output retains an exact UTF-8-safe head and tail within the configured byte budget.
- Cursor reads report requested cursor, first available cursor, next cursor, and an explicit gap when truncation makes a poll stale.
- Pagination preserves source ordering and makes progress without splitting a UTF-8 code point.
- Added running, completed, cancelled, and timed-out state with exit code and signal tracking.
- Required RED: build failed because `src/output.ts` did not exist.
- Targeted GREEN: 6/6 boundary tests passed.
- Full validation: typecheck, 29/29 tests, and build passed.

Evidence:

```text
node --test dist/test/output.test.js
pass 6
fail 0

npm run typecheck
PASS
npm test
PASS (29/29)
npm run build
PASS
```

### T2 / G2 — wrapper-owned process groups and watchdog cleanup

- Added live macOS process observation using `ps` for PID/PPID/PGID/start time and `lsof` for the canonical executable path.
- Identity checks require PID, start time, and executable path; PID-only matches are rejected.
- Added a detached child wrapper that receives launch configuration over IPC, launches the target without a PTY or usable stdin, forwards stdout/stderr, receives heartbeats, and independently scans the parent process table.
- Added a process manager with dedicated wrapper-led process groups, bounded output integration, timeout/cancellation, ownership validation, and exact TERM-to-KILL deadlines.
- Natural target completion still terminates background descendants left in the owned group.
- Cancellation kills targets and grandchildren. SIGTERM-resistant targets are escalated to SIGKILL after the soft grace period.
- A separate helper process was SIGKILLed in testing; the independent wrapper detected the missing parent and removed wrapper, target, and grandchild in under half a second.
- Initial natural-exit testing took 30 seconds because the child handle was not unreferenced; the test was corrected to genuinely detach the descendant and then completed in about 170 ms while proving cleanup.
- Required RED: build failed because `src/process-manager.ts` was absent. Earlier watchdog RED failed because `src/watchdog.ts` was absent.
- Targeted process/watchdog validation: 10/10 passed.
- Full validation: typecheck, 39/39 tests, and build passed.
- Post-suite process evidence found no `child-wrapper`, `loom-process`, or test `sleep` descendants.

Evidence:

```text
node --test dist/test/process-manager.test.js dist/test/watchdog.test.js
pass 10
fail 0

npm run typecheck
PASS
npm test
PASS (39/39)
npm run build
PASS

ps -axo pid,ppid,pgid,command | grep -E 'dist/src/child-wrapper|loom-process-|/bin/sleep 30' | grep -v grep
<no output>
```

### T3 — durable private audit system

- Added private JSONL audit logging under the configured audit directory, with 0700 directory repair and 0600 file enforcement.
- Mutation-start records resolve only after the record and directory entry are synced. The fixed deadline defaults to two seconds.
- Added a bounded serial queue with no silent drops. Saturation, deadline expiry, or write failure marks audit degraded and rejects later mutation starts.
- Read audit remains explicitly non-throwing after degradation so read-only functionality can stay available.
- Added start/finish receipts with operation ID, timestamp, status, and measured duration.
- Added serialized size rotation and fixed-window startup retention without touching unrelated files.
- Added recursive bounded metadata sanitization. Commands, content, environment, authorization, cookies, tokens, output, typed values, screenshots, page text, token-shaped values, circular data, and excessive depth are not persisted.
- Required RED: build failed because `src/audit.ts` did not exist.
- Targeted GREEN: 8/8 tests passed, including queue saturation, a one-millisecond durable-start deadline, removed-directory write failure, concurrent rotation, retention, and forbidden-literal checks.
- Full validation: typecheck, 47/47 tests, and build passed.

Evidence:

```text
node --test dist/test/audit.test.js
pass 8
fail 0

npm run typecheck
PASS
npm test
PASS (47/47)
npm run build
PASS
```

### T4 — persistent endpoint-bound OAuth and owner reset

- Added one private atomic `auth.json` state file with strict schema validation and optimistic cross-process conflict detection.
- Owner credentials use a fresh random password, salt, and Node `crypto.scrypt`; reopening the installation never rotates or reprints the password.
- OAuth clients, authorization codes, access tokens, and refresh tokens are stored only by SHA-256 hashes. Plain owner/client/code/token secrets are absent from persisted bytes.
- Added exact HTTPS resource binding to the canonical public URL ending `/mcp`. A changed endpoint increments the generation and invalidates clients, codes, access tokens, refresh tokens, and pending transactions while preserving the owner password.
- Added dynamic client registration, exact registered redirect matching, fixed supported scopes, owner-password-gated authorization, mandatory S256 PKCE, five-minute single-use codes, fifteen-minute access tokens, and thirty-day refresh tokens.
- Refresh rotates both access and refresh tokens, prevents replay, cannot change resource/client or expand scopes, and persists atomically.
- Added access validation, expiry, revocation, protected-resource metadata, authorization-server metadata, and owner reset that revokes OAuth state while preserving endpoint/config/memory/browser state.
- Wired `loom auth reset` with live runtime-lock verification against PID/start-time/canonical-executable identity. It checks before and after confirmation and refuses while Loom is running.
- Reset confirmation and the new password use direct bounded `/dev/tty` descriptor I/O. There is no stdin/environment/flag bypass, and the password is not written to process stdout or stderr.
- Required RED: OAuth build failed because `src/oauth.ts` did not exist. CLI RED then failed only because `auth reset` was unknown.
- During PTY testing, the first reusable readline abstraction deadlocked after successful input because long-lived `fs` streams over `/dev/tty` did not close reliably. Expect traces and isolated reproductions identified the boundary; direct FileHandle reads/writes exited cleanly and replaced the stream abstraction.
- Non-terminal tests use Python `setsid()` so `/dev/tty` genuinely does not exist instead of inheriting the test runner's controlling terminal.
- Targeted validation: OAuth 8/8, CLI 8/8, combined T4 16/16.
- Full validation: typecheck, 57/57 tests, and build passed.

Evidence:

```text
node --test dist/test/oauth.test.js dist/test/cli.test.js
pass 16
fail 0

npm run typecheck
PASS
npm test
PASS (57/57)
npm run build
PASS
```

### T5 — authenticated Streamable HTTP MCP and seven-tool registry

- Added a loopback-only Express server using the pinned MCP SDK’s stateful Streamable HTTP transport and per-session `McpServer` instances.
- `/mcp` is deterministically unavailable before endpoint binding and returns a structured `NOT_READY` error without advertising incomplete OAuth metadata.
- After binding, the server publishes exact path-aware protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`, authorization-server metadata, and an RFC bearer challenge pointing to the public metadata URL rather than the loopback listener.
- Added HTTP dynamic client registration, owner-password authorization form/POST, S256 code exchange, refresh rotation, replay rejection, authenticated token revocation, and no-store responses over the T4 atomic OAuth state engine.
- Added exactly seven public tools: `loom_terminal`, `loom_read`, `loom_write`, `loom_edit`, `loom_skills`, `loom_memory`, and `loom_browser`.
- Tool input uses strict Zod v4 schemas with action-specific fields, absolute/`~/` paths, central size limits, and browser URL restrictions that reject `javascript:` and `file:` navigation.
- Sessions are validated by format and bound to the OAuth client that initialized them. Unknown, malformed, cross-client, over-capacity, and missing-session requests return structured errors.
- Concurrent initialization reservations are counted before transport creation, so simultaneous requests cannot race past the session cap.
- Active request counts prevent the inactivity reaper from closing long-running calls. Inactive sessions are closed within the configured bound, and all sessions close on server shutdown or endpoint generation change.
- Rebinding the same public URL preserves sessions. Changing the public `/mcp` URL closes every session, updates metadata/challenges, and rejects all old tokens immediately.
- A real pinned-SDK client listed exactly seven tools and called every schema through the transport.
- The first endpoint-change test exposed a pinned SDK bearer-middleware bug: stale-token validation produced a 500 because its catch path dereferenced an undefined error. Loom replaced only that brittle boundary with a defensive equivalent middleware that preserves the SDK challenge format and `req.auth` shape; stale/revoked tokens now return 401.
- Required RED: build failed because `src/mcp.ts` and `src/tools/register.ts` did not exist. The initial compile also exposed the pinned SDK’s TypeScript 6 exact-optional transport mismatch, handled with a narrow `Transport` cast.
- Targeted validation: 9/9 MCP tests passed.
- Full validation: typecheck, 66/66 tests, and build passed.
- Post-suite process scan found no MCP test listener/process residue.

Evidence:

```text
node --test dist/test/mcp.test.js
pass 9
fail 0

npm run typecheck
PASS
npm test
PASS (66/66)
npm run build
PASS

ps -axo pid,ppid,pgid,command | grep -E 'dist/test/mcp.test.js|loom-mcp-|dist/src/mcp.js' | grep -v grep
<no output>
```

### T5 recovery — adversarial-review hardening

- Reproduced the committed T5 TypeScript failure caused by the MCP SDK metadata helper returning a string where the local bearer-challenge boundary required a `URL`; normalized it explicitly with `new URL(...)` without casts or SDK modification.
- Replaced authorization POST parameter replay with a persistent, short-lived, single-use server-side transaction bound to client, redirect URI, scope, resource, endpoint generation, PKCE challenge, and OAuth state.
- The authorization page now posts only `transaction_id` and `owner_password`; attacker-supplied client, redirect, and resource fields are ignored because they are not read. Successful consumption is atomic and replay returns `invalid_request`.
- Added `X-Frame-Options: DENY` alongside strict CSP `frame-ancestors 'none'`, no-store, no-sniff, and no-referrer headers.
- Amended the canonical plan and SPEC only for findings verified against the actual repository: direct argument-vector spawning for Loom-owned binaries, a static terminal adapter, safe symlink canonicalization, memory tombstone recovery, malformed skill frontmatter, browser module separation/evaluation recovery/screenshot persistence, and integrated runtime-lock testing.
- Hardened the execution contract: task regrouping requires an explicit plan amendment and no task commit may occur without green typecheck, full tests, build, map, and governance checks.
- Found that stale compiled tests remained in `dist/` after later untracked sources were quarantined. Added an explicit clean step before every build so abandoned output can never create false failures or false greens.
- Required RED: the authorization page lacked `X-Frame-Options` and still mirrored OAuth parameters into hidden fields.
- Targeted GREEN: MCP and OAuth suites passed 15/15.
- Full clean-output validation: typecheck passed, tracked tests passed 64/64, and build passed.

Evidence:

```text
npm run typecheck
PASS
node --test dist/test/mcp.test.js dist/test/oauth.test.js
PASS (15/15)
npm test
PASS (64/64 after clean build)
npm run build
PASS
```

### T6 — bounded file tools and approved final-symlink reads

- Restored only the quarantined T6 implementation and tests after the clean T5 recovery commit.
- Added stable text, image, and explicit binary reads; private audited atomic writes; exact audited edits; byte limits; expected-SHA conflicts; concurrency serialization; and composable dispatcher behavior.
- Corrected the salvaged implementation’s plan violation: `loom_read` now permits a final symbolic link only after rejecting symlinked parents, resolving the canonical target, opening it with `O_NOFOLLOW`, verifying a regular file, and rechecking both the original pathname identity and canonical target identity after reading.
- Writes and edits still reject final and parent symbolic links through the atomic mutation path.
- Required RED: the file suite failed because the prior implementation rejected the final symbolic link.
- Targeted GREEN: 11/11 file tests passed.
- Full validation: typecheck passed, tracked tests passed 75/75, and build passed.

Evidence:

```text
node --test dist/test/files.test.js
PASS (11/11)
npm run typecheck
PASS
npm test
PASS (75/75)
npm run build
PASS
```

### T7 — skills and memory catalogs

- Restored only the quarantined T7 skills/memory implementation and tests after T6 committed cleanly.
- Added deterministic multi-root skill discovery, stable IDs, ranking, limits, symlink diagnostics, and atomic catalog publication.
- Unterminated SKILL.md frontmatter is now skipped with `malformed_frontmatter_skipped`; it cannot be partially interpreted as metadata/body and does not count toward indexed bytes.
- Added Loom-owned stable-ID memory save/read/search/delete, audit fail-closed behavior, conflict detection, concurrency serialization, and bounded rescans.
- Valid current-user 0600 regular-file delete tombstones are durably removed under an audit start during rescan. Unsafe tombstones remain with `unsafe_tombstone_skipped`; cleanup failures remain visible.
- Repaired the aggregate-byte test so both files are individually valid and only their sum violates the cap.
- Required RED: malformed frontmatter was indexed, recoverable tombstones remained, and the aggregate test accidentally exercised oversized-file skipping.
- Targeted GREEN: skills and memory passed 22/22.
- Full validation: typecheck passed, tracked tests passed 97/97, and build passed.

### T8 — secure loopback dashboard

- Added a loopback-only dashboard server and static client with no permissive CORS or generic action endpoint.
- A 256-bit five-second bootstrap nonce is single-use and exchanged for a bounded HttpOnly SameSite=Strict session cookie.
- Every page and API requires the session; mutations additionally require exact Origin and a per-session `X-Loom-CSRF` value.
- Exact Host validation, strict self-only CSP, frame denial, no-store, no-sniff, no-referrer, and restrictive Permissions-Policy are applied.
- Status values are recursively redacted before serialization. Static JavaScript renders with `textContent` and exposes only rescan, browser restart, audit reveal, next-launch config, OAuth revoke, and stop actions.
- Required RED: `src/dashboard.ts` did not exist. A later test correction replaced fetch’s normalized Host header with a raw HTTP request.
- Targeted GREEN: dashboard passed 2/2.
- Full validation: typecheck passed, tracked tests passed 99/99, and build passed.

### T9 — managed persistent browser subsystem

- Added the browser contract/error module, separated public browser policy and MCP result shaping from the Playwright/CDP backend, and retained guarded dynamic Playwright loading so a browser failure cannot statically disable other tools.
- Added explicit `loom setup browser`. It initializes private `~/.loom/browser/` state, resolves the installed Playwright Core CLI independently of the caller’s working directory, installs Chromium without the unused headless shell, forces the official Playwright CDN, verifies the exact architecture-specific executable SHA-256, performs a real wrapper-owned loopback CDP launch, and atomically promotes or rolls back the installation.
- Added the dedicated persistent profile backend with direct executable/argument ProcessManager launch, loopback ephemeral CDP, twelve-tab enforcement, stable per-page IDs, bounded navigation/actions/snapshots/evaluation/screenshots, explicit permissions/geolocation, and no attachment to normal Chrome.
- Added private `runtime/browser.lock` identity using wrapper PID, start time, executable, launch ID, and canonical profile. Recovery rejects live or identity-uncertain owners, distinguishes actual Chrome executables from unrelated commands mentioning the profile, and removes stale Chromium singleton artifacts only after process-table verification.
- Added audited no-overwrite download persistence and audited collision-safe screenshots under `~/.loom/downloads/`; page text, expressions, typed values, screenshot bytes, selectors, and URL query values remain absent from audit bytes.
- Added one deadline/recovery boundary for both public evaluation and internal snapshot evaluation. A timed-out tab is closed without `beforeunload`, surviving CDP health is checked, and whole-browser restart occurs only when tab cleanup or CDP health fails.
- Replaced the original `--dump-dom about:blank` setup probe after the real pinned Chrome build hung with no DOM output. The replacement waits for safe `DevToolsActivePort` metadata and validates a loopback `/json/version` response while the browser remains wrapper-owned.
- Fixed persistent-profile loss: Playwright `connectOverCDP()` close only disconnected and Loom immediately killed Chrome before storage flush. Shutdown now sends CDP `Browser.close`, waits for natural managed-process exit within the soft grace, and cancels the group only as fallback.
- Fixed package-bin execution through symlinks and proved `loom setup browser` does not depend on the caller’s current directory.
- Required RED evidence included strict TypeScript failures, final-symlink executable acceptance, install rollback loss, stale-lock false positives, missing CDP launch verifier, `--dump-dom` real hang, profile storage returning `null` after restart, unbounded snapshot evaluation, package-bin no-op, CWD-relative CLI resolution, and download-host override drift.
- Deterministic final validation: typecheck passed, browser/CLI/config targets passed, full tracked suite passed 120/120, and build passed.
- Real macOS arm64 evidence: official Chromium archive SHA-256 `311211b54c429245e2cec0314ee1e314085e9c00350215b95e1a879350786630`; installed executable SHA-256 `b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7`; Chrome 149.0.7827.55 revision 1228 launched through ProcessManager, produced a private manifest and no setup/process residue, and restored localStorage value `"v"` across two controlled backend restarts with no remaining Chrome process or browser lock.

Evidence:

```text
npm run typecheck
PASS
npm test
PASS (120/120)
npm run build
PASS

real setup manifest
playwrightVersion: 1.61.1
chromiumRevision: 1228
chromiumVersion: 149.0.7827.55
architecture: arm64
executableSha256: b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7
browser directory: 0700
manifest: 0600
staging residue: none
process residue: none

controlled profile restart
first launch: set "v"
second launch: restored "v"
post-shutdown process/browser-lock residue: none
```

### T10 — pinned Cloudflared acquisition and validation

- Added exact Cloudflared `2026.7.0` release descriptors for macOS arm64 and x64, including official GitHub HTTPS URLs, archive byte counts, archive SHA-256 values, and extracted executable SHA-256 values.
- Added stable executable inspection using canonical resolution, current-user ownership, regular-file and executable-mode checks, `O_NOFOLLOW`, before/after file identity, full SHA-256, and exact wrapper-owned `cloudflared --version` parsing.
- PATH discovery accepts a normal symlink only after canonical verification and reports requested path, canonical path, hash, bytes, and version. The first PATH match fails closed on unknown bytes/version rather than silently searching later entries.
- Added credential-free HTTPS acquisition with manual redirects capped at five, a bounded 30-minute total transfer deadline, optional Content-Length validation, exact streamed byte/hash enforcement, private exclusive staging, and cleanup of partial downloads.
- Added the default macOS `/usr/bin/tar` boundary with an exact single-file `cloudflared` archive layout, private chmod, executable hash/version verification, stable inode promotion, directory fsync, and preservation of any existing binary on pre-promotion failure.
- Added direct ProcessManager launch that re-verifies the binary and injects `tunnel --no-autoupdate --metrics 127.0.0.1:0` as an explicit argv vector. Caller attempts to override `tunnel`, autoupdate, or metrics flags fail before launch; shell command construction and terminal-tool routing are absent.
- Added pre-mutation parent-symlink rejection so installation cannot create state through a symlinked ancestor.
- Required RED evidence covered the absent production module, absent verification/PATH/installer/launch APIs, pre-rejection symlink side effects, and an empirically insufficient 60-second then 10-minute official download deadline. The real official transfer required about fourteen minutes on this connection, so the production deadline is bounded at 30 minutes.
- Targeted validation passes 9/9; full typecheck, 129/129 tests, and build pass.
- Real evidence: official arm64 archive `276f4ae3119c88d1708b0f884a35a1c87d9ae459b0dab6313f2daddbddab2bec` and executable `cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04`; official x64 archive `dd1fb6a914a21dc52c64bad96987bbbc72d6c65553a2cfee1dd5bc886742ddfb` and executable `c0c65579c6f11b1381cf5ffd1614f5094bf140e18938eae4ad16931da9f69499`. Both binaries reported version `2026.7.0` through ProcessManager.
- A real official HTTPS arm64 install used the production downloader and default extractor, produced a private 0700 `cloudflared` executable of 38,388,400 bytes with the pinned hash/version, removed its staging directory, and left no installer or Cloudflared process residue.

Evidence:

```text
node --test dist/test/cloudflare.test.js
PASS (9/9)

npm run typecheck
PASS
npm test
PASS (129/129)
npm run build
PASS

real official HTTPS install
version: 2026.7.0
sha256: cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04
bytes: 38388400
mode: 0700
staging residue: none
process residue: none
```

### T11 — tunnel-independent runtime readiness

- Explicitly amended path ownership before coding: T11 introduces only the readiness subset of `src/runtime.ts` and `test/runtime.test.ts`; T14 retains full startup/shutdown orchestration in the same files.
- Added strict local endpoint validation requiring a bare HTTP loopback origin with explicit port and an exact `<origin>/mcp` URL.
- Added strict public endpoint canonicalization requiring a bare HTTPS origin with no credentials, explicit port, path, query, or fragment, deriving exactly `<origin>/mcp` as the OAuth protected resource.
- Added `RuntimeReadiness` that persists an immutable NOT_READY snapshot, delegates exact endpoint binding to the existing MCP server, and publishes immutable ready/status state only after successful validation, binding, and private atomic state replacement.
- Added strict secret-free `runtime/current.json` schema with local/public MCP URLs, resource, tunnel mode, connector readiness, production eligibility, and timestamp. Writes require a current-user 0700 runtime directory, reject a symlinked `current.json` before binding, and produce a 0600 atomic file.
- Added status-block formatting with full local/public MCP URLs, tunnel/connector/production fields, and the exact full-computer-access warning. T11 does not print, redraw, start, or stop any runtime component.
- Added real local integration using `LoomMcpHttpServer`: before readiness binding, `/mcp` returns structured 503 NOT_READY with no challenge; after canonical binding, it returns the endpoint-bound 401 OAuth challenge and exact protected-resource metadata.
- Required RED evidence included the absent runtime module, unsafe runtime-directory validation after binding, and current.json symlink rejection after binding. Both state-target cases now fail before the MCP endpoint changes and preserve prior state.
- Targeted validation passes 6/6; full typecheck, 135/135 tests, and build pass.

Evidence:

```text
node --test dist/test/runtime.test.js
PASS (6/6)

npm run typecheck
PASS
npm test
PASS (135/135)
npm run build
PASS

real local MCP readiness transition
before binding: HTTP 503, NOT_READY, no WWW-Authenticate
after binding: HTTP 401, exact endpoint-bound resource metadata challenge
runtime/current.json: 0600
```

### T12 — Quick Tunnel

- Added fail-closed Quick Tunnel configuration checks. Quick mode returns without side effects when the config directory is absent, but refuses an unsafe config path or any existing `config.yaml`/`config.yml` before audit or process launch.
- Added strict Quick origin parsing for a single valid DNS label under `trycloudflare.com`, bounded by whitespace or end-of-buffer. Paths, ports, multi-label prefixes, invalid label edges, and concatenated prefixes are rejected.
- Added `QuickTunnelManager` around the verified T10 direct ProcessManager boundary. It passes only `--url <bare-loopback-origin>`; T10 injects `tunnel --no-autoupdate --metrics 127.0.0.1:0` and re-verifies the binary.
- Added bounded 256 KiB output accumulation, cursor consistency checks, split-chunk/end-boundary URL handling, and readiness requiring both a strict public origin and a registered tunnel connection.
- Enforced the central 15-second readiness deadline separately for each attempt. A process-start failure, early transient exit, or timeout permits exactly one fully cleaned recreation. A malformed/unsafe candidate URL fails immediately without recreation.
- Added idempotent status/start/stop state with exact public `<origin>/mcp`, `production: false`, recreation count, and process cancellation on failure/stop.
- Added audit fail-closed behavior and start/finish-only records. Tests prove Cloudflared output, registration text, and trycloudflare URL bytes never enter the audit log.
- Added integration through `RuntimeReadiness` and `AuthStore`: two changed Quick URLs increment endpoint generation and invalidate endpoint-bound OAuth state while the installation owner password remains valid across reopen. Quick runtime status remains ineligible for production.
- Required RED evidence covered missing parser/config/manager APIs, transient process-start recreation bypass, and unsafe endpoint behaviors. An additional end-of-buffer chunk-boundary review case was already handled correctly by the strict parser and required no production change.
- Cloudflared targeted validation passes 17/17; full typecheck, 143/143 tests, and build pass.
- One first full-suite run observed a nonreproducing `kill EPERM` in the pre-existing ProcessManager SIGKILL-escalation test. The isolated test passed immediately, no owned process residue existed, and the complete suite then passed 143/143. No unrelated process-manager code was changed.
- No real Quick Tunnel smoke claim is made. The plan explicitly marks it optional and non-certifying; production certification still requires a real named tunnel.

Evidence:

```text
node --test dist/test/cloudflare.test.js
PASS (17/17)

npm run typecheck
PASS
npm test
PASS (143/143)
npm run build
PASS

Quick endpoint lifecycle
first URL generation: 1
second URL generation: 2
owner password after both changes/reopen: valid
production eligible: false
```

### T12.1 — transient process-group signal hardening

- Promoted the previously intermittent negative-PGID `SIGKILL` `EPERM` into a release-blocking subtask before T13 and amended the canonical plan and specification accordingly.
- Added deterministic real-process regressions for one transient `EPERM` and persistent `EPERM` while a managed target ignores `SIGTERM`.
- Required RED reproduced the raw `kill EPERM` escape from the former single-attempt signal helper. The persistent case also proved the error was not wrapped at the owned-group boundary.
- Replaced direct signaling with one minimal owned-group helper. `ESRCH` remains already-gone; any `EPERM` revalidates the recorded wrapper PID/start-time/executable identity and current group membership before retry; retries use only the existing absolute shutdown deadline; persistent failure rejects without widening the signal target.
- Preserved cancellation state and complete descendant cleanup. Test-only forced cleanup prevents intentional fail-closed cases from leaking processes.
- Preserved a concurrent-agent refinement that replaces process-global `process.kill` monkeypatching with one optional group-signal function on `ProcessManager`; simplified its draft one-purpose system-call interface to the single function required by the tests.
- A concurrent agent supplied the initial retry implementation during review. Its extra fixed three-retry policy was removed because the existing absolute deadline is the approved and sufficient bound.
- Targeted EPERM validation passes 2/2; process-manager/watchdog validation passes 12/12; full typecheck, 145/145 tests, and build pass. A delayed external process-table scan is empty.

Evidence:

```text
node --test --test-name-pattern='EPERM' dist/test/process-manager.test.js
PASS (2/2)

node --test dist/test/process-manager.test.js dist/test/watchdog.test.js
PASS (12/12)

npm run typecheck
PASS
npm test
PASS (145/145)
npm run build
PASS

ten consecutive ProcessManager runs
PASS (90/90 test executions)

post-suite process scan
<no output>
```
