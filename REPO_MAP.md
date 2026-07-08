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

### `src/atomic-file.ts`
- **Purpose:** Durable same-directory atomic replacement with per-canonical-path serialization and optimistic conflict detection.
- **Success check:** Enforces the write-size limit, rejects symlink paths, preserves existing mode, creates new files as 0600, fsyncs file and parent directory, cleans temporary files, and allows only one concurrent writer sharing an expected hash to succeed.
- **Current assessment:** PASS
- **Evidence:** `test/atomic-file.test.ts` passes 5/5; full suite passes 14/14.
- **Last meaningful change:** T1 atomic-file foundation, 2026-07-08.
- **Owning task or gate:** T1; reused by config, OAuth, audit state, memory, and file tools.

### `src/cli.ts`
- **Purpose:** Minimal executable bootstrap for version/help and explicit YOLO opt-in before runtime tasks begin.
- **Success check:** `--version` prints package version, `--help` lists `loom launch --yolo` and macOS 14+, and plain `launch` exits nonzero without enabling access.
- **Current assessment:** PASS
- **Evidence:** Real subprocess tests cover version/help/plain-launch refusal and config check; macOS Expect proves local `/dev/tty` confirmation for config reset.
- **Last meaningful change:** T1 config command routing, 2026-07-08.
- **Owning task or gate:** T0 / G1 and T1; expanded by later CLI/runtime tasks.

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

### `src/paths.ts`
- **Purpose:** Parse absolute or `~/` user paths, reject malformed input, and prevent writes through existing symbolic-link components.
- **Success check:** Rejects empty, relative, alternate-home, NUL, malformed-Unicode, symlink-parent, symlink-final, and non-directory-intermediate paths while allowing a missing tail under real directories.
- **Current assessment:** PASS
- **Evidence:** `test/paths.test.ts` passes 4/4 against real temporary files and symlinks on macOS.
- **Last meaningful change:** T1 path-policy foundation, 2026-07-08.
- **Owning task or gate:** T1; reused by T6, T7, T9, and runtime state.

### `test/atomic-file.test.ts`
- **Purpose:** Real-filesystem proof for atomic replacement, permissions, expected-hash conflicts, same-path serialization, cleanup, size limits, and symlink rejection.
- **Success check:** Exactly one of two concurrent expected-hash writers succeeds and no `.tmp` residue remains after success or rejection.
- **Current assessment:** PASS
- **Evidence:** Targeted suite reports 5 passed, 0 failed.
- **Last meaningful change:** T1 atomic-file RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T1.

### `test/cli.test.ts`
- **Purpose:** Real-process tests for package metadata and the minimum CLI security boundary.
- **Success check:** Runs compiled CLI as a subprocess and proves version, help, macOS floor, exact pins, and refusal of plain launch.
- **Current assessment:** PASS
- **Evidence:** Six CLI tests pass, including a real pseudo-terminal confirmation/reset flow using macOS `/usr/bin/expect`.
- **Last meaningful change:** T1 config command tests, 2026-07-08.
- **Owning task or gate:** T0 / G1 and T1.

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

### `test/paths.test.ts`
- **Purpose:** Real-filesystem tests for user-path parsing and symbolic-link rejection.
- **Success check:** Covers accepted absolute/home paths, hostile path strings, malformed surrogate pairs, missing tails, and real directory/file symlinks.
- **Current assessment:** PASS
- **Evidence:** Targeted suite passes 4/4 after canonicalizing macOS temporary roots through `realpath`.
- **Last meaningful change:** T1 path-policy RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T1.

### `tsconfig.json`
- **Purpose:** Strict NodeNext TypeScript compilation for source and tests.
- **Success check:** `npm run typecheck` and `npm run build` pass with Node types loaded explicitly.
- **Current assessment:** PASS
- **Evidence:** Added `types: ["node"]`; clean-install typecheck and build pass.
- **Last meaningful change:** T0 test-infrastructure correction, 2026-07-08.
- **Owning task or gate:** T0 / G1.

## Planned paths by owning task

These are intentionally untracked until their task begins and therefore must not appear in `git ls-files` at G0.

- **T2:** `src/output.ts`, `src/child-wrapper.ts`, `src/process-manager.ts`, `src/watchdog.ts`, and corresponding tests.
- **T3:** `src/audit.ts`, `test/audit.test.ts`.
- **T4:** `src/oauth.ts`, `test/oauth.test.ts`.
- **T5:** `src/mcp.ts`, `src/tools/register.ts`, `test/mcp.test.ts`.
- **T6:** `src/tools/files.ts`, `test/files.test.ts`.
- **T7:** `src/catalog.ts`, `src/tools/knowledge.ts`, `test/catalog.test.ts`.
- **T8:** `src/dashboard.ts`, `public/dashboard.html`, `public/dashboard.css`, `public/dashboard.js`, `test/dashboard.test.ts`.
- **T9:** `src/browser.ts`, `src/tools/browser.ts`, `test/browser.test.ts`.
- **T10–T13:** `src/cloudflare.ts`, `test/cloudflare.test.ts`.
- **T14:** `src/runtime.ts`, `test/runtime.test.ts`.
- **T15:** release documentation/notices and `docs/release-evidence/` index as required.
