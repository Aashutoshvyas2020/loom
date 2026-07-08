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
