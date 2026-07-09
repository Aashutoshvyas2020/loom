# Loom Repository Map

Assessment key: `PASS` = present and validated for its current gate; `PARTIAL` = present but later work remains; `FAIL` = known broken; `PLANNED` = intentionally absent until its owning task.

This map is exhaustive for the tracked governance baseline. Validate it against `git ls-files | sort` before every gate/commit that changes tracked files.

## Tracked files

### `.github/workflows/ci.yml`
- **Purpose:** Public macOS CI for the declared Node.js support range.
- **Success check:** GitHub Actions runs `npm ci`, typecheck, the complete test suite, and build on Node 22 and Node 26 for pushes and pull requests.
- **Current assessment:** PASS
- **Evidence:** Minimal `macos-14` matrix added after reproducing and fixing the Node 22 lifecycle-timer regression locally.
- **Last meaningful change:** T15.4 supported-runtime compatibility, 2026-07-08.
- **Owning task or gate:** T15.4 / G4.

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
- **Success check:** Updated in every repository-changing commit with actual command, test, package, and certification-boundary evidence.
- **Current assessment:** PASS
- **Evidence:** Records the T15.5 public-Host 403 root cause, DevSpace/MCP SDK comparison, public-client DCR compatibility, standard Cloudflare credential support, RED/GREEN results, and remaining real ChatGPT gate.
- **Last meaningful change:** T15.5 OAuth interoperability, 2026-07-09.
- **Owning task or gate:** All tasks; current T15.5.

### `EXTERNAL_AUDIT.md`
- **Purpose:** One self-contained external expert audit dossier covering the complete product, architecture, security model, control flows, implementation chronology, evidence boundaries, every tracked path, generated source/test inventories, and verbatim governing documents.
- **Success check:** Executable documentation tests require the mandatory audit sections, exact seven tools, human-review/no-proof boundary, and representation of every path documented by this repository map; generated inventories and embedded source snapshots must match the current tracked state.
- **Current assessment:** PASS
- **Evidence:** Regenerated for T15.5 so the embedded plan, specification, changelog, handoff, repository map, source/test inventory, and canonical-source hashes reflect the OAuth and Cloudflare interoperability fix.
- **Last meaningful change:** T15.5 OAuth interoperability, 2026-07-09.
- **Owning task or gate:** T15.2 through T15.5.

### `HANDOFF.md`
- **Purpose:** Exact resumable state, commands, failures, blockers, SHA, and next action.
- **Success check:** Contains every field required by plan Section 25 and an executable next command.
- **Current assessment:** PASS
- **Evidence:** Records the T15.5 root cause, exact copied DevSpace behaviors, local verification, dedicated Loom hostname plan, remaining real connector step, and exact next command.
- **Last meaningful change:** T15.5 OAuth interoperability, 2026-07-09.
- **Owning task or gate:** All tasks; current T15.5.
### `LICENSE`
- **Purpose:** MIT license for Loom source distribution.
- **Success check:** Valid MIT license text with copyright attribution.
- **Current assessment:** PASS
- **Evidence:** Present at repository root.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0 / T15.

