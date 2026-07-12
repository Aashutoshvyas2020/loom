# Changelog

All notable implementation and governance changes are recorded here with command evidence.

## 2026-07-09

### ChatGPT OAuth callback CSP compatibility

- Matched DevSpace's browser-form plus `302` callback flow while preserving Loom's authorization security headers.
- The authorization page now permits form redirects only to the registered callback origin, allowing ChatGPT to receive the authorization code and exchange it for tokens.
- RED: the OAuth integration test proved the original `form-action 'self'` policy omitted the registered callback origin.
- GREEN: `npm run typecheck`, `npm test` (217 passing), and `npm run build` passed.
- Real named-tunnel DCR marker persisted across a same-host restart; the temporary marker was revoked afterward without rotating the owner password.
- External ChatGPT verification remains pending until the approved test network is active.

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

### T13 — Named Tunnel

- Added strict named-tunnel configuration canonicalization: lowercase stable DNS hostnames, no `trycloudflare.com`, no surrounding whitespace/control characters, no option-like names, and a 128-character name ceiling.
- Added stable private authentication-file reads for the origin certificate and credentials JSON. Both paths reject symbolic-link components, nonregular/wrong-owner files, group/other access, executable or special mode bits, invalid size, and identity changes before/during read.
- Added strict origin-certificate PEM/token validation and current credential schema validation for exactly `AccountTag`, `TunnelSecret`, `TunnelID`, and `TunnelName`. Credentials must match the certificate account and configured tunnel name; the secret must be canonical 32-byte base64 and the ID must be a UUID.
- Added `NamedTunnelManager` on the verified direct Cloudflared boundary. It launches only explicit `--origincert`, `run --url <bare-loopback-origin>`, `--credentials-file`, and tunnel-name arguments after the fixed T10 `tunnel --no-autoupdate --metrics 127.0.0.1:0` prefix.
- Named status exposes no public endpoint and no production eligibility before a registered tunnel connection is observed within 15 seconds. A benign missing-persistent-config notice is accepted; Loom does not use persistent ingress as its origin mapping.
- Static validation and audit-start failures block process launch. Authentication/configuration output fails immediately. Only transient spawn/edge/readiness failures retry, at most five times, with one-second exponential backoff bounded by 60 seconds.
- Revalidates the certificate and credentials before every attempt, fully cancels each failed process before retry, and fails closed if cleanup is uncertain. No Quick Tunnel fallback exists.
- Added lifecycle-version plus `AbortController` cancellation so `stop()` interrupts pending readiness/backoff waits, cancels the active attempt exactly once, prevents recreation, and remains idempotent. An uncleaned process blocks restart.
- Audit records include only mode/retry metadata. Tests prove the tunnel name, hostname, endpoint, authentication paths/values, certificate fields, and Cloudflared output do not persist in audit bytes.
- Added runtime/OAuth integration evidence: restarting the same canonical hostname preserves endpoint generation; changing the hostname increments generation and invalidates endpoint-bound state; the owner password remains valid across both and across store reopen.
- Preserved and reviewed concurrent-agent adversarial additions for per-retry auth revalidation, cleanup-failure fail-closed behavior, benign config notices, option-like name rejection, hidden pre-ready status, and prompt stop-during-startup cancellation. Duplicate cancellation mechanisms were removed in favor of one `AbortController` path.
- Required RED evidence covered missing named APIs/constants, permissive config names/hostnames, pre-ready production exposure, retry auth mutation, cleanup uncertainty, stop-triggered recreation, and startup sleeps that did not wake promptly.
- T13 target passes 38/38. Full typecheck, 158/158 tests, clean build, and delayed Loom-owned process-residue scan pass. A pre-existing Homebrew Cloudflared process belongs to `node /opt/homebrew/bin/devspace launch devspace`, predates T13, and is explicitly excluded rather than touched. This is deterministic implementation evidence only; real named-tunnel and ChatGPT certification remain G5/G6 work.

Evidence:

```text
node --test dist/test/cloudflare.test.js dist/test/config.test.js dist/test/limits.test.js
PASS (38/38)

npm run typecheck
PASS
npm test
PASS (158/158)
npm run build
PASS

Loom-owned post-suite process scan
<no output>

unrelated pre-existing infrastructure (not touched)
cloudflared tunnel run devspace
parent: node /opt/homebrew/bin/devspace launch devspace

Named endpoint lifecycle
same canonical hostname generation: 1 -> 1
changed hostname generation: 1 -> 2
owner password after restarts/change/reopen: valid
production eligible before readiness/after stop: false
production eligible while registered: true
```

