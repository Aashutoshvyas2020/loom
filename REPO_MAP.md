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
- **Success check:** Requires canonical read/startup order, test-first work, explicit plan amendments before task regrouping, same-commit governance, and green typecheck/test/build/map gates before commits.
- **Current assessment:** PASS
- **Evidence:** T5 recovery hardened the execution contract after the adversarial review exposed task drift.
- **Last meaningful change:** T5 recovery governance hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0 and all later gates.

### `ALGORITHM.md`
- **Purpose:** Compact ordered implementation loop.
- **Success check:** Twenty lines or fewer, plan amendment required before regrouping/skipping, and commits require green typecheck/tests/build/map/governance.
- **Current assessment:** PASS
- **Evidence:** Fifteen numbered steps remain within the line limit and match AGENTS.md.
- **Last meaningful change:** T5 recovery governance hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0 and all later gates.

### `CHANGELOG.md`
- **Purpose:** Human-readable implementation and evidence history.
- **Success check:** Updated in every repository-changing commit with actual command/test evidence.
- **Current assessment:** PASS
- **Evidence:** Records T0–T13.1 implementation history, required RED/GREEN evidence, concurrent-agent reconciliation, wrapper-handshake root cause, exact target/full-suite counts, stress/process-residue checks, and the remaining real G5/G6 certification boundary.
- **Last meaningful change:** T13.1 terminal recovery and wrapper-handshake evidence, 2026-07-08.
- **Owning task or gate:** All tasks; current T13.1.

### `HANDOFF.md`
- **Purpose:** Exact resumable state, commands, failures, blockers, SHA, and next action.
- **Success check:** Contains every field required by plan Section 25 and an executable next command.
- **Current assessment:** PASS
- **Evidence:** Records completed T14 foreground runtime/default assembly/CLI evidence, exact 49-test target, 90/90 runtime stress executions, full 185-test gate, empty Loom-owned process/listener scans, parent HEAD, exact dirty scope, real remaining blockers, and the T14 commit command.
- **Last meaningful change:** T14 runtime orchestration completion handoff, 2026-07-08.
- **Owning task or gate:** All tasks; current T14.

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
- **Evidence:** T14 updates runtime, CLI, config, OAuth, ProcessManager visibility, four test ledgers, specification, plan, changelog, and handoff while preserving an empty staged tracked-path diff against `git ls-files`.
- **Last meaningful change:** T14 runtime orchestration map update, 2026-07-08.
- **Owning task or gate:** All tasks; current T14.

### `SPEC.md`
- **Purpose:** Approved behavioral, security, dependency, command, and release contract.
- **Success check:** Matches the canonical plan including server-bound authorization transactions, direct owned-binary spawning, canonical cwd/PATH symlink handling, browser install/recovery/shutdown boundaries, catalog diagnostics, and sole unrestricted command `loom launch --yolo`.
- **Current assessment:** PASS
- **Evidence:** T14 locks the real YOLO foreground lifecycle, exclusive identity-bound lock, exact startup/publication/shutdown order, all-seven-handler production assembly, browser degradation, pinned tunnel selection/no fallback, secret-free status/TTY credential display, dashboard mutations, signal handling, absolute deadline, and fail-closed ownership preservation.
- **Last meaningful change:** T14 foreground runtime and CLI security contract, 2026-07-08.
- **Owning task or gate:** T0 / G0 and every behavior-changing task.

### `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- **Purpose:** Full self-contained ordered implementation plan and certification contract.
- **Success check:** Covers Sections 0–26, T0–T16, G0–G7, exact governance gates, accepted adversarial-audit hardening, and `loom launch --yolo`.
- **Current assessment:** PASS
- **Evidence:** T14 now records the concrete production assembly, CLI/TTY boundary, strict dashboard mutations, lock/deadline ownership rules, browser-degraded mode, controlled integration contract, and 80-run zero-residue stress evidence; G5/G6/T15/T16 remain separate.
- **Last meaningful change:** T14 runtime orchestration implementation clarification, 2026-07-08.
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
- **Success check:** No dependency ranges; Node `>=22`; exact runtime pins; clean/build/typecheck/test/start/pack scripts present; build removes stale output before compiling.
- **Current assessment:** PASS
- **Evidence:** A stale-dist reproduction executed quarantined tests; `build` now runs `clean` first and the full tracked suite passes 64/64.
- **Last meaningful change:** T5 recovery clean-build hardening, 2026-07-08.
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