### `README.md`
- **Purpose:** Public package overview, safety warning, supported commands, setup, tunnel/browser behavior, and documentation links.
- **Success check:** Matches the implemented CLI and trust boundary without claiming real ChatGPT or production certification.
- **Current assessment:** PASS
- **Evidence:** Public overview now warns that untrusted tool content can prompt-inject the authorized agent, MCP results leave the Mac, browser/memory state persists, localhost/private-network access is allowed, and containment is local-only.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `REPO_MAP.md`
- **Purpose:** Exhaustive tracked-file ledger with ownership, checks, assessment, and evidence.
- **Success check:** Extracted path headings exactly match `git ls-files | sort` after staging, with no undocumented tracked files.
- **Current assessment:** PASS
- **Evidence:** Remains exhaustive for all 75 tracked files and records every T15.5 source, test, plan, and governance change.
- **Last meaningful change:** T15.5 OAuth interoperability, 2026-07-09.
- **Owning task or gate:** All tasks; current T15.5.
### `SPEC.md`
- **Purpose:** Approved behavioral, security, dependency, command, packaging, and release contract.
- **Success check:** Matches the canonical plan and prevents deterministic tooling or self-reported manifests from substituting for real external certification.
- **Current assessment:** PASS
- **Evidence:** Locks exact public-host validation, DevSpace-compatible confidential/public OAuth client methods, standard Cloudflare credentials, and unchanged endpoint/PKCE/owner-password security boundaries.
- **Last meaningful change:** T15.5 OAuth interoperability, 2026-07-09.
- **Owning task or gate:** T0 / G0 and every behavior-changing task; current T15.5.
### `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- **Purpose:** Full self-contained ordered implementation plan and certification contract.
- **Success check:** Covers Sections 0–26, T0–T16, G0–G7, explicit recovery subtasks, governance gates, and external-evidence boundaries.
- **Current assessment:** PASS
- **Evidence:** Adds T15.5 for real ChatGPT discovery reproduction, exact public-host validation, DevSpace-compatible public DCR, standard Cloudflare credentials, and real named-tunnel retesting while leaving G6/G7 blocked until external proof.
- **Last meaningful change:** T15.5 OAuth interoperability, 2026-07-09.
- **Owning task or gate:** T0 / G0; source of truth for all later tasks.
### `NOTICE`
- **Purpose:** Distribution notice for Loom and third-party software/trademarks.
- **Success check:** Ships in the public tarball and names the license plus major third-party components without claiming affiliation.
- **Current assessment:** PASS
- **Evidence:** Present in the 90-file package and clean-prefix installation.
- **Last meaningful change:** T15 release notice, 2026-07-08.
- **Owning task or gate:** T15 packaging and documentation.
### `docs/DEVELOPMENT.md`
- **Purpose:** Developer workflow, architecture, validation, security boundaries, and unsupported-claim guidance.
- **Success check:** Matches the implemented task/gate workflow and does not replace external evidence with local tests.
- **Current assessment:** PASS
- **Evidence:** Documents deliberate session escape, APFS/F_FULLFSYNC and local-filesystem durability limits, persistent browser state, code-grounded review discipline, and pre-schema request-boundary testing.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `docs/OPERATOR.md`
- **Purpose:** Supported installation, configuration, launch, dashboard, shutdown, recovery, and diagnostic guide for the single macOS owner.
- **Success check:** Lists only real commands and accurately states the full-access, TTY, owner-password, tunnel, browser, and cleanup boundaries.
- **Current assessment:** PASS
- **Evidence:** Adds TCC, minimal-environment/login-shell guidance, prompt-injection/provider disclosure, persistent profile and artifact handling, terminal-scrollback caution, local-only containment, and complete incident review beyond auth reset.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `docs/RELEASE_CERTIFICATION.md`
- **Purpose:** Public distinction between deterministic readiness, production eligibility, and real externally reviewed certification.
- **Success check:** Documents G5/G6/T16 evidence, forbidden claims, and that `loom-certify` cannot prove external events or independently certify.
- **Current assessment:** PASS
- **Evidence:** Requires exact tarball hash and independent artifact verification, states the absence of an out-of-band trust root, and forbids claims about prompt injection, deliberate process escape, forensic audit, or automatic persistent-state cleanup.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15, T15.1, T15.3, G5–G7, and T16.
### `docs/SECURITY.md`
- **Purpose:** Public security model for unrestricted tools, OAuth, process ownership, files, browser, tunnels, dashboard, state, audit, and incident response.
- **Success check:** Matches the approved trust boundary and explicitly identifies non-goals and same-user limitations.
- **Current assessment:** PASS
- **Evidence:** Expanded threat model covers authorized-agent prompt injection, provider disclosure, persistent browser/memory, sole-factor/throttling limits, deliberate session escape, TCC, LAN pivoting, inherited login-shell secrets, local-only containment, and non-forensic audit.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `docs/certification-evidence.example.json`
- **Purpose:** Sanitized strict example manifest for optional G5–G7 artifact-integrity validation.
- **Success check:** Uses current pinned arm64 Cloudflared/Chromium metadata, contains no secrets, omits optional Quick evidence, and cannot cause automatic certification.
- **Current assessment:** PASS
- **Evidence:** Parsed by certification tests; package includes the current example.
- **Last meaningful change:** T15.1 current pinned example and trust correction, 2026-07-08.
- **Owning task or gate:** T15.1 and T16.
### `docs/release-evidence/README.md`
- **Purpose:** Private-repository index and sanitization rules for deterministic and real external release evidence.
- **Success check:** Lists current T15 local evidence, required future G5/G6/clean-Mac artifacts, forbidden secrets, and human-review requirement.
- **Current assessment:** PASS
- **Evidence:** Indexes the T15.3 adversarial verification record while preserving all G5/G6/clean-Mac gates as not yet certified.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15–T16 and G5–G7.
### `docs/release-evidence/t15-local-package.md`
- **Purpose:** Sanitized deterministic record of the T15 candidate tarball and clean-prefix installation.
- **Success check:** Records environment, exact commands/results, package hash/size, installed binaries/assets, fail-closed launches, cleanup, and explicit external limitations.
- **Current assessment:** PASS
- **Evidence:** Records SHA-256 `3711d511bf530ec3d834b4a021d960cbb001af43c126c850069640bfd7f7a549`, 90 files, 204/204 tests, and no state creation.
- **Last meaningful change:** T15 local package evidence, 2026-07-08.
- **Owning task or gate:** T15 packaging and documentation.

