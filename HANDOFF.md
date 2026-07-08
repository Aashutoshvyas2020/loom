# Loom Implementation Handoff

**Date and local time:** 2026-07-08 00:20:39 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA:** `a9ca32de3d5e17f40f4d5b71feb2208696d908cc`
**Repository state:** dirty; completed T2/G2 process safety changes are not yet committed
**Current task:** T2 — Child wrapper, process manager, watchdog, bounded output
**Last completed gate:** G1; G2 validation passed and is pending commit
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Commands run for the current process-safety subtask

```bash
ps -p $$ -o pid=,ppid=,pgid=,lstart=,comm=,command=
node -e '<inspect ps and lsof fields>'
npm run build
npm run build && node --test dist/test/watchdog.test.js
npm run build && node --test dist/test/process-manager.test.js
npm run build && node --test dist/test/process-manager.test.js dist/test/watchdog.test.js
npm run typecheck && npm test && npm run build
ps -axo pid,ppid,pgid,command | grep -E 'dist/src/child-wrapper|loom-process-|/bin/sleep 30' | grep -v grep
```

## Results

- Bounded output was committed cleanly at `a9ca32de3d5e17f40f4d5b71feb2208696d908cc`.
- Added macOS process observation using `ps` plus `lsof`; PID reuse checks require PID, start time, and canonical executable path.
- Added a detached wrapper that is the dedicated process-group leader and receives launch details only through IPC.
- Target stdin is `/dev/null`; no PTY is created. stdout and stderr remain separate and feed the bounded ordered output model.
- Parent sends heartbeats. The wrapper independently performs process-table fallback checks and does not treat IPC closure as sufficient proof.
- Missing/mismatched parent identity triggers whole-group SIGTERM followed by SIGKILL after the configured grace.
- Process manager validates wrapper ownership before signaling, handles timeout/cancel/natural completion, and cleans background descendants even after the target exits.
- Real tests prove:
  - no PTY or usable stdin;
  - wrapper and target share one dedicated PGID;
  - cancellation removes grandchildren;
  - natural exit removes unreferenced background descendants;
  - SIGTERM-resistant targets receive SIGKILL;
  - SIGKILL of the manager is recovered by the independent wrapper watchdog;
  - timeouts leave no group members;
  - PID-only identity is insufficient.
- Targeted process/watchdog validation: 10 passed, 0 failed.
- Full validation: typecheck passed, full tests passed 39/39, build passed.
- Post-suite process scan produced no output for Loom wrappers, test roots, or test `sleep` descendants.

## Known failures

None in T2 automated validation.

## Real blockers

None.

## Files changed since HEAD

- `CHANGELOG.md`
- `HANDOFF.md`
- `REPO_MAP.md`
- `src/child-wrapper.ts`
- `src/process-manager.ts`
- `src/watchdog.ts`
- `test/process-manager.test.ts`
- `test/watchdog.test.ts`

## Exact next command

```bash
git add CHANGELOG.md HANDOFF.md REPO_MAP.md src/child-wrapper.ts src/process-manager.ts src/watchdog.ts test/process-manager.test.ts test/watchdog.test.ts && actual=$(mktemp) && mapped=$(mktemp) && git ls-files | sort > "$actual" && grep '^### `' REPO_MAP.md | sed -E 's/^### `([^`]*)`$/\1/' | sort > "$mapped" && comm -3 "$actual" "$mapped" && git diff --cached --check && rm -f "$actual" "$mapped"
```

## Next expected result

The staged index and repository map match exactly with no diff-check errors. Commit T2/G2, verify a clean repository, then begin T3 test-first with private JSONL audit records, bounded queue/deadline behavior, mutation fail-closed semantics, rotation, retention, and redaction.