### `src/browser.ts`
- **Purpose:** Dependency-free browser backend contract, result types, and typed public/backend error hierarchy.
- **Success check:** Defines every approved browser action result and shutdown contract without loading Playwright or performing side effects.
- **Current assessment:** PASS
- **Evidence:** Imported by both public policy and backend modules; browser target and full 120-test suite typecheck and pass.
- **Last meaningful change:** T9 browser contract separation, 2026-07-08.
- **Owning task or gate:** T9 / G4.

### `src/browser/backend.ts`
- **Purpose:** Wrapper-owned persistent Chromium/CDP lifecycle, tabs/actions, browser lock recovery, bounded page operations, downloads, screenshots, permissions, geolocation, and graceful shutdown.
- **Success check:** Uses direct ProcessManager executable/argv launch, guarded Playwright import, dedicated profile, PID-reuse-safe lock recovery, twelve-tab bound, per-tab timeout recovery, private no-overwrite artifacts, CDP `Browser.close`, and bounded cancellation fallback.
- **Current assessment:** PASS
- **Evidence:** Deterministic browser tests cover lock identity, false positives, downloads, shutdown, snapshot/evaluate recovery, and dispatcher boundaries; real Chrome restored localStorage across two controlled restarts with no process or lock residue.
- **Last meaningful change:** T9 managed Chromium backend and profile-persistence repair, 2026-07-08.
- **Owning task or gate:** T9 / G4; composed by T14 runtime.

### `src/browser/setup.ts`
- **Purpose:** Explicit architecture-pinned Chromium acquisition, exact executable verification, wrapper-owned CDP launch proof, private manifest, atomic promotion, and rollback.
- **Success check:** Resolves the local Playwright CLI independent of cwd, forces the official CDN, skips the unused headless shell, rejects symlinks/hash mismatches, verifies real loopback CDP readiness, and restores an old installation after promoted verification failure.
- **Current assessment:** PASS
- **Evidence:** Deterministic install/rollback/CWD/launch tests pass; real arm64 setup verified revision 1228, Chrome 149.0.7827.55, executable SHA-256 `b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7`, private modes, and no residue.
- **Last meaningful change:** T9 pinned browser setup and real launch correction, 2026-07-08.
- **Owning task or gate:** T9 / G4 and T16 certification.

### `src/child-wrapper.ts`
- **Purpose:** Detached process-group leader that receives launch data only over IPC, starts targets with ignored stdin, forwards separate output streams, flushes lifecycle IPC in order, and independently watches parent identity.
- **Success check:** Wrapper and target share one dedicated PGID; `ready` is delivered before a fast target `exit`/disconnect; startup errors flush before disconnect; duplicate finish paths are suppressed; missed heartbeat or parent-identity mismatch triggers whole-group TERM then KILL cleanup.
- **Current assessment:** PASS
- **Evidence:** Twenty rapid zero-work targets complete without losing readiness; forced-parent-SIGKILL removes wrapper, target, and grandchild; five terminal stress runs and the full 167-test suite leave no matching processes.
- **Last meaningful change:** T13.1 fast-target IPC ordering hardening, 2026-07-08.
- **Owning task or gate:** T2 / G2 and T13.1; reused for terminal, Cloudflared, and Chromium.

### `src/cli.ts`
- **Purpose:** Executable command boundary for version/help, explicit foreground YOLO launch, browser setup, configuration management, and owner-credential rotation.
- **Success check:** Plain launch refuses access; exact `launch --yolo` requires macOS 14+/Node 22+ and direct `/dev/tty`, prints the warning/new owner password only locally, invokes the production foreground runtime, and cleans a factory-created lock on launch failure; existing setup/reset safety remains intact.
- **Current assessment:** PASS
- **Evidence:** Thirteen CLI tests pass, including injected exact YOLO routing and a genuinely terminal-less YOLO attempt that creates no `~/.loom`, plus package-bin/PTTY/setup/reset/live-lock coverage.
- **Last meaningful change:** T14 real foreground YOLO launch and support/TTY boundary, 2026-07-08.
- **Owning task or gate:** T0 / G1, T1, T4, T9, and T14.