### `docs/release-evidence/t15.3-adversarial-review.md`
- **Purpose:** Sanitized code-grounded classification of the five supplied adversarial audits, including verified fixes, verified residual risks, false positives, intentional scope tradeoffs, and controlled local experiments.
- **Success check:** Contains no secrets or simulated external evidence; every fixed claim names a regression, every residual risk is disclosed in public docs, and G5–G7 remain explicitly blocked.
- **Current assessment:** PASS
- **Evidence:** Records MCP/body/auth/scrypt/refresh/watchdog/path/read/cancel/tombstone/clock fixes, 64 MiB output and deliberate-session-escape experiments, false-positive evidence, and package/full-suite requirements.
- **Last meaningful change:** T15.3 adversarial verification evidence, 2026-07-08.
- **Owning task or gate:** T15.3 and T16.

### `package-lock.json`
- **Purpose:** Reproducible exact npm dependency graph.
- **Success check:** `npm ci` succeeds and direct dependencies match package.json exact pins.
- **Current assessment:** PASS
- **Evidence:** Generated by npm 11.12.1; install reported 106 packages and zero vulnerabilities.
- **Last meaningful change:** T0 dependency installation, 2026-07-07.
- **Owning task or gate:** T0 / G1.

### `package.json`
- **Purpose:** Package identity, Node floor, executable mappings, exact dependencies, scripts, and explicit public release allowlist.
- **Success check:** No dependency ranges; Node `>=22`; `loom` and `loom-certify` bins; public runtime/assets/docs/license/notice included; tests, plans, and release evidence excluded.
- **Current assessment:** PASS
- **Evidence:** Full suite passes 204/204; `npm pack --dry-run --json` reports 90 approved files; clean-prefix install executes both npm bin symlinks and fail-closed launch checks.
- **Last meaningful change:** T15/T15.1 public package allowlist and certification CLI, 2026-07-08.
- **Owning task or gate:** T0 / G1 and T15/T15.1.
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
- **Evidence:** Browser tests pass 19/19 on Node 22 after keeping awaited evaluation and graceful-shutdown deadline timers referenced until settlement; browser behavior and scope are otherwise unchanged.
- **Last meaningful change:** T15.4 supported-runtime compatibility, 2026-07-08.
- **Owning task or gate:** T9 / G4, T14, and T15.4.

### `src/browser/setup.ts`
- **Purpose:** Explicit architecture-pinned Chromium acquisition, exact executable verification, wrapper-owned launch proof, private manifest, atomic promotion, and pinned metadata export.
- **Success check:** Retains install/rollback/security behavior and exposes only the architecture-specific pinned executable SHA required by certification validation.
- **Current assessment:** PASS
- **Evidence:** Browser tests remain green; T15.1 external evidence rejects non-pinned Chromium revision/hash; full suite passes 204/204.
- **Last meaningful change:** T15.1 pinned certification metadata export, 2026-07-08.
- **Owning task or gate:** T9 / G4, T15.1, and T16 certification.
### `src/certification-cli.ts`
- **Purpose:** Packaged command boundary for deterministic evidence collection, optional manifest/artifact validation, private report output, and blocked/fail exit semantics.
- **Success check:** Executes through npm bin symlinks, never auto-certifies external gates, reports deterministic failure as 1 and unresolved external gates as 2.
- **Current assessment:** PASS
- **Evidence:** Five CLI tests pass, including real package-bin symlink execution and supplied evidence remaining blocked.
- **Last meaningful change:** T15.1 fail-closed certification CLI and symlink repair, 2026-07-08.
- **Owning task or gate:** T15.1 and T16.
### `src/certification.ts`
- **Purpose:** Strict deterministic certification collector, external manifest schema, artifact verifier, package validator, residue scanner, report evaluator, and private writer.
- **Success check:** Binds evidence to exact SHA/current pins, rejects unsafe package/report/artifact paths, detects Loom residue, and keeps G5–G7 blocked pending human review.
- **Current assessment:** PASS
- **Evidence:** Fourteen certification tests plus five CLI/docs tests pass; full suite 204/204 and 90-file package gate pass.
- **Last meaningful change:** T15.1 certification recovery and adversarial hardening, 2026-07-08.
- **Owning task or gate:** T15.1, G5–G7, and T16.

