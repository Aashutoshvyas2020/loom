# Loom Implementation Handoff

**Date and local time:** 2026-07-08 18:10:28 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA before pending commit:** `ffe22be033c90bcfe57a0811cd70464d0549d19a`
**Repository state:** dirty only with completed T13.1 terminal recovery and same-commit governance
**Current task:** T13.1 — terminal tool implementation recovery
**Last completed gate:** combined T13.1 19-test target, five-run 40-execution terminal stress, full typecheck/167-test/build suite, and delayed Loom-owned residue scan are green
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Why T13.1 existed

T5 registered `loom_terminal`, but the repository reached T13 without a terminal service or dispatcher. T14 could not honestly expose all seven tools or cancel terminal jobs. The canonical plan now records this recovery before runtime orchestration.

## Completed work

- Added one static typed `/bin/sh -lc <command>` adapter directly to `ProcessManager`; no reflection, method guessing, PTY, or stdin.
- Added canonical absolute-or-home cwd handling that accepts safe symlink traversal and requires a directory.
- Added explicit bounded environment overrides, command/timeout validation, and twelve centralized terminal limits. The limit ledger now contains 36 constants.
- Added stable `job_<uuid>` IDs, cursor/gap polling, bounded output, up to 60 seconds of wait, timeout state, lifecycle metadata, and output-only MCP content.
- Added durable audit-before-start/cancel with command, cwd, environment, and output secrecy. Audit failure blocks mutations while existing-job poll remains available.
- Added idempotent cancellation, complete grandchild/process-group cleanup, service shutdown cancellation, and a twenty-iteration rapid natural-exit handshake regression.
- Fixed the fast-target wrapper race by flushing `ready` before `exit`/disconnect and startup errors before disconnect. ProcessManager now rejects pre-ready wrapper exit immediately, preserves exits arriving before managed-object construction, and settles startup timeout once.
- Added bounded retention that never evicts running jobs and waits for process/audit completion before evicting the oldest finished job.
- Added the concrete terminal dispatcher and centralized terminal public-schema bounds.

## Exact commands and results

```text
npm run typecheck
PASS

npm run build && node --test dist/test/terminal.test.js dist/test/limits.test.js
PASS — 9/9

npm run build && node --test dist/test/process-manager.test.js dist/test/terminal.test.js dist/test/limits.test.js
PASS — 19/19
rapid natural exits — 20/20

five consecutive terminal-suite runs
PASS — 40/40 test executions
zero wrapper/target/grandchild residue after every run

npm test
PASS — 167/167

npm run build
PASS

Loom-owned delayed process scan
PASS — no matching child-wrapper, loom-terminal, loom-process, shell target, or grandchild process
```

## Known failures

None in T0–T13.1 deterministic validation.

## Real blockers

- T14 full runtime orchestration, signal ownership, CLI foreground lifetime, and reverse-order cleanup are not implemented yet.
- G5/G6 still require real named Cloudflare credentials, public routing, an eligible ChatGPT custom-MCP workspace, OAuth/tool calls, and external cleanup evidence.

## Files changed

- `CHANGELOG.md`
- `HANDOFF.md`
- `REPO_MAP.md`
- `SPEC.md`
- `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- `src/child-wrapper.ts`
- `src/limits.ts`
- `src/process-manager.ts`
- `src/tools/register.ts`
- `src/tools/terminal.ts`
- `test/limits.test.ts`
- `test/process-manager.test.ts`
- `test/terminal.test.ts`

## Exact next command

```bash
git add CHANGELOG.md HANDOFF.md REPO_MAP.md SPEC.md docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt src/child-wrapper.ts src/limits.ts src/process-manager.ts src/tools/register.ts src/tools/terminal.ts test/limits.test.ts test/process-manager.test.ts test/terminal.test.ts && git diff --cached --check && git commit -m "feat: add terminal tool"
```

## Next expected result

Commit T13.1 with a clean tree, then begin T14 full runtime orchestration from all seven concrete tool handlers: exact startup/shutdown order, runtime lock ownership, signals, foreground CLI lifetime, integrated MCP/dashboard/tunnel/browser/catalog startup, status output, and reverse-order cleanup.