### `src/cloudflare.ts`
- **Purpose:** Pinned Cloudflared acquisition/verification plus Quick and Named Tunnel validation, direct launch, bounded readiness, retry, audit, status, and cleanup.
- **Success check:** Retains T10/T12 guarantees; named mode validates private stable certificate/current credentials and exact name/account/hostname, launches explicit ephemeral origin argv, exposes production status only after registration, revalidates every attempt, retries only transient failures five times with capped backoff, never falls back to Quick, fails closed on audit/auth/config/cleanup uncertainty, and aborts startup waits on stop without recreation.
- **Current assessment:** PASS
- **Evidence:** Cloudflared target passes 30/30. Thirteen named tests prove static validation, exact argv/status, endpoint/password persistence, retry classification/limits, auth/config fail-fast, audit secrecy/order, timeout cleanup, per-attempt revalidation, cleanup failure, benign config notices, option-like rejection, and prompt startup cancellation. T10 real official binary/network evidence remains valid; G5 real named certification remains pending.
- **Last meaningful change:** T13 Named Tunnel manager and validation, 2026-07-08.
- **Owning task or gate:** T10 acquisition, T12 Quick Tunnel, and T13 Named Tunnel; consumed by T14.

### `src/config.ts`
- **Purpose:** Secure Loom state initialization, strict versioned configuration, private atomic next-launch replacement, invalid-config preservation, runtime-lock persistence, and PID-reuse identity comparison.
- **Success check:** Creates/repairs private state, validates without mutation, atomically writes strict 0600 config without symlink traversal, canonicalizes named values, preserves invalid bytes on reset, and requires exact runtime identity.
- **Current assessment:** PASS
- **Evidence:** Eight config tests pass, including T14 `writeConfig` canonical/private replacement and unknown-key rejection; the 45-test T14 target and 181-test full suite are green.
- **Last meaningful change:** T14 audited dashboard next-launch config writer, 2026-07-08.
- **Owning task or gate:** T1, T13, and T14.

### `src/limits.ts`
- **Purpose:** Single source of truth for all fixed Loom v1 byte, time, count, retry, and shutdown limits.
- **Success check:** Every exported value exactly matches plan Section 8 and boundary tests import the production constants.
- **Current assessment:** PASS
- **Evidence:** `test/limits.test.ts` passes and verifies all 36 approved constants, including twelve T13.1 command/environment/poll/wait/timeout/retention/job-ID limits.
- **Last meaningful change:** T13.1 terminal limit additions, 2026-07-08.
- **Owning task or gate:** T1 / G2, T13, T13.1, and later consumers.

### `src/process-manager.ts`
- **Purpose:** Launches wrapper-owned detached process groups, streams bounded output, sends heartbeats, validates ownership, manages startup/exit races, timeout/cancellation, and TERM-to-KILL shutdown deadlines.
- **Success check:** Real processes have no PTY/stdin; wrapper exit before readiness rejects immediately; exit events between readiness and managed construction are preserved; natural exit/cancellation clean descendants; transient `EPERM` is revalidated; persistent `EPERM` fails closed; forced manager death is recovered; and no test descendants remain.
- **Current assessment:** PASS
- **Evidence:** T14 exposes read-only `activeCount` for deterministic runtime cleanup/deadline ownership checks; prior 13/13 process/watchdog and 40/40 terminal stress evidence remains green, and the full suite now passes 185/185.
- **Last meaningful change:** T14 runtime cleanup visibility, 2026-07-08.
- **Owning task or gate:** T2 / G2, T12.1, T13.1, and T14.