### `src/child-wrapper.ts`
- **Purpose:** Detached process-group leader that receives launch data only over IPC, starts targets with ignored stdin, forwards separate output streams, flushes lifecycle IPC in order, and independently watches parent identity.
- **Success check:** Wrapper and target share one dedicated PGID; `ready` is delivered before a fast target `exit`/disconnect; startup errors flush before disconnect; duplicate finish paths are suppressed; missed heartbeat or parent-identity mismatch triggers whole-group TERM then KILL cleanup.
- **Current assessment:** PASS
- **Evidence:** Uses monotonic heartbeat age and serializes bounded parent-identity probes; confirmed mismatch cleans immediately while transient unobservability with healthy heartbeats no longer causes false orphan cleanup. Rapid exit, parent-death, EPERM, and full suites pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2, T13.1, and T15.3.

### `src/cli.ts`
- **Purpose:** Executable command boundary for version/help, explicit foreground YOLO launch, browser setup, configuration management, and owner-credential rotation.
- **Success check:** Plain launch refuses access; exact `launch --yolo` requires macOS 14+/Node 22+ and direct `/dev/tty`, prints the warning/new owner password only locally, invokes the production foreground runtime, and cleans a factory-created lock on launch failure; existing setup/reset safety remains intact.
- **Current assessment:** PASS
- **Evidence:** Thirteen CLI tests pass, including injected exact YOLO routing and a genuinely terminal-less YOLO attempt that creates no `~/.loom`, plus package-bin/PTTY/setup/reset/live-lock coverage.
- **Last meaningful change:** T14 real foreground YOLO launch and support/TTY boundary, 2026-07-08.
- **Owning task or gate:** T0 / G1, T1, T4, T9, and T14.

### `src/cloudflare.ts`
- **Purpose:** Pinned Cloudflared acquisition/verification plus Quick and Named Tunnel validation, direct launch, bounded readiness, retry, audit, status, and cleanup.
- **Success check:** Retains T10/T12 guarantees; named mode validates the private origin certificate and standard Cloudflare credentials, matches account and `<TunnelID>.json` filename, launches explicit ephemeral origin argv, exposes production status only after registration, revalidates every attempt, retries only transient failures, never falls back to Quick, and fails closed on uncertainty.
- **Current assessment:** PASS
- **Evidence:** Real Cloudflare's credential shape no longer fails the parser; the full Cloudflare target passes 30/30 and the integrated OAuth/MCP/Cloudflare target passes 52/52.
- **Last meaningful change:** T15.5 standard named-tunnel credentials, 2026-07-09.
- **Owning task or gate:** T10, T12, T13, T14, T15.4, and T15.5.

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
- **Evidence:** Adds the 9 MiB MCP request limit, ten-attempt/60-second authorization window, and two-second watchdog command timeout; exact 40-constant ledger test passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1, T13.1, and T15.3.

### `src/process-manager.ts`
- **Purpose:** Launches wrapper-owned detached process groups, streams bounded output, sends heartbeats, validates ownership, manages startup/exit races, timeout/cancellation, and TERM-to-KILL shutdown deadlines.
- **Success check:** Real processes have no PTY/stdin; wrapper exit before readiness rejects immediately; exit events between readiness and managed construction are preserved; natural exit/cancellation clean descendants; transient `EPERM` is revalidated; persistent `EPERM` fails closed; forced manager death is recovered; and no test descendants remain.
- **Current assessment:** PASS
- **Evidence:** Owned-group TERM/KILL and EPERM retry deadlines now use monotonic time; process-manager and ten-run transient-EPERM stress pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2, T12.1, T13.1, T14, and T15.3.

