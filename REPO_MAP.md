# Loom Repository Map

Assessment key: `PASS` = present and validated for its current gate; `PARTIAL` = present but later work remains; `FAIL` = known broken; `PLANNED` = intentionally absent until its owning task.

This map is exhaustive for the tracked governance baseline. Validate it against `git ls-files | sort` before every gate/commit that changes tracked files.

## Tracked files

### `.gitignore`
- **Purpose:** Excludes dependencies, build output, packages, macOS metadata, coverage, and local skill-observation state.
- **Success check:** `git status --short` does not show ignored runtime/generated directories.
- **Current assessment:** PASS
- **Evidence:** Contains `node_modules/`, `dist/`, `*.tgz`, `.DS_Store`, `coverage/`, and `skill-observations/`.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0 / G0.

### `AGENTS.md`
- **Purpose:** Mandatory execution, TDD, governance, and completion contract for implementation agents.
- **Success check:** Requires the canonical read order, startup command, map gate, same-commit governance updates, and evidence discipline.
- **Current assessment:** PASS
- **Evidence:** Loaded by DevSpace and read before repository work.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0 / G0.

### `ALGORITHM.md`
- **Purpose:** Compact ordered implementation loop.
- **Success check:** Twenty lines or fewer and consistent with AGENTS.md.
- **Current assessment:** PASS
- **Evidence:** Fifteen numbered steps; mandates startup, G0, TDD, verification, governance, and handoff.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0 / G0.

### `CHANGELOG.md`
- **Purpose:** Human-readable implementation and evidence history.
- **Success check:** Updated in every repository-changing commit with actual command/test evidence.
- **Current assessment:** PARTIAL
- **Evidence:** Records T0 initialization; must be updated before the G0 commit.
- **Last meaningful change:** T0 initialization, 2026-07-07.
- **Owning task or gate:** All tasks; current T0 / G0.

### `HANDOFF.md`
- **Purpose:** Exact resumable state, commands, failures, blockers, SHA, and next action.
- **Success check:** Contains every field required by plan Section 25 and an executable next command.
- **Current assessment:** PARTIAL
- **Evidence:** Captures initial no-commit state and startup command; must be refreshed before the G0 commit.
- **Last meaningful change:** T0 initialization, 2026-07-07 23:36 PDT.
- **Owning task or gate:** All tasks; current T0 / G0.

### `LICENSE`
- **Purpose:** MIT license for Loom source distribution.
- **Success check:** Valid MIT license text with copyright attribution.
- **Current assessment:** PASS
- **Evidence:** Present at repository root.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0 / T15.

### `README.md`
- **Purpose:** Minimal repository identity and readiness warning during implementation.
- **Success check:** Names Loom, foreground-only scope, active branch, and G7 requirement without claiming release readiness.
- **Current assessment:** PASS
- **Evidence:** Root README contains no unsupported release claim.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0; final expansion T15.

### `REPO_MAP.md`
- **Purpose:** Exhaustive tracked-file ledger with ownership, checks, assessment, and evidence.
- **Success check:** Extracted path headings exactly match `git ls-files | sort` with no undocumented tracked files.
- **Current assessment:** PASS
- **Evidence:** G0 commit `868d20d2d2cf17bef2992abe6b95d9d4152cd223` matched the map exactly; this update adds the two T0 tracked paths before the next staged-index validation.
- **Last meaningful change:** T0 bootstrap map update, 2026-07-08.
- **Owning task or gate:** All tasks; current T0 / G0.

### `SPEC.md`
- **Purpose:** Approved behavioral, security, dependency, command, and release contract.
- **Success check:** Consistent with the canonical plan, including macOS 14+, persistent owner password, and sole unrestricted command `loom launch --yolo`.
- **Current assessment:** PASS
- **Evidence:** Updated after the independent release-blocker review and latest YOLO amendment.
- **Last meaningful change:** T0 amended baseline, 2026-07-07.
- **Owning task or gate:** T0 / G0 and every behavior-changing task.