### `src/runtime.ts`
- **Purpose:** T11 readiness plus T14 exclusive foreground lifecycle, production component assembly, lock/state ownership, status, signals, dashboard actions, and reverse cleanup.
- **Success check:** Builds all seven handlers; acquires an identity-bound exclusive lock before audit; starts MCP NOT_READY/dashboard/catalogs/browser/tunnel in order; publishes exact `/mcp` once; supports verified browser or missing/corrupt-manifest degraded mode and pinned Quick/Named tunnel without fallback; opens the authenticated local dashboard by default; handles explicit/dashboard/signal stops; enforces a real 15-second per-step deadline; terminates public listeners/process groups; and removes exact readiness state plus lock only after content/identity ownership and cleanup certainty.
- **Current assessment:** PASS
- **Evidence:** Runtime target passes 18/18, combined T14 target passes 49/49, five runtime runs pass 90/90, full suite passes 185/185, and post-stress Loom-owned process/listener scans are empty.
- **Last meaningful change:** T14 full foreground runtime and default production assembly, 2026-07-08.
- **Owning task or gate:** T11 and T14; consumed by T15/T16 and real G5/G6 certification.

### `src/mcp.ts`
- **Purpose:** Loopback-only Streamable HTTP MCP and OAuth HTTP server with deterministic readiness, endpoint-bound bearer authentication, server-bound authorization transactions, token routes, and bounded client-bound sessions.
- **Success check:** Authorization GET stores the request server-side; POST accepts only transaction ID and owner password; replay/substitution fail; strict CSP/frame/no-store headers apply; SDK metadata strings are normalized without `any`; sessions and readiness remain bounded.
- **Current assessment:** PASS
- **Evidence:** Targeted MCP/OAuth tests pass 15/15 and the full tracked suite passes 64/64.
- **Last meaningful change:** T5 authorization-boundary recovery, 2026-07-08.
- **Owning task or gate:** T5; consumed by runtime/tunnel integration and later concrete tool handlers.

### `src/oauth.ts`
- **Purpose:** Persistent single-owner credentials and endpoint-bound OAuth clients, authorization transactions/codes, access/refresh tokens, revocation, metadata, and endpoint-generation state.
- **Success check:** Exact endpoint/generation bindings remain atomic; `revokeAllOAuth` increments generation and clears clients/codes/tokens while preserving the canonical endpoint and owner credential; owner reset remains the only password rotation path.
- **Current assessment:** PASS
- **Evidence:** Nine OAuth tests pass, including T14 dashboard revocation that invalidates an issued token, preserves endpoint/password, and permits fresh registration; the 45-test T14 target is green.
- **Last meaningful change:** T14 owner-preserving revoke-all dashboard action, 2026-07-08.
- **Owning task or gate:** T4, T5, and T14.

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

### `test/browser.test.ts`
- **Purpose:** Deterministic and real-local boundary tests for pinned setup, wrapper-owned launch, install rollback, browser locks, artifacts, audit policy, validation, dispatch, graceful shutdown, and per-tab recovery.
- **Success check:** Proves exact hashes and symlink rejection, CWD-independent official-CDN installer arguments, CDP readiness cleanup, stale-lock identity rules, no-overwrite downloads, audit secrecy/fail-closed behavior, all actions, bounded snapshot/evaluate recovery, natural shutdown, and cancellation fallback.
- **Current assessment:** PASS
- **Evidence:** Targeted browser suite passes 19/19; real external evidence additionally proves pinned arm64 setup and profile persistence across controlled restarts.
- **Last meaningful change:** T9 browser RED/GREEN and real-browser debugging, 2026-07-08.
- **Owning task or gate:** T9 / G4.

### `test/cli.test.ts`
- **Purpose:** Real-process/PTY and injected-routing tests for package/bootstrap, setup/reset, plain-launch refusal, and explicit foreground YOLO launch.
- **Success check:** Proves exact `launch --yolo` routes once, a sessionless launch fails before state creation, plain launch remains refused, and all prior symlink/setup/config/auth reset protections remain.
- **Current assessment:** PASS
- **Evidence:** Target passes 14/14 and participates in the 49/49 T14 target and 185/185 full suite.
- **Last meaningful change:** T14 YOLO launch routing and local-terminal refusal, 2026-07-08.
- **Owning task or gate:** T0 / G1, T1, T4, T9, and T14.