### `src/runtime.ts`
- **Purpose:** T11 readiness plus T14 exclusive foreground lifecycle, production component assembly, lock/state ownership, status, signals, dashboard actions, and reverse cleanup.
- **Success check:** Builds all seven handlers; acquires an identity-bound exclusive lock before audit; starts MCP NOT_READY/dashboard/catalogs/browser/tunnel in order; publishes exact `/mcp` once; supports verified browser or missing/corrupt-manifest degraded mode and pinned Quick/Named tunnel without fallback; opens the authenticated local dashboard by default; handles explicit/dashboard/signal stops; enforces a real 15-second per-step deadline; terminates public listeners/process groups; and removes exact readiness state plus lock only after content/identity ownership and cleanup certainty.
- **Current assessment:** PASS
- **Evidence:** Runtime shutdown uses monotonic deadline arithmetic and lock creation explicitly uses O_CREAT|O_EXCL|O_NOFOLLOW; integrated lifecycle and lock tests pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T11, T14, and T15.3.

### `src/mcp.ts`
- **Purpose:** Loopback-only Streamable HTTP MCP and OAuth HTTP server with deterministic readiness, endpoint-bound bearer authentication, server-bound authorization transactions, token routes, and bounded client-bound sessions.
- **Success check:** Authorization GET stores the request server-side; POST accepts only transaction ID and owner password; replay/substitution fail; exact loopback/bound-public Host validation remains fail-closed; metadata/DCR support both confidential and public clients; sessions and readiness remain bounded.
- **Current assessment:** PASS
- **Evidence:** Raw HTTP proves the bound public hostname returns metadata while an unrelated hostname remains 403; public-client DCR/code/refresh/revoke and confidential-client flows both pass.
- **Last meaningful change:** T15.5 ChatGPT OAuth interoperability, 2026-07-09.
- **Owning task or gate:** T5, T15.3, and T15.5.

### `src/oauth.ts`
- **Purpose:** Persistent single-owner credentials and endpoint-bound OAuth clients, authorization transactions/codes, access/refresh tokens, revocation, metadata, and endpoint-generation state.
- **Success check:** Exact endpoint/generation bindings remain atomic; confidential clients require their secret; public clients use PKCE without a secret; revoke-all and owner reset preserve their existing lifecycle contracts.
- **Current assessment:** PASS
- **Evidence:** Metadata advertises `client_secret_post` and `none`; state defaults legacy clients to confidential mode; integrated OAuth/MCP/Cloudflare tests pass 52/52.
- **Last meaningful change:** T15.5 public-client OAuth support, 2026-07-09.
- **Owning task or gate:** T4, T5, T14, T15.3, and T15.5.

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
- **Evidence:** Canonicalizes only macOS /tmp and /var compatibility aliases to /private paths while retaining strict rejection of all other mutation symlinks; path and full suites pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1 and T15.3.

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
- **Evidence:** Proves audit degradation blocks capability-increasing browser work but not tab close/read-only actions; full browser target remains green.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T9 and T15.3.

### `test/certification-cli.test.ts`
- **Purpose:** CLI-level blocked/fail semantics, strict evidence flow, help side-effect, and npm package-bin symlink regressions.
- **Success check:** Proves supplied self-reported evidence remains blocked and the installed-style symlink invokes the CLI.
- **Current assessment:** PASS
- **Evidence:** Five tests pass as part of the 19-test certification/documentation target.
- **Last meaningful change:** T15.1 certification CLI RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T15.1 and T16.
### `test/certification.test.ts`
- **Purpose:** Unit/integration tests for deterministic collection, external schema/pins, artifact/report path safety, package contents, residue detection, and fail-closed evaluation.
- **Success check:** Proves no self-certification, optional Quick evidence, exact managed pins, symlink rejection before mutation, complete public package requirements, and managed process detection.
- **Current assessment:** PASS
- **Evidence:** Fourteen tests pass; required RED cases reproduced each repaired defect; full suite passes 204/204.
- **Last meaningful change:** T15.1 certification recovery and adversarial RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T15.1, G5–G7, and T16.

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
- **Evidence:** Uses Cloudflare's real standard credential shape, verifies `<TunnelID>.json` binding, and retains all acquisition, Quick, Named, retry, OAuth, and cleanup coverage; target passes 30/30.
- **Last meaningful change:** T15.5 standard credential regression, 2026-07-09.
- **Owning task or gate:** T10, T12, T13, T15.3, and T15.5.

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
- **Evidence:** Locks all 40 current limits including request, authorization, and watchdog bounds.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1, T13.1, and T15.3.

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
- **Evidence:** Production nonce/session lifetimes now default to monotonic time; wall-clock-jump regression and all dashboard security tests pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T8 and T15.3.