### T13.1 — terminal tool implementation recovery

- Added the missing concrete `loom_terminal` handler required by the seven-tool contract and blocked T14 until it existed.
- Added twelve centralized terminal limits for command size, environment entries/key/value/aggregate bytes, timeout, poll/default-poll bytes, wait, retained jobs, job-ID bytes, and poll interval; the exact limit ledger now covers 36 values.
- Added one static typed process boundary only: `ProcessManager.start({ executable: '/bin/sh', args: ['-lc', command], cwd, env, timeoutMs })`. No reflection, `Function.toString()`, alternate method guessing, PTY, stdin, or shell routing for Loom-owned binaries exists.
- Added absolute-or-home cwd validation with `realpath`, safe symlink traversal, and directory enforcement. Environment keys use the portable identifier grammar; values and aggregate bytes are bounded and NUL-free.
- Added stable `job_<uuid>` identifiers, bounded cursor/gap polling, at most 60 seconds of wait, lifecycle statuses (`running`, `exited`, `cancelled`, `timed-out`), timeout propagation, and PGID metadata.
- Kept command output exclusively in MCP content. Structured data contains lifecycle/cursor/byte/PGID metadata only; audit records never contain command, cwd, environment names/values, or output.
- Terminal start and cancel require a durable audit-start record before launch/signaling. Audit degradation blocks those mutations while polling an existing job remains available.
- Added idempotent cancellation and service shutdown that terminate complete wrapper-owned groups, including grandchildren. No PTY or usable stdin is exposed.
- Added bounded retention of 128 jobs. Capacity rejects only when every retained job is running; finished jobs are awaited through process and audit completion before the oldest finished record is evicted. Running jobs are never evicted.
- Added `createTerminalToolDispatcher` using the existing fallback-chain convention and centralized the public terminal Zod bounds in `src/tools/register.ts`.
- The repeated short-command workload exposed a real wrapper race: `ready` and `exit` were asynchronous IPC sends followed by immediate disconnect, so a fast target could lose readiness and leave the parent waiting for the full startup timeout. The wrapper now flushes `ready` before `exit`, flushes startup errors before disconnect, and guards against duplicate finish paths. ProcessManager now rejects wrapper exit during startup immediately, records exits that occur between readiness and managed-object construction, and settles the startup timeout exactly once.
- Required RED first failed on the missing terminal module/exports. Later stress runs reproduced five-second wrapper startup timeouts and test-owned residue. Concurrent adversarial tests were preserved for typed job/capacity failures, audit-degraded polling, completion-order retention, strict UUID job IDs, aggregate environment limits, and complete group cleanup.
- Terminal/limits target passes 9/9. The combined ProcessManager/terminal/limits target passes 19/19, including twenty rapid natural exits without losing the wrapper ready handshake. The real terminal suite passes five consecutive runs (40/40 executions) with zero wrapper/target/grandchild residue. Full typecheck, 167/167 tests, and build pass; delayed Loom-owned residue scan is empty.

Evidence:

```text
node --test dist/test/terminal.test.js dist/test/limits.test.js
PASS (9/9)

node --test dist/test/process-manager.test.js dist/test/terminal.test.js dist/test/limits.test.js
PASS (19/19)
rapid natural exits: 20/20

five consecutive terminal-suite runs
PASS (40/40 test executions)
residue after every run: none

npm run typecheck
PASS
npm test
PASS (167/167)
npm run build
PASS

Loom-owned delayed process scan
<no output>
```

### T14 — full runtime orchestration and signal cleanup

