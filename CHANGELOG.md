# Changelog

## 2.0.5

- Removed hardcoded `2.0.0` runtime metadata. The dashboard, MCP responses, server identity, health endpoint, startup update check, and `loom --version` now all resolve the installed `loommcp-cli` package version from one source.

## 2.0.4

- Added real pseudo-terminal jobs with live stdin through `loom_terminal` actions `start` (`interactive: true`) and `input`.
- Cleaned ANSI, carriage-return, spinner, and backspace noise by default; added `rawOutput` and `finalOnly` polling controls.
- Added downloadable MCP artifact resources for browser screenshots and `loom_read` calls with `asArtifact: true`.
- Returned structured safety failures with the exact blocking rule, reason, and matched command segment.
- Added first-class repository actions for status, diff, branches, and release readiness without shell-parsing Git output manually.

## 2.0.3

- Added a cached npm version check on `loom` startup.
- Added `loom update` and the documented `npm update -g loommcp-cli` path.
- Added opt-in automatic updates with `loom config set autoUpdate true`; Loom exits after updating so the next launch uses the new code.

## 2.0.2

- Replaced the previous generic mark with the final black-and-white Loom logo across the GitHub and npm release surfaces.
- Added the logo asset to the published package and corrected the checkout tarball example to `2.0.2`.

## 2.0.1

- `loom init` and `loom doctor` now flag Bash, `cloudflared`, and `pbcopy` as external dependencies with purpose, status, and install guidance.

## Current file map

- `packages/loom-v2/src/tool-descriptors.ts` — exact seven public Loom tool contracts.
- `packages/loom-v2/src/session-hook.ts` — per-authenticated-session twentieth-call skill refresh.
- `packages/loom-v2/src/bundled-skills.ts` — bounded Ponytail, Using Superpowers, and Caveman reminder.
- `packages/loom-v2/src/files.ts` — bounded text, binary, image, write, and edit operations.
- `packages/loom-v2/src/terminal.ts` — bounded jobs, PTY/stdin interaction, cleaned output, repository checks, process-group shutdown, and explicit-danger guard.
- `packages/loom-v2/src/browser.ts` — dedicated Playwright Chromium profile.
- `packages/engine/src/artifacts.ts` — private bounded artifact storage behind MCP resource links.
- `packages/engine/src/version.ts` — single installed-package version source for CLI, dashboard, MCP, and HTTP metadata.
- `packages/loom-v2/src/skills.ts` — compact skill discovery and activation.
- `packages/loom-v2/src/memory.ts` — Loom-owned memory catalog.
- `src/loom-tools.ts` — MCP registration and dispatch.
- `src/oauth-provider.ts` / `src/oauth-store.ts` — owner OAuth, anti-clickjacking headers, and refresh-family replay revocation.
- `src/server.ts` — authenticated HTTP MCP transport for seven tools.
- `src/tui.tsx` — foreground terminal dashboard with readiness, runtime metrics, recent activity, and copy controls.
- `scripts/build-cli.mjs` — bundles internal Loom code into the standalone CLI.
- `scripts/verify-package.mjs` — proves clean tarball install and `loom launch` outside the checkout.

## 2026-07-11 — Security and deletion pass

- Published package identity is `loommcp-cli`; installed command remains `loom`.
- Fixed cancellation, timeout, poll-listener, retained-job, and `q` shutdown process leaks.
- Added OAuth anti-clickjacking headers, refresh-token family replay revocation, and HTTPS-only public origins with loopback HTTP support.
- Added project-scoped unchanged-read suppression for repeat reads within ten tool calls.
- Removed dead legacy MCP server, workspace/UI/import/sync/control/runtime subsystems, contracts/testkit packages, generated declarations, and unused dependencies.

## 2026-07-10 — Loom V2

- Design lock: ship exactly seven public tools (`loom_terminal`, `loom_read`, `loom_write`, `loom_edit`, `loom_skills`, `loom_memory`, `loom_browser`) with strict flat schemas, narrow OAuth scopes, bounded model-visible results, accurate safety annotations, per-session state, and no hidden arguments.
- Delivery order: contracts → OAuth/runtime containment → terminal TUI → standalone package → automated verification → private GitHub push; only real ChatGPT acceptance testing remains afterward.
- Registered exact output schemas and OpenAI invocation metadata; all seven tools use the same supported owner OAuth scope and accurate impact hints.
- Browser interaction now accepts only snapshot references, blocks direct non-link clicks, and uses short-lived single-use prepare/commit for consequential clicks.
- Built a source-free standalone CLI tarball that clean-installs and launches outside the monorepo.
- Removed stale environment, installation, funding, and repository identity from the release surface.
- Exposed UTF-8/base64 reads in structured tool data and fixed public `192.0.x.x` browser-link false positives.
- Made `q` show `TERMINATING`/`TERMINATED` and await HTTP, browser, terminal-job, and tunnel shutdown with forced cleanup fallback.
- Made `loom launch` use the default named tunnel and show connecting/ready state before ChatGPT setup.
- Replaced the 19 descriptor-only placeholders with the exact seven `loom_*` contracts.
- Added independent per-session tool-call counters and a bounded operating-skill refresh every twentieth call.
- Added bounded UTF-8/base64/image reads, atomic writes/edits, asynchronous terminal jobs, explicit-danger blocking, skills, and memory.
- Locked dedicated Playwright Chromium and a bare Ink terminal dashboard; no web dashboard.
- Wired the seven tools into the authenticated live MCP server and moved the public endpoint to `https://loom.aashutoshvyas.com/mcp`.
- Certified all seven tools through the public OAuth tunnel, including terminal output and a model-visible browser screenshot; removed certification data and tokens afterward.
- Renamed all product, package, configuration, state, documentation, and runtime identity to Loom 2.0.0.
- Documentation stays here as the single minimal changelog and file map.