### `src/tools/browser.ts`
- **Purpose:** Public `loom_browser` validation, audit policy, bounded result shaping, image return, typed error preservation, and dispatcher composition.
- **Success check:** Accepts only approved actions/schemes/origins/permissions/bounds, audits every browser mutation before backend work without secret content, keeps reads available after audit degradation, and never statically loads Playwright.
- **Current assessment:** PASS
- **Evidence:** Capability-increasing browser mutations remain audit-fail-closed while tab close is best-effort audited and remains available for containment during audit degradation.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T9 and T15.3.

### `src/tools/files.ts`
- **Purpose:** Concrete bounded text/image/binary read, audited atomic write, exact audited edit, and dispatcher composition for the three public file tools.
- **Success check:** Reads safely follow only a stable final symlink to a regular-file target, reject symlinked parents, detect image MIME by magic bytes, bound output, and hash the complete stable snapshot; writes/edits retain strict symlink rejection, audit-before-mutation, conflict detection, and atomic replacement.
- **Current assessment:** PASS
- **Evidence:** Stable read targets are opened O_NONBLOCK|O_NOFOLLOW before regular-file verification, preventing FIFO/device replacement from hanging the server; file suite passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T6 and T15.3.

### `src/tools/memory.ts`
- **Purpose:** Loom-owned stable-ID memory store with deterministic search, audited save/delete, crash-recovered tombstones, bounded rescans, and dispatcher composition.
- **Success check:** Save/delete are serialized and audited; stale valid tombstones are durably removed under audit; unsafe tombstones remain with diagnostics; malformed/oversized entries do not corrupt published snapshots; aggregate limits fail atomically.
- **Current assessment:** PASS
- **Evidence:** Tombstone cleanup repeats symlink/type and full identity verification immediately before removal and retains a diagnostic on replacement; memory suite passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T7 and T15.3.

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
- **Evidence:** Terminal start remains audit-fail-closed while cancel is best-effort audited and remains available for containment; terminal/process suites pass with zero residue.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T13.1, T14, and T15.3.

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
- **Evidence:** All ps/lsof probes use fixed PATH/LANG/LC_ALL, bounded buffers, and a two-second SIGKILL timeout through one helper; live watchdog and timeout tests pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2, T12.1, and T15.3.

### `test/dashboard.test.ts`
- **Purpose:** Real HTTP tests for one-time bootstrap, cookies, strict headers, session/CSRF/Origin/Host boundaries, recursive redaction, and action allowlisting.
- **Success check:** Replayed nonces, missing sessions, wrong Origin/CSRF/Host, leaked secrets, and unknown actions are all rejected deterministically.
- **Current assessment:** PASS
- **Evidence:** Adds a wall-clock-jump regression proving production dashboard bootstrap lifetime is monotonic; dashboard target passes 3/3.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T8 and T15.3.

### `test/docs.test.ts`
- **Purpose:** Executable contract for real CLI commands, security/operating documentation, certification limitations, package metadata, and the repository-only external audit dossier.
- **Success check:** Rejects stale commands/placeholders, requires the human-review/no-proof boundary, verifies the exact public package allowlist/bins, and requires the dossier’s mandatory sections, exact seven tools, gate boundary, and representation of every mapped tracked path.
- **Current assessment:** PASS
- **Evidence:** Adds executable requirements for prompt injection, persistent browser state, TCC, LAN/provider disclosure, local-only containment, non-forensic audit, process escape, minimal environment, F_FULLFSYNC limits, and artifact trust.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15, T15.1, T15.2, and T15.3.

### `test/files.test.ts`
- **Purpose:** Real-filesystem proof for stable/ranged reads, image magic bytes, explicit binary base64, stable final-symlink reads, parent/mutation symlink rejection, audited writes/edits, conflicts, concurrency, and dispatcher composition.
- **Success check:** Final-link reads return target content without weakening writes or edits; parent symlinks fail; content never enters audit records; one concurrent expected-hash writer wins; no temporary residue remains.
- **Current assessment:** PASS
- **Evidence:** Adds a real FIFO final-symlink regression with delayed writer and proves prompt regular-file rejection without blocking; file target passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T6 and T15.3.