### `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- **Purpose:** Full self-contained ordered implementation plan and certification contract.
- **Success check:** Covers Sections 0–26, T0–T16, G0–G7, latest audit corrections, and `loom launch --yolo`.
- **Current assessment:** PASS
- **Evidence:** 2026-07-08 amended implementation baseline exists at the canonical path.
- **Last meaningful change:** Reconstructed and amended during T0, 2026-07-07.
- **Owning task or gate:** T0 / G0; source of truth for all later tasks.

### `package-lock.json`
- **Purpose:** Reproducible exact npm dependency graph.
- **Success check:** `npm ci` succeeds and direct dependencies match package.json exact pins.
- **Current assessment:** PASS
- **Evidence:** Generated by npm 11.12.1; install reported 106 packages and zero vulnerabilities.
- **Last meaningful change:** T0 dependency installation, 2026-07-07.
- **Owning task or gate:** T0 / G1.

### `package.json`
- **Purpose:** Package identity, Node floor, executable mapping, exact dependencies, and validation scripts.
- **Success check:** No dependency ranges; Node `>=22`; exact runtime pins; build/typecheck/test/start/pack scripts present.
- **Current assessment:** PASS
- **Evidence:** `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` pass with exact dependency pins.
- **Last meaningful change:** T0 bootstrap validation, 2026-07-08.
- **Owning task or gate:** T0 / G1; later T15 packaging.

### `src/audit.ts`
- **Purpose:** Private durable JSONL audit logging with bounded serialization, mutation fail-closed deadlines, rotation, retention, degradation state, and metadata redaction.
- **Success check:** Mutation start resolves only after fsync, saturation/deadline/write failure disables later mutations, reads remain non-throwing, files remain 0600 in a 0700 directory, rotation is parseable, and forbidden values never appear.
- **Current assessment:** PASS
- **Evidence:** `test/audit.test.ts` passes 8/8; full suite passes 47/47.
- **Last meaningful change:** T3 audit completion, 2026-07-08.
- **Owning task or gate:** T3; integrated by terminal, files, memory, browser, and runtime tasks.

### `src/atomic-file.ts`
- **Purpose:** Durable same-directory atomic replacement with per-canonical-path serialization and optimistic conflict detection.
- **Success check:** Enforces the write-size limit, rejects symlink paths, preserves existing mode, creates new files as 0600, fsyncs file and parent directory, cleans temporary files, and allows only one concurrent writer sharing an expected hash to succeed.
- **Current assessment:** PASS
- **Evidence:** `test/atomic-file.test.ts` passes 5/5; full suite passes 14/14.
- **Last meaningful change:** T1 atomic-file foundation, 2026-07-08.
- **Owning task or gate:** T1; reused by config, OAuth, audit state, memory, and file tools.

### `src/child-wrapper.ts`
- **Purpose:** Detached process-group leader that receives launch data only over IPC, starts targets with ignored stdin, forwards separate output streams, and independently watches parent identity.
- **Success check:** Wrapper and target share one dedicated PGID; missed heartbeat or process-table parent mismatch triggers whole-group TERM then KILL cleanup without relying on IPC closure.
- **Current assessment:** PASS
- **Evidence:** Forced-parent-SIGKILL test removes wrapper, target, and grandchild; full suite leaves no matching processes.
- **Last meaningful change:** T2 wrapper/watchdog completion, 2026-07-08.
- **Owning task or gate:** T2 / G2; reused for terminal, Cloudflared, and Chromium.