### `test/cloudflare.test.ts`
- **Purpose:** Deterministic acquisition/verification plus Quick and Named Tunnel parser, trust, lifecycle, retry, audit, OAuth, status, and cleanup tests.
- **Success check:** Retains T10/T12 checks and proves named certificate/credential validation, exact direct argv, registration gating, hidden pre-ready status, bounded transient-only retries, no fallback, per-attempt revalidation, cleanup fail-closed behavior, prompt stop cancellation, audit secrecy/order, stable endpoint generation, and owner-password persistence.
- **Current assessment:** PASS
- **Evidence:** Targeted Cloudflared suite passes 30/30; combined T13 Cloudflare/config/limits target passes 38/38; full tracked suite passes 158/158 with no delayed Loom-owned process residue. The unrelated DevSpace Cloudflared tunnel is explicitly excluded.
- **Last meaningful change:** T13 Named Tunnel adversarial RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T10, T12, and T13.

### `test/config.test.ts`
- **Purpose:** Real-filesystem tests for state permissions, strict config validation, non-mutating checks, invalid-config preservation, runtime-lock storage, full identity matching, and named-tunnel config canonicalization.
- **Success check:** Exercises private creation/repair, symlink rejection, schema failures, named stable-hostname/name boundaries, timestamped backup bytes, strict lock parsing, and every PID-reuse defense field.
- **Current assessment:** PASS
- **Evidence:** Targeted suite passes 8/8, adding strict private atomic `writeConfig`; combined T14 target passes 49/49 and full suite passes 185/185.
- **Last meaningful change:** T14 next-launch config replacement test, 2026-07-08.
- **Owning task or gate:** T1, T13, and T14.

### `test/limits.test.ts`
- **Purpose:** Locks every centralized Loom v1 limit to the approved specification.
- **Success check:** Exact value comparison passes without duplicating runtime logic.
- **Current assessment:** PASS
- **Evidence:** One exact-object test verifies all 36 constants, including twelve T13.1 terminal bounds; combined T13.1 target passes 19/19 and full suite passes 167/167.
- **Last meaningful change:** T13.1 terminal limit contract, 2026-07-08.
- **Owning task or gate:** T1, T13, and T13.1.

### `public/dashboard.css`
- **Purpose:** Minimal responsive styling for the authenticated loopback dashboard without inline CSS.
- **Success check:** Loads only inside an authenticated dashboard session and remains compatible with the strict self-only CSP.
- **Current assessment:** PASS
- **Evidence:** Targeted dashboard HTTP tests pass 2/2; full tracked suite passes 99/99.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `public/dashboard.html`
- **Purpose:** Static dashboard shell containing only redacted status surfaces, allowlisted controls, and the injected per-session CSRF meta value.
- **Success check:** Contains no inline executable content or secrets; requires an authenticated session; uses text-only rendering through dashboard.js.
- **Current assessment:** PASS
- **Evidence:** Bootstrap/session/CSRF/redaction tests pass through real HTTP.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `public/dashboard.js`
- **Purpose:** Same-origin dashboard client for redacted status and the fixed action allowlist.
- **Success check:** Sends credentials and X-Loom-CSRF, renders with textContent, never evaluates returned HTML, and exposes no generic command/action endpoint.
- **Current assessment:** PASS
- **Evidence:** Targeted dashboard action tests pass and unknown actions return 404.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `src/dashboard.ts`
- **Purpose:** Loopback-only dashboard HTTP server with one-time bootstrap, bounded sessions, exact Host/Origin validation, CSRF, strict headers, recursive redaction, and allowlisted actions.
- **Success check:** Nonces are single-use/expiring; cookies are HttpOnly SameSite=Strict; all pages/APIs require a session; mutations require exact Origin and CSRF; hostile Host and unknown actions fail.
- **Current assessment:** PASS
- **Evidence:** `test/dashboard.test.ts` passes 2/2; full tracked suite passes 99/99.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `src/tools/browser.ts`
- **Purpose:** Public `loom_browser` validation, audit policy, bounded result shaping, image return, typed error preservation, and dispatcher composition.
- **Success check:** Accepts only approved actions/schemes/origins/permissions/bounds, audits every browser mutation before backend work without secret content, keeps reads available after audit degradation, and never statically loads Playwright.
- **Current assessment:** PASS
- **Evidence:** Browser tests cover every action, unsafe URLs/origins/tabs/permissions/bounds, audit failure, audit secrecy, typed backend errors, screenshots, and six-tool fallback dispatch.
- **Last meaningful change:** T9 public browser tool boundary, 2026-07-08.
- **Owning task or gate:** T9 / G4.