- Expanded `src/runtime.ts` from readiness-only state into an exclusive foreground lifecycle with identity-bound `runtime/loom.lock`, strict private `runtime/current.json`, startup state, one readiness publication, foreground waiting, idempotent stop, and fail-closed ownership removal.
- Added the exact local startup sequence: initialize/validate state and config, acquire lock, create audit and ProcessManager, compose all seven concrete tool handlers, start MCP NOT_READY, dashboard, skill and memory catalogs, verified managed browser or explicit unavailable mode, selected verified Cloudflare tunnel, canonical public `/mcp` binding, private ready state, one secret-free status block, optional local dashboard open, then foreground wait.
- Added the production runtime factory. It uses the pinned browser manifest and managed persistent profile when valid; a missing manifest degrades browser tools only. A present invalid manifest remains fatal before public readiness. It resolves or installs only the pinned architecture-specific Cloudflared release and constructs exactly the configured Quick or Named manager with no fallback.
- Added strict concrete dashboard actions: catalog rescan, audited browser restart, audited local audit-folder reveal through direct `/usr/bin/open`, audited strict atomic next-launch config replacement, audited owner-preserving OAuth revoke-all, and runtime stop.
- Added `writeConfig` for strict 0600 atomic config replacement and `AuthStore.revokeAllOAuth` for endpoint/password-preserving OAuth invalidation.
- Added the exact shutdown sequence: mark stopping, reject new terminal jobs, cancel terminal groups, close browser, stop tunnel, close MCP then dashboard, drain ProcessManager, close audit, and remove state/lock only after cleanup certainty. Every step races the real absolute shutdown deadline; timeout/error preserves ownership files fail-closed.
- Hardened runtime-state deletion separately from lock deletion: shutdown opens `runtime/current.json` without following symlinks, verifies current-user 0600 mode, stable file identity, and byte-for-byte equality with the last immutable readiness snapshot before removing it. Replaced or missing owned state rejects cleanup and preserves the lock for manual recovery.
- Added stop-during-startup lifecycle versioning so SIGINT/SIGTERM/direct stop during tunnel readiness prevents public binding, status output, process recreation, or stale state. Repeated stop remains idempotent.
- Added runtime lock acquisition/release with exclusive create, live exact-identity refusal, stale-lock replacement, current-process revalidation, and refusal to remove a replaced lock.
- Added foreground status with browser, catalogs, tunnel, connector, audit, complete local/public MCP and dashboard URLs, production eligibility, and the full-access warning. Owner password and secrets never enter status.
- Wired the real `loom launch --yolo` command. It enforces macOS 14+/Node 22+, requires direct `/dev/tty`, prints the bright full-access warning and newly generated owner password only there, invokes the production factory and signal runner, and cleans a partially created runtime on launch failure. Plain launch remains refused.
- Hardened the launch boundary with an explicit minimal factory-result type and a dual input/output terminal-handle test fixture, avoiding unsafe inference while preserving the exact local-terminal behavior.
- Default production launch now opens the single-use authenticated dashboard bootstrap URL through direct `/usr/bin/open`; tests explicitly capture or suppress that local side effect. Missing and corrupt browser manifests both produce browser-unavailable mode while preserving the other six tools.
- Required RED first failed on missing orchestration exports. Subsequent adversarial tests proved stop during tunnel startup, true deadline behavior, lock replacement refusal, browser-degraded mode, default production graph construction, owner-password persistence, factory lock cleanup, exact CLI routing, and sessionless TTY refusal before state creation.
- Runtime target passes 18/18; exact T14 runtime/CLI/config/OAuth target passes 49/49; five runtime stress runs pass 90/90. Full typecheck, 185/185 tests, and build pass. Post-stress Loom-owned process and listener scans are empty.
- This completes deterministic local T14 only. Real named-tunnel DNS/credentials and real ChatGPT OAuth/tool calls remain G5/G6 blockers; packaging/docs and clean-machine certification remain T15/T16.

Evidence:

```text
node --test dist/test/runtime.test.js dist/test/cli.test.js dist/test/config.test.js dist/test/oauth.test.js
PASS (49/49)

five consecutive runtime-suite runs
PASS (90/90 test executions)
active test processes: none
Loom-owned listeners: none

npm run typecheck
PASS
npm test
PASS (185/185)
npm run build
PASS
```

### T15 — packaging and public operating documentation

- Finalized the operator and security guides around the actual supported command surface, foreground-only trust boundary, Quick-versus-Named tunnel behavior, browser setup/recovery, configuration and owner-password reset, shutdown ownership rules, diagnostics, and incident response.
- Added the MIT distribution notice and the public release-certification guide plus a sanitized release-evidence index.
- Corrected the package allowlist so the tarball contains the compiled runtime, dashboard assets, README, license, notice, and only the public operator/security/development/certification documents. Internal implementation plans, release-evidence artifacts, source tests, and compiled tests are explicitly excluded.
- Corrected both packaged executable boundaries. `loom` and `loom-certify` now execute through npm-created package-bin symbolic links; the certification CLI regression was reproduced as silent output before the realpath fix.
- Built `loom-mcp-0.1.0.tgz`, installed it with scripts disabled into a new temporary prefix and temporary HOME, and verified installed version/help behavior, public assets, and fail-closed launches. Plain launch and sessionless YOLO launch both exit 2, and the failed YOLO attempt creates no `~/.loom` state.
- The candidate tarball contains 90 files, is 186200 bytes, and has SHA-256 `3711d511bf530ec3d834b4a021d960cbb001af43c126c850069640bfd7f7a549`. The temporary installation and tarball directory were removed after verification. No package was published.
- Sanitized local package evidence is recorded in `docs/release-evidence/t15-local-package.md`.