### `src/cli.ts`
- **Purpose:** Executable command boundary for version/help, explicit YOLO opt-in, configuration management, and owner-credential rotation.
- **Success check:** Plain launch refuses access; reset commands require bounded direct `/dev/tty` confirmation; auth reset refuses a live runtime lock and emits the new owner password only to the local terminal.
- **Current assessment:** PASS
- **Evidence:** Eight real subprocess/PTTY tests pass, including live process-table lock matching, genuinely sessionless `/dev/tty` failure, config reset, and credential rotation.
- **Last meaningful change:** T4 owner reset command, 2026-07-08.
- **Owning task or gate:** T0 / G1, T1, and T4; expanded by later CLI/runtime tasks.

### `src/config.ts`
- **Purpose:** Secure Loom state initialization, strict versioned configuration, invalid-config reset/preservation, private runtime-lock persistence, and PID-reuse identity comparison.
- **Success check:** Creates the exact 0700 state tree, writes 0600 files atomically, repairs current-owner permissions, rejects symlink/wrong-shape state, validates config without mutation, preserves invalid bytes on reset, and requires all runtime identity fields to match.
- **Current assessment:** PASS
- **Evidence:** `test/config.test.ts` passes 7/7 and the real PTY CLI reset test passes through macOS Expect.
- **Last meaningful change:** T1 secure state/config completion, 2026-07-08.
- **Owning task or gate:** T1; reused by T4, T9, T11, and T14.

### `src/limits.ts`
- **Purpose:** Single source of truth for all fixed Loom v1 byte, time, count, and shutdown limits.
- **Success check:** Every exported value exactly matches plan Section 8 and boundary tests import the production constants.
- **Current assessment:** PASS
- **Evidence:** `test/limits.test.ts` passes and verifies all nineteen approved constants.
- **Last meaningful change:** T1 limits foundation, 2026-07-08.
- **Owning task or gate:** T1 / G2 and later consumers.

### `src/process-manager.ts`
- **Purpose:** Launches wrapper-owned detached process groups, streams bounded output, sends heartbeats, validates ownership, manages timeout/cancellation, and enforces TERM-to-KILL shutdown deadlines.
- **Success check:** Real processes have no PTY/stdin, natural exit and cancellation clean descendants, SIGTERM-resistant targets receive SIGKILL, forced manager death is recovered, and no test descendants remain.
- **Current assessment:** PASS
- **Evidence:** `test/process-manager.test.ts` passes 7/7; post-suite `ps` scan is empty.
- **Last meaningful change:** T2 process manager completion, 2026-07-08.
- **Owning task or gate:** T2 / G2; later used by terminal, Cloudflare, browser, and runtime orchestration.

### `src/oauth.ts`
- **Purpose:** Persistent single-owner credentials and endpoint-bound OAuth client, authorization-code, access-token, refresh-token, revocation, metadata, and endpoint-generation state.
- **Success check:** Owner password is scrypt-hashed and persistent; all opaque secrets are hashed at rest; codes are single-use; refresh rotates; exact `/mcp` resource/audience, scope, client, redirect, PKCE, expiry, revocation, and endpoint generation are enforced atomically.
- **Current assessment:** PASS
- **Evidence:** `test/oauth.test.ts` passes 8/8; combined T4 suite passes 16/16; full suite passes 57/57.
- **Last meaningful change:** T4 endpoint-bound OAuth completion, 2026-07-08.
- **Owning task or gate:** T4; served by T5 MCP transport and runtime endpoint binding.

### `src/output.ts`
- **Purpose:** Ordered bounded terminal-output storage with sanitization, binary suppression, head/tail retention, cursor pagination, gap detection, and terminal state.
- **Success check:** Preserves stdout/stderr append order, strips ANSI/unsafe controls, never splits UTF-8, reports exact truncation cursors, and records completed/cancelled/timed-out outcomes.
- **Current assessment:** PASS
- **Evidence:** `test/output.test.ts` passes 6/6; full suite passes 29/29.
- **Last meaningful change:** T2 output foundation, 2026-07-08.
- **Owning task or gate:** T2 / G2; reused by terminal and Cloudflared process management.