### `src/tools/files.ts`
- **Purpose:** Concrete bounded text/image/binary read, audited atomic write, exact audited edit, and dispatcher composition for the three public file tools.
- **Success check:** Reads safely follow only a stable final symlink to a regular-file target, reject symlinked parents, detect image MIME by magic bytes, bound output, and hash the complete stable snapshot; writes/edits retain strict symlink rejection, audit-before-mutation, conflict detection, and atomic replacement.
- **Current assessment:** PASS
- **Evidence:** `test/files.test.ts` passes 11/11 and the full tracked suite passes 75/75.
- **Last meaningful change:** T6 file-tool implementation and final-symlink correction, 2026-07-08.
- **Owning task or gate:** T6.

### `src/tools/memory.ts`
- **Purpose:** Loom-owned stable-ID memory store with deterministic search, audited save/delete, crash-recovered tombstones, bounded rescans, and dispatcher composition.
- **Success check:** Save/delete are serialized and audited; stale valid tombstones are durably removed under audit; unsafe tombstones remain with diagnostics; malformed/oversized entries do not corrupt published snapshots; aggregate limits fail atomically.
- **Current assessment:** PASS
- **Evidence:** `test/memory.test.ts` passes 12/12; full tracked suite passes 97/97.
- **Last meaningful change:** T7 memory store and tombstone recovery, 2026-07-08.
- **Owning task or gate:** T7.

### `src/tools/skills.ts`
- **Purpose:** Bounded deterministic multi-root SKILL.md discovery, metadata extraction, search/read, diagnostics, and dispatcher composition.
- **Success check:** Symlinks are skipped, limits preserve prior snapshots, unterminated frontmatter is skipped with `malformed_frontmatter_skipped`, and skipped malformed bytes do not count as indexed bytes.
- **Current assessment:** PASS
- **Evidence:** `test/skills.test.ts` passes 10/10; full tracked suite passes 97/97.
- **Last meaningful change:** T7 skills catalog and malformed-frontmatter handling, 2026-07-08.
- **Owning task or gate:** T7.

### `src/tools/terminal.ts`
- **Purpose:** Concrete unrestricted but noninteractive terminal service and dispatcher using the sole static `/bin/sh -lc` ProcessManager adapter.
- **Success check:** Validates centralized command/environment/cwd/timeout/job/poll bounds; canonicalizes safe cwd symlinks; audits start/cancel before mutation without sensitive bytes; returns stable job IDs and cursor lifecycle metadata with output only in MCP content; never evicts running jobs; awaits audit completion before finished-job eviction; and cancels every retained running process group on shutdown.
- **Current assessment:** PASS
- **Evidence:** `test/terminal.test.ts` passes 8/8 with real shell output, cwd/environment, degraded-audit poll, timeout, grandchild cancellation, idempotent cancel, retention, shutdown, validation, and dispatcher coverage; five consecutive runs pass 40/40 with no residue; the combined target passes 19/19 and full suite passes 167/167.
- **Last meaningful change:** T13.1 terminal implementation recovery, 2026-07-08.
- **Owning task or gate:** T13.1; consumed by T14 runtime orchestration.

### `src/tools/register.ts`
- **Purpose:** Registers exactly seven public Loom MCP tools with strict Zod v4 action/path/size/URL schemas and an injected dispatcher.
- **Success check:** The public list contains only the seven approved tools; terminal schema bounds import centralized constants; every safe action dispatches; dangerous browser schemes, malformed paths, and oversized inputs fail before handlers.
- **Current assessment:** PASS
- **Evidence:** A real SDK client lists/calls all seven branches; T13.1 centralizes terminal command/environment/job/poll/wait/timeout bounds and its dispatcher delegates every non-terminal tool.
- **Last meaningful change:** T13.1 terminal schema centralization and concrete dispatcher, 2026-07-08.
- **Owning task or gate:** T5 registration and T13.1 terminal implementation; consumed by T14.