### T15.1 — fail-closed certification evidence tooling and recovery

- Resumed from commits that had advanced beyond the T14 handoff without same-commit governance and with a non-compiling certification test. The mandated startup gate first exposed invalid TypeScript syntax, then a missing `./filesystem.js` import. The repair reused the existing path-policy module rather than inventing a duplicate filesystem abstraction.
- Added a packaged `loom-certify` command that collects deterministic typecheck/test/build/documentation/map/package/residue evidence for the exact current commit, writes a private canonical report, and validates strict optional external-evidence manifests and stable private artifact hashes.
- Closed a release-blocking trust flaw found during adversarial review: self-authored JSON booleans and artifact hashes cannot prove real Cloudflare, ChatGPT, OAuth, tool-call, cleanup, clean-host, sleep/wake, or connector-persistence events. G5–G7 now remain blocked pending human review even when a supplied manifest passes schema and hash checks; the automated tool cannot independently mark a release certified.
- Bound G5 evidence to the exact pinned architecture-specific Cloudflared executable, Cloudflared version `2026.7.0`, Chromium revision `1228`, and architecture-specific Chromium executable hash. Quick Tunnel evidence is optional and never certifying.
- Hardened artifact/report paths against symbolic links, including rejecting an existing symbolic-link parent before directory creation. Report files remain private canonical JSON.
- Strengthened package certification to require every public release asset and reject `.loom`, credential-like files, source/compiled tests, internal plans, release-evidence artifacts, dependencies, and VCS content.
- Strengthened process-residue checks to include wrapper/runtime/terminal groups, the managed `~/.loom/cloudflared/cloudflared` executable, and the dedicated `~/.loom/browser-profile` process family.
- Added executable documentation checks for the human-review boundary and corrected stale certification examples to the current managed-component pins.
- Independent automated review was attempted in read-only mode, but Gemini lacked `GEMINI_API_KEY` and no Codex reviewer CLI was installed. This was not treated as approval; a direct adversarial review produced the trust, symlink, package, pinning, and residue fixes above.
- Final focused certification/documentation validation passes 19/19. Full typecheck, 204/204 tests, build, the 90-file package dry run, clean-prefix install, and delayed Loom-owned process scan all pass.

Evidence:

```text
npm run typecheck
PASS

npm test
PASS (204/204)

npm run build
PASS

node --test dist/test/certification.test.js dist/test/certification-cli.test.js dist/test/docs.test.js
PASS (19/19)

npm pack --dry-run --json
PASS (90 public release files)
forbidden package paths: none

clean temporary-prefix tarball install
loom --version: 0.1.0
loom --help: PASS
loom-certify --help: PASS
plain launch: exit 2
sessionless YOLO launch: exit 2
state created: no

package SHA-256
3711d511bf530ec3d834b4a021d960cbb001af43c126c850069640bfd7f7a549

post-suite delayed Loom-owned process scan
<no output>
```

### T15.2 — external expert audit dossier

- Added an explicit plan amendment for one repository-root, self-contained external audit dossier without changing runtime behavior, dependencies, public commands, or the npm package allowlist.
- Added an executable documentation contract requiring the dossier’s core product, architecture, security, repository-ledger, implementation-plan, evidence, and embedded-document sections; the exact seven tools; the human-review and does-not-prove certification boundary; G5/G6/G7 status; and representation of every tracked path documented by `REPO_MAP.md`.
- Required RED reproduced the missing deliverable as `ENOENT: EXTERNAL_AUDIT.md` before the dossier was created.
- Authored the audit narrative from the actual source and governance state, including end-to-end startup/shutdown flow, trust boundaries, local state, process supervision, audit, OAuth/MCP, every tool, browser, Cloudflare, dashboard, package/certification behavior, implementation chronology, evidence status, and an external-review checklist.
- Generated the exact tree, source/export index, test inventory, and verbatim snapshots of the canonical plan plus relevant design, scope, governance, operations, security, release, evidence, package, license, and history documents into the same Markdown file.
- Fresh pre-edit startup validation passed `npm ci`, typecheck, 204/204 tests, and build with zero vulnerabilities and a clean worktree. Final T15.2 validation is recorded below after dossier assembly.