### `src/paths.ts`
- **Purpose:** Parse absolute or `~/` user paths, reject malformed input, and prevent writes through existing symbolic-link components.
- **Success check:** Rejects empty, relative, alternate-home, NUL, malformed-Unicode, symlink-parent, symlink-final, and non-directory-intermediate paths while allowing a missing tail under real directories.
- **Current assessment:** PASS
- **Evidence:** `test/paths.test.ts` passes 4/4 against real temporary files and symlinks on macOS.
- **Last meaningful change:** T1 path-policy foundation, 2026-07-08.
- **Owning task or gate:** T1; reused by T6, T7, T9, and runtime state.

### `test/audit.test.ts`
- **Purpose:** Real-filesystem proof for durable starts, 0700/0600 permissions, queue saturation, deadline failure, disk failure, serialized rotation, retention, read availability, finish duration, and redaction.
- **Success check:** All failure paths are explicit, no JSONL line is corrupted, and secret/content literals are absent from persisted bytes.
- **Current assessment:** PASS
- **Evidence:** Eight targeted tests pass, including fixed-time rotation/retention and a one-millisecond durable-start deadline.
- **Last meaningful change:** T3 audit RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T3.

### `test/atomic-file.test.ts`
- **Purpose:** Real-filesystem proof for atomic replacement, permissions, expected-hash conflicts, same-path serialization, cleanup, size limits, and symlink rejection.
- **Success check:** Exactly one of two concurrent expected-hash writers succeeds and no `.tmp` residue remains after success or rejection.
- **Current assessment:** PASS
- **Evidence:** Targeted suite reports 5 passed, 0 failed.
- **Last meaningful change:** T1 atomic-file RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T1.

### `test/cli.test.ts`
- **Purpose:** Real-process and real-PTY tests for package metadata, launch refusal, config commands, live-lock safety, and owner-password reset.
- **Success check:** Proves exact pins/support floor, no plain launch, `/dev/tty` confirmation, refusal while a matching runtime is live, no sessionless bypass, non-auth-state preservation, new-password verification, and OAuth revocation.
- **Current assessment:** PASS
- **Evidence:** Eight tests pass using macOS Expect and Python `setsid()` for a genuinely terminal-less child.
- **Last meaningful change:** T4 auth reset RED/GREEN and terminal-cleanup debugging, 2026-07-08.
- **Owning task or gate:** T0 / G1, T1, and T4.

### `test/config.test.ts`
- **Purpose:** Real-filesystem tests for state permissions, strict config validation, non-mutating checks, invalid-config preservation, runtime-lock storage, and full identity matching.
- **Success check:** Exercises 0700/0600 creation and repair, symlink rejection, schema failures, timestamped backup bytes, strict lock parsing, and every PID-reuse defense field.
- **Current assessment:** PASS
- **Evidence:** Targeted suite reports 7 passed, 0 failed; full suite reports 23 passed, 0 failed.
- **Last meaningful change:** T1 secure state/config RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T1.

### `test/limits.test.ts`
- **Purpose:** Locks every centralized Loom v1 limit to the approved specification.
- **Success check:** Exact value comparison passes without duplicating runtime logic.
- **Current assessment:** PASS
- **Evidence:** Targeted and full test suites pass.
- **Last meaningful change:** T1 limits RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T1.

### `src/watchdog.ts`
- **Purpose:** macOS process-table observation using `ps` plus canonical executable resolution using `lsof`, observable identity matching, and PGID membership scans.
- **Success check:** Returns PID/PPID/PGID/start time/canonical executable, treats missing PIDs as absent, and rejects any PID/start/executable mismatch.
- **Current assessment:** PASS
- **Evidence:** `test/watchdog.test.ts` passes 3/3 against live macOS processes.
- **Last meaningful change:** T2 watchdog identity completion, 2026-07-08.
- **Owning task or gate:** T2 / G2; reused by runtime and browser lock recovery.