### `test/memory.test.ts`
- **Purpose:** Real-filesystem tests for persistent stable IDs, ranking, audit fail-closed behavior, delete conflicts, concurrency, limits, symlink safety, tombstone recovery, diagnostics, and dispatcher composition.
- **Success check:** Valid stale tombstones are removed, unsafe tombstones remain diagnosed, aggregate limits are tested with individually valid files, and failed rescans preserve the prior immutable snapshot.
- **Current assessment:** PASS
- **Evidence:** Adds an adversarial tombstone replacement during audit admission and proves the replacement is preserved with a cleanup diagnostic.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T7 and T15.3.

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
- **Success check:** The authorization page remains server-bound and hardened; raw public Host discovery succeeds only for the bound hostname; confidential and public DCR flows both complete; all transport/session behaviors remain green.
- **Current assessment:** PASS
- **Evidence:** RED captured public-host 403, missing `none`, and DCR 400; GREEN covers exact public/hostile Host behavior and secretless registration, token, refresh, and revocation.
- **Last meaningful change:** T15.5 real ChatGPT OAuth regression, 2026-07-09.
- **Owning task or gate:** T5, T15.3, and T15.5.

### `test/oauth.test.ts`
- **Purpose:** State-level security tests for owner credentials, endpoint-bound OAuth, rotation/replay/expiry, reset, metadata, and owner-preserving revoke-all behavior.
- **Success check:** Existing tokens fail after revoke-all, endpoint/password remain unchanged, confidential-client secret checks remain strict, metadata advertises both supported methods, and all binding/secret-at-rest checks remain.
- **Current assessment:** PASS
- **Evidence:** Exact metadata now includes `client_secret_post` and `none` while all prior owner, endpoint, replay, expiry, refresh-family, reset, and revocation tests remain green.
- **Last meaningful change:** T15.5 OAuth metadata compatibility, 2026-07-09.
- **Owning task or gate:** T4, T15.3, and T15.5.

### `test/output.test.ts`
- **Purpose:** Boundary tests for terminal stream ordering, sanitization, deterministic binary markers, exact truncation, cursor pagination, UTF-8 boundaries, and lifecycle states.
- **Success check:** Stale cursors report gaps and pagination preserves source order without duplication or loss.
- **Current assessment:** PASS
- **Evidence:** Adds OSC 52 clipboard-control input and proves only safe text remains while retaining binary/truncation/cursor/lifecycle coverage.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2 and T15.3.

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
- **Evidence:** Proves exact macOS /tmp and /var compatibility canonicalization without matching similarly prefixed paths, plus existing hostile path/symlink policy.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1 and T15.3.

### `test/terminal.test.ts`
- **Purpose:** Real-process and policy tests for the terminal service, static shell adapter, audit boundary, polling, cancellation, timeout, retention, shutdown, validation, and dispatcher.
- **Success check:** Proves no PTY/stdin dependency; exact shell behavior; canonical symlink cwd and explicit environment; command/environment/cwd/output audit secrecy; poll availability during audit degradation; complete grandchild cleanup; completed-only eviction; all-running capacity rejection; and zero delayed residue.
- **Current assessment:** PASS
- **Evidence:** Proves start stays blocked while poll and cancel remain usable after audit storage failure, with all timeout/descendant/retention/shutdown coverage green.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T13.1 and T15.3.

### `test/watchdog.test.ts`
- **Purpose:** Live macOS tests for canonical executable identity, PID-reuse defenses, process-group scans, and absent PID handling.
- **Success check:** Identity changes in PID, start time, or executable all fail matching.
- **Current assessment:** PASS
- **Evidence:** Proves fixed C locale and hard timeout for watchdog subprocesses plus existing live identity/group behavior.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2 and T15.3.

### `tsconfig.json`
- **Purpose:** Strict NodeNext TypeScript compilation for source and tests.
- **Success check:** `npm run typecheck` and `npm run build` pass with Node types loaded explicitly.
- **Current assessment:** PASS
- **Evidence:** Added `types: ["node"]`; clean-install typecheck and build pass.
- **Last meaningful change:** T0 test-infrastructure correction, 2026-07-08.
- **Owning task or gate:** T0 / G1.
