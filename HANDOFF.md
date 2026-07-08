# Loom Implementation Handoff

**Date and local time:** 2026-07-08 00:04:13 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA:** `acb5068d207565ed8e1cba5b9a6123bd84afc430`
**Repository state:** dirty; completed T1 limits/path-policy subtask is not yet committed
**Current task:** T1 — State, config, permissions, paths, atomic files
**Last completed gate:** G1
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Commands run for the current subtask

```bash
npm run build
npm run build && node --test dist/test/limits.test.js dist/test/paths.test.js
npm run build && node --test dist/test/limits.test.js dist/test/paths.test.js
npm run typecheck && npm test && npm run build
```

## Results

- T0 was committed cleanly at `acb5068d207565ed8e1cba5b9a6123bd84afc430`; clean-install G1 validation had passed.
- T1 began test-first with central-limit and path-policy tests.
- Required RED: build failed because `src/limits.ts` and `src/paths.ts` did not exist.
- Added all nineteen approved central constants.
- Added `resolveUserPath` for absolute and `~/` paths only, with empty/NUL/relative/alternate-home/malformed-Unicode rejection.
- Added `assertNoSymlinkComponents`, which walks existing components with `lstat`, rejects directory and final-file symlinks, rejects non-directory intermediate components, and allows a missing tail.
- First GREEN attempt found:
  - a real unmatched-high-surrogate bug, fixed with explicit `NaN` handling;
  - ESM namespace-object comparison behavior, fixed in the test;
  - macOS `/var` → `/private/var` aliasing, handled by canonicalizing test temporary roots rather than weakening production policy.
- Targeted validation: 5 passed, 0 failed.
- Full validation: typecheck passed, full tests passed 9/9, build passed.

## Known failures

None in the completed limits/path-policy subtask.

## Real blockers

None.

## Files changed since HEAD

- `CHANGELOG.md`
- `HANDOFF.md`
- `REPO_MAP.md`
- `src/limits.ts`
- `src/paths.ts`
- `test/limits.test.ts`
- `test/paths.test.ts`

## Exact next command

```bash
git add CHANGELOG.md HANDOFF.md REPO_MAP.md src/limits.ts src/paths.ts test/limits.test.ts test/paths.test.ts && actual=$(mktemp) && mapped=$(mktemp) && git ls-files | sort > "$actual" && grep '^### `' REPO_MAP.md | sed -E 's/^### `([^`]*)`$/\1/' | sort > "$mapped" && comm -3 "$actual" "$mapped" && git diff --cached --check && rm -f "$actual" "$mapped"
```

## Next expected result

The staged index and repository map match exactly with no diff-check errors. Commit this coherent T1 subtask, verify a clean repository, then write the failing atomic-file tests for per-path serialization, expected-SHA conflicts, same-directory replacement, mode preservation, and temporary-file cleanup.