### `src/watchdog.ts`
- **Purpose:** macOS process-table observation using `ps` plus canonical executable resolution using `lsof`, observable identity matching, and PGID membership scans.
- **Success check:** Returns PID/PPID/PGID/start time/canonical executable, treats missing PIDs as absent, and rejects any PID/start/executable mismatch.
- **Current assessment:** PASS
- **Evidence:** `test/watchdog.test.ts` passes 3/3 against live macOS processes.
- **Last meaningful change:** T2 watchdog identity completion, 2026-07-08.
- **Owning task or gate:** T2 / G2; reused by runtime and browser lock recovery.

### `test/dashboard.test.ts`
- **Purpose:** Real HTTP tests for one-time bootstrap, cookies, strict headers, session/CSRF/Origin/Host boundaries, recursive redaction, and action allowlisting.
- **Success check:** Replayed nonces, missing sessions, wrong Origin/CSRF/Host, leaked secrets, and unknown actions are all rejected deterministically.
- **Current assessment:** PASS
- **Evidence:** Two targeted tests pass; full tracked suite passes 99/99.
- **Last meaningful change:** T8 dashboard RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T8.

### `test/files.test.ts`
- **Purpose:** Real-filesystem proof for stable/ranged reads, image magic bytes, explicit binary base64, stable final-symlink reads, parent/mutation symlink rejection, audited writes/edits, conflicts, concurrency, and dispatcher composition.
- **Success check:** Final-link reads return target content without weakening writes or edits; parent symlinks fail; content never enters audit records; one concurrent expected-hash writer wins; no temporary residue remains.
- **Current assessment:** PASS
- **Evidence:** Targeted suite passes 11/11; full tracked suite passes 75/75.
- **Last meaningful change:** T6 RED/GREEN cycle for file tools and approved symlink policy, 2026-07-08.
- **Owning task or gate:** T6.

### `test/memory.test.ts`
- **Purpose:** Real-filesystem tests for persistent stable IDs, ranking, audit fail-closed behavior, delete conflicts, concurrency, limits, symlink safety, tombstone recovery, diagnostics, and dispatcher composition.
- **Success check:** Valid stale tombstones are removed, unsafe tombstones remain diagnosed, aggregate limits are tested with individually valid files, and failed rescans preserve the prior immutable snapshot.
- **Current assessment:** PASS
- **Evidence:** Twelve targeted tests pass; full tracked suite passes 97/97.
- **Last meaningful change:** T7 memory RED/GREEN and aggregate-limit repair, 2026-07-08.
- **Owning task or gate:** T7.

### `test/runtime.test.ts`
- **Purpose:** T11 readiness plus T14 integrated real-local runtime, lock, signal, deadline, factory, degraded-browser, listener, process-group, and cleanup tests.
- **Success check:** Uses real audit, ProcessManager/terminal, MCP, dashboard, catalogs, dispatcher chain and runtime files; proves one readiness publication, public 401 transition, normal/startup-failure/signal/direct-stop cleanup, stop during tunnel startup without recreation, listener termination, deadline-preserved ownership, live/replaced lock refusal, exact current-state replacement refusal, default assembly/password persistence, browser degradation, and factory lock cleanup.
- **Current assessment:** PASS
- **Evidence:** Target passes 18/18; five consecutive runs pass 90/90 with no Loom-owned process or listener residue; combined T14 target passes 49/49 and full suite passes 185/185.
- **Last meaningful change:** T14 full runtime integration and stress cycle, 2026-07-08.
- **Owning task or gate:** T11 and T14.

### `test/skills.test.ts`
- **Purpose:** Tests deterministic discovery/ranking, stable IDs, duplicate names, symlink/depth/size/entry/total/time limits, missing roots, malformed frontmatter, and dispatcher composition.
- **Success check:** Unterminated frontmatter never becomes a skill and emits exactly one deterministic diagnostic while valid peers remain indexed.
- **Current assessment:** PASS
- **Evidence:** Ten targeted tests pass; full tracked suite passes 97/97.
- **Last meaningful change:** T7 malformed-frontmatter RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T7.