RED evidence:

```text
node --test --test-name-pattern='external audit dossier' dist/test/docs.test.js
FAIL (expected)
ENOENT: /Users/aashu/loom/EXTERNAL_AUDIT.md
```

GREEN and validation evidence:

```text
node --test --test-name-pattern='external audit dossier' dist/test/docs.test.js
PASS (1/1)

npm run typecheck
PASS

npm test
PASS (205/205)

npm run build
PASS

EXTERNAL_AUDIT.md generated inventory
represented files: 73
static test declarations: 205
mandatory headings missing: none
mapped paths missing: none

npm pack --dry-run --json
PASS (90 public release files, 186200 bytes)
EXTERNAL_AUDIT.md packaged: no
forbidden paths: none

supported secret-material scan
findings: none

Loom-owned wrapper/cloudflared/browser-profile residue
none
```

### T15.3 — adversarial security verification and hardening

- Treated five externally supplied adversarial reviews as hypotheses and verified each consolidated claim against the exact source, pinned MCP SDK, deterministic tests, or controlled local experiments before changing behavior.
- Added a complete classification record at `docs/release-evidence/t15.3-adversarial-review.md`, separating verified fixes, verified residual risks, false positives/already-mitigated claims, and intentional scope tradeoffs.
- Replaced the pinned SDK helper's unbounded global JSON parser with explicit localhost Host validation, a route-specific 9 MiB MCP parser, 64 KiB OAuth metadata parsers, and structured 413/400 responses before SDK or Zod handling.
- Added a monotonic global owner-password authorization limit of ten attempts per 60-second foreground process window with 429 and `Retry-After` behavior.
- Raised new owner-password scrypt verifiers to N=32768, r=8, p=3 with explicit memory bounds and added transparent atomic migration after successful verification of legacy N=16384, r=8, p=1 state.
- Bound refresh-token rotation to one absolute 30-day family expiration so regular use cannot renew access indefinitely.
- Bounded every watchdog `ps`/`lsof` command with a fixed C locale, bounded output, two-second SIGKILL timeout, serialized wrapper identity probes, monotonic heartbeat age, and distinct mismatch-versus-unavailable handling.
- Canonicalized only macOS's root-owned `/tmp` and `/var` aliases, opened read targets nonblocking before regular-file verification, rechecked memory tombstone identity immediately before removal, and made runtime-lock creation explicitly `O_EXCL | O_NOFOLLOW`.
- Preserved capability-reducing safety controls during audit degradation: terminal cancel and browser tab close remain available while capability-increasing mutations remain audit-fail-closed.
- Converted runtime, ProcessManager, wrapper, dashboard, and MCP in-process safety windows to monotonic time while retaining wall time for persisted OAuth expiry and human-readable records.
- Added explicit OSC 52 regression coverage and a bounded 256 KiB hostile Quick Tunnel parser input.
- Controlled experiments showed a 64 MiB terminal-output command completed normally in about 323 ms without false watchdog termination, while a child deliberately launched with `start_new_session=True` escaped owned-PGID cancellation as expected; the escaped process was explicitly killed and the residual limitation is now documented.
- Expanded README, security, operator, development, release-certification, specification, and evidence guidance for prompt injection, persistent browser/memory state, remote-client/provider disclosure, login-shell secrets, TCC, localhost/LAN pivoting, local-only containment, non-forensic audit, deliberate process escape, filesystem durability assumptions, artifact retention, terminal scrollback, and package trust roots.
- The first full suite reached 213/214 and exposed a timing-dependent transient-EPERM test failure. Root cause was overlapping wrapper fallback identity probes plus transient `lsof` unavailability being treated as parent death. The wrapper fix passed the transient-EPERM test ten consecutive isolated runs, then the complete suite passed 214/214.
- Built and installed the hardened tarball into an isolated prefix/HOME. The package remains 90 public files with internal tests, plans, release evidence, and `EXTERNAL_AUDIT.md` excluded. Installed version/help and certification help passed; plain and sessionless YOLO launches exited 2 and created no state. Nothing was published or deployed.

Evidence:

```text
npm run typecheck
PASS

npm test
PASS (214/214)

npm run build
PASS

focused hardening suite
PASS (68/68)

transient EPERM isolated stress
PASS (10/10)

npm pack --dry-run --json
PASS — 90 files, 194258 bytes
forbidden internal paths: none

actual tarball
loom-mcp-0.1.0.tgz
bytes: 194258
SHA-256: 31c0f309a0bb94d3b974a852f0510282898ec5087c98f1229fe94c8203f1a491

isolated installed package
loom --version: 0.1.0
loom --help: PASS
loom-certify --help: PASS
plain launch: exit 2
sessionless YOLO launch: exit 2
state created: no
```

### T15.3 — implementation commit recorded

- Committed the verified adversarial security hardening, tests, evidence, public threat-model updates, regenerated audit dossier, and synchronized governance at `7b64064ea01de77ab0876f3eb68977277d9b930c`.
- The repository was clean immediately after that implementation commit.
- This follow-up changes only the resumable handoff, changelog/map bookkeeping, and regenerated dossier so the next agent receives the completed implementation SHA and the exact T16 certification command.

### T15.4 — Node 22 compatibility and public CI

- Reproduced the declared Node.js 22 floor on v22.23.1. The first full run completed 185/214 and cancelled 29 tests because awaited timeout/lifecycle promises were backed only by unreferenced timers; Node 26 had masked the issue by keeping unrelated handles alive longer.
- Kept awaited browser evaluation/shutdown deadlines and Quick/Named Tunnel polling sleeps referenced until settlement. This is a lifecycle correctness fix only; no browser feature or recovery scope changed.
- Replaced Cloudflared acquisition's `AbortSignal.timeout()` with an explicit referenced `AbortController` timer while preserving the bounded timeout and existing error contract.
- Added minimal macOS GitHub Actions CI on Node 22 and Node 26 with clean install, typecheck, full tests, and build.
- Node 22 targeted browser tests now pass 19/19, Cloudflare tests pass 30/30, and the full repository passes 214/214 with typecheck and build.

Evidence:

```text
RED — Node v22.23.1 full suite
pass 185
cancelled 29
exit 1

GREEN — Node v22.23.1 browser target
pass 19
cancelled 0

GREEN — Node v22.23.1 Cloudflare target
pass 30
cancelled 0

GREEN — Node v22.23.1 complete gate
npm run typecheck: PASS
npm test: PASS (214/214)
npm run build: PASS
```

### T15.4 — implementation commit recorded

- Committed the Node 22 lifecycle correction, explicit Cloudflared abort timing, Node 22/26 macOS CI, regenerated audit dossier, and synchronized governance at `5ee5dd9524940fd87432f4727178fbfdbeecb08e`.
- The repository was clean immediately after the implementation commit.
- The next action is the owner's real foreground launch and connector test; no push, publication, or deployment has occurred.

### T15.5 — Real ChatGPT OAuth interoperability

- Reproduced ChatGPT's public OAuth discovery failure and compared Loom against the working DevSpace OAuth server on the same Mac and hostname.
- Root cause: Loom installed localhost-only Host validation globally, so Cloudflare-forwarded requests using the public hostname were rejected before protected-resource or authorization-server metadata could run.
- Replaced that boundary with exact dynamic validation: loopback hosts are always allowed; after endpoint binding, only the canonical public resource hostname is additionally allowed; unrelated hosts remain 403.
- Matched the pinned MCP SDK/DevSpace client contract by advertising and supporting both `client_secret_post` and public-client `none` across DCR, code exchange, refresh, and revocation while preserving endpoint binding, PKCE S256, server-side owner-password transactions, and rotating refresh tokens.
- Accepted Cloudflare's real named-tunnel credential JSON (`AccountTag`, `TunnelSecret`, `TunnelID`, optional string `Endpoint`) and bound credentials to the exact `<TunnelID>.json` filename.

Evidence:

```text
RED — public Host discovery: 403 instead of 200
RED — authorization metadata omitted token method `none`
RED — public-client DCR returned 400 instead of 201
GREEN — public Host + hostile Host + metadata + public DCR target: 3/3
GREEN — OAuth/MCP/Cloudflare integrated target: 52/52
GREEN — active-runtime full gate: 216/216, typecheck PASS, build PASS
GREEN — Node v22.23.1 full gate: 216/216, typecheck PASS, build PASS
GREEN — package dry run: 90 files, 195236 bytes
GREEN — Loom-owned process residue: none
```
