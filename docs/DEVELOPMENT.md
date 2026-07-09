# Loom Development Guide

## Resume procedure

Every agent starts from the repository handoff and governance files, not from assumptions:

```bash
cd /Users/aashu/loom
npm ci
npm run typecheck
npm test
npm run build
git status --short
```

Then read `SPEC.md`, `AGENTS.md`, `REPO_MAP.md`, `CHANGELOG.md`, `HANDOFF.md`, and the canonical plan in `docs/plans/` before changing code.

Do not push or publish unless the user explicitly asks. Keep each task in a separate implementation-plus-governance commit. Never erase concurrent work blindly; inspect the diff, preserve stronger adversarial coverage, and remove only actual contradictions or duplicates.

## Architecture

- `ForegroundLoomRuntime`: exact startup, readiness, status, signal lifetime, absolute shutdown deadline, and ownership-safe cleanup.
- `RuntimeLock` and `RuntimeReadiness`: launch identity, `loom.lock`, canonical `current.json`, endpoint binding, and fail-closed removal.
- `ProcessManager` plus child wrapper/watchdog: detached process-group ownership, bounded output, heartbeat, identity validation, cancellation, timeout, and descendant cleanup.
- `TerminalToolService`: static `/bin/sh -lc` adapter, job IDs, cursor polling, cancellation, retention, and audit integration.
- `LoomMcpHttpServer`: loopback MCP/OAuth HTTP transport and the seven registered tools.
- `LoomDashboardServer`: loopback status and audited operational actions.
- `QuickTunnelManager` and `NamedTunnelManager`: strict Cloudflared validation, readiness, retry classification, endpoint status, and cleanup.
- `ManagedChromiumBackend`: pinned browser launch, profile lifecycle, screenshots, and bounded automation.
- File, skill, and memory services: safe filesystem boundaries, catalog diagnostics, and persistent local memory.
- `AuditLogger`: durable secret-minimized mutation records.

`createDefaultForegroundRuntime` is the concrete composition root. Do not create a second service container or a parallel process supervisor.

## Development method

Use test-driven development for every behavior change:

1. Write the smallest realistic failing test and record the RED failure.
2. Implement the narrow production change.
3. Run the focused target until GREEN.
4. Add adversarial tests for races, ownership, cleanup, bounds, and secret exposure.
5. Run the full repository gate.
6. Update `SPEC.md`, the canonical plan, `CHANGELOG.md`, `REPO_MAP.md`, and `HANDOFF.md` in the same commit.

Mocks are acceptable for deterministic classification and impossible external dependencies, but process cleanup claims require real processes. Public tunnel and ChatGPT claims require real external evidence.

## Validation commands

Focused examples:

```bash
npm run build
node --test dist/test/runtime.test.js dist/test/cli.test.js
node --test dist/test/process-manager.test.js dist/test/watchdog.test.js
node --test dist/test/cloudflare.test.js dist/test/config.test.js dist/test/limits.test.js
node --test dist/test/docs.test.js
```

Required full gate:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Also compare all tracked paths against `REPO_MAP.md` and run a delayed process scan for wrappers, managed targets, and descendants. A passing test process with leaked children is a failure.

## Adding or changing a tool

- Keep public tool names and schemas in the central registration module.
- Use the existing fallback dispatcher chain.
- Validate all untrusted inputs at both schema and service boundaries.
- Centralize fixed byte, time, count, and retry limits in `src/limits.ts`.
- Record audit before any mutation. Do not include secret payloads.
- Use ProcessManager for any launched process tree.
- Prove shutdown and cancellation leave no descendants.
- Update operator and security documentation when the trust boundary changes.

## Governance

`REPO_MAP.md` must document every tracked path with purpose, success check, assessment, evidence, last meaningful change, and owning task/gate. The extracted headings must exactly match `git ls-files | sort`.

`CHANGELOG.md` records actual evidence, including required RED failures and exact commands. `HANDOFF.md` records the current SHA, dirty scope, known failures, real blockers, exact next command, and whether anything was pushed or published.

Never call deterministic tests external certification. Never claim hardware, network, Cloudflare, OAuth, ChatGPT, or cleanup evidence that did not actually run.
