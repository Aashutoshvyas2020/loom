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