### `test/mcp.test.ts`
- **Purpose:** End-to-end loopback HTTP and pinned-SDK tests for readiness, metadata, bearer challenges, server-bound OAuth authorization, revocation, seven tools, session ownership/capacity/expiry, endpoint lifecycle, and clean shutdown.
- **Success check:** The authorization page contains only a transaction ID, has CSP and frame denial, ignores attacker-supplied POST parameters, rejects replay, and all existing transport/session behaviors remain green.
- **Current assessment:** PASS
- **Evidence:** Seven MCP tests pass; combined MCP/OAuth target passes 15/15; full tracked suite passes 64/64.
- **Last meaningful change:** T5 authorization-boundary RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T5.

### `test/oauth.test.ts`
- **Purpose:** State-level security tests for owner credentials, endpoint-bound OAuth, rotation/replay/expiry, reset, metadata, and owner-preserving revoke-all behavior.
- **Success check:** Existing tokens fail after revoke-all, endpoint/password remain unchanged, fresh registration succeeds, and all prior exact binding/secret-at-rest checks remain.
- **Current assessment:** PASS
- **Evidence:** Target passes 9/9 and participates in the 49/49 T14 target and 185/185 full suite.
- **Last meaningful change:** T14 revoke-all OAuth lifecycle test, 2026-07-08.
- **Owning task or gate:** T4 and T14.

### `test/output.test.ts`
- **Purpose:** Boundary tests for terminal stream ordering, sanitization, deterministic binary markers, exact truncation, cursor pagination, UTF-8 boundaries, and lifecycle states.
- **Success check:** Stale cursors report gaps and pagination preserves source order without duplication or loss.
- **Current assessment:** PASS
- **Evidence:** Targeted suite reports 6 passed, 0 failed.
- **Last meaningful change:** T2 output RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T2 / G2.

### `test/process-manager.test.ts`
- **Purpose:** Real-process proof for no PTY/stdin, dedicated groups, complete descendant cleanup, rapid natural-exit wrapper handshakes, hard-kill escalation, parent-death watchdog recovery, timeouts, and transient/persistent negative-PGID `EPERM` behavior.
- **Success check:** Every success test ends with an empty owned PGID; twenty rapid zero-work targets complete after the ready handshake; transient `EPERM` retries after ownership validation; persistent `EPERM` rejects at the deadline; and no wrapper/target/grandchild process remains.
- **Current assessment:** PASS
- **Evidence:** Ten process-manager tests pass, including twenty rapid natural exits and deterministic transient/persistent `EPERM`; the combined T13.1 target passes 19/19, full suite passes 167/167, and delayed residue scan is empty.
- **Last meaningful change:** T13.1 rapid natural-exit handshake regression, 2026-07-08.
- **Owning task or gate:** T2 / G2, T12.1, and T13.1.

### `test/paths.test.ts`
- **Purpose:** Real-filesystem tests for user-path parsing and symbolic-link rejection.
- **Success check:** Covers accepted absolute/home paths, hostile path strings, malformed surrogate pairs, missing tails, and real directory/file symlinks.
- **Current assessment:** PASS
- **Evidence:** Targeted suite passes 4/4 after canonicalizing macOS temporary roots through `realpath`.
- **Last meaningful change:** T1 path-policy RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T1.

### `test/terminal.test.ts`
- **Purpose:** Real-process and policy tests for the terminal service, static shell adapter, audit boundary, polling, cancellation, timeout, retention, shutdown, validation, and dispatcher.
- **Success check:** Proves no PTY/stdin dependency; exact shell behavior; canonical symlink cwd and explicit environment; command/environment/cwd/output audit secrecy; poll availability during audit degradation; complete grandchild cleanup; completed-only eviction; all-running capacity rejection; and zero delayed residue.
- **Current assessment:** PASS
- **Evidence:** Targeted suite passes 8/8; terminal-plus-limits target passes 9/9; combined T13.1 target passes 19/19; five stress runs pass 40/40; full tracked suite passes 167/167.
- **Last meaningful change:** T13.1 terminal RED/GREEN and stress cycle, 2026-07-08.
- **Owning task or gate:** T13.1.

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

These remain intentionally untracked until their owning task begins.

- **T15:** release documentation/notices and `docs/release-evidence/` index as required.