### `test/oauth.test.ts`
- **Purpose:** State-level security tests for owner credentials, registration, PKCE code exchange, exact endpoint binding, token validation, rotation, replay prevention, expiry, revocation, reset, metadata, and at-rest secrecy.
- **Success check:** Every invalid binding fails; same endpoint preserves state; endpoint change and owner reset revoke OAuth state without unintended owner/config rotation; plaintext secrets never appear in `auth.json`.
- **Current assessment:** PASS
- **Evidence:** Eight targeted tests pass in about one second.
- **Last meaningful change:** T4 OAuth RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T4.

### `test/output.test.ts`
- **Purpose:** Boundary tests for terminal stream ordering, sanitization, deterministic binary markers, exact truncation, cursor pagination, UTF-8 boundaries, and lifecycle states.
- **Success check:** Stale cursors report gaps and pagination preserves source order without duplication or loss.
- **Current assessment:** PASS
- **Evidence:** Targeted suite reports 6 passed, 0 failed.
- **Last meaningful change:** T2 output RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T2 / G2.

### `test/process-manager.test.ts`
- **Purpose:** Real-process proof for no PTY/stdin, dedicated groups, complete descendant cleanup, hard-kill escalation, parent-death watchdog recovery, natural exit, and timeouts.
- **Success check:** Every test ends with an empty owned PGID and no leaked wrapper/target/grandchild process.
- **Current assessment:** PASS
- **Evidence:** Seven tests pass in about two seconds; external post-suite `ps` scan found no matching processes.
- **Last meaningful change:** T2 real-process RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T2 / G2.

### `test/paths.test.ts`
- **Purpose:** Real-filesystem tests for user-path parsing and symbolic-link rejection.
- **Success check:** Covers accepted absolute/home paths, hostile path strings, malformed surrogate pairs, missing tails, and real directory/file symlinks.
- **Current assessment:** PASS
- **Evidence:** Targeted suite passes 4/4 after canonicalizing macOS temporary roots through `realpath`.
- **Last meaningful change:** T1 path-policy RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T1.

### `test/watchdog.test.ts`
- **Purpose:** Live macOS tests for canonical executable identity, PID-reuse defenses, process-group scans, and absent PID handling.
- **Success check:** Identity changes in PID, start time, or executable all fail matching.
- **Current assessment:** PASS
- **Evidence:** Targeted suite reports 3 passed, 0 failed.
- **Last meaningful change:** T2 watchdog RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T2 / G2.

### `tsconfig.json`
- **Purpose:** Strict NodeNext TypeScript compilation for source and tests.
- **Success check:** `npm run typecheck` and `npm run build` pass with Node types loaded explicitly.
- **Current assessment:** PASS
- **Evidence:** Added `types: ["node"]`; clean-install typecheck and build pass.
- **Last meaningful change:** T0 test-infrastructure correction, 2026-07-08.
- **Owning task or gate:** T0 / G1.

## Planned paths by owning task

These are intentionally untracked until their task begins and therefore must not appear in `git ls-files` at G0.

- **T5:** `src/mcp.ts`, `src/tools/register.ts`, `test/mcp.test.ts`.
- **T6:** `src/tools/files.ts`, `test/files.test.ts`.
- **T7:** `src/catalog.ts`, `src/tools/knowledge.ts`, `test/catalog.test.ts`.
- **T8:** `src/dashboard.ts`, `public/dashboard.html`, `public/dashboard.css`, `public/dashboard.js`, `test/dashboard.test.ts`.
- **T9:** `src/browser.ts`, `src/tools/browser.ts`, `test/browser.test.ts`.
- **T10–T13:** `src/cloudflare.ts`, `test/cloudflare.test.ts`.
- **T14:** `src/runtime.ts`, `test/runtime.test.ts`.
- **T15:** release documentation/notices and `docs/release-evidence/` index as required.
