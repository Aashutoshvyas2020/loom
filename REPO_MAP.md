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
- **Current assessment:** PASS after staged-index validation
- **Evidence:** This file documents every intended G0 tracked path.
- **Last meaningful change:** T0 Gate G0 completion, 2026-07-07.
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
- **Current assessment:** PARTIAL
- **Evidence:** Exact dependency pins and scripts exist; minimum bootstrap source/tests remain for T0 after G0.
- **Last meaningful change:** T0 initialization, 2026-07-07.
- **Owning task or gate:** T0 / G1; later T15 packaging.

### `tsconfig.json`
- **Purpose:** Strict NodeNext TypeScript compilation for source and tests.
- **Success check:** `npm run typecheck` and `npm run build` pass once T0 bootstrap source/tests are added.
- **Current assessment:** PARTIAL
- **Evidence:** Strict options and source/test includes are configured; no source exists at G0.
- **Last meaningful change:** T0 initialization, 2026-07-07.
- **Owning task or gate:** T0 / G1.

## Planned paths by owning task

These are intentionally untracked until their task begins and therefore must not appear in `git ls-files` at G0.

- **T0 after G0:** minimum `src/cli.ts` and `test/cli.test.ts` package bootstrap.
- **T1:** `src/limits.ts`, `src/paths.ts`, `src/atomic-file.ts`, `src/config.ts`, and corresponding tests.
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
