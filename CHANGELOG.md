# Changelog

## 2.1.1 — 2026-07-18

- Lets ChatGPT choose up to three validated Loom skill IDs for each subagent; Loom injects the selected skill text into that agent only.
- Adds deliberate low, medium, and high subagent reasoning guidance, persists both selections with the job, and tells ChatGPT when each level is appropriate.

## 2.1.0 — 2026-07-18

- Added the authenticated `loom_agents` tool with child-free OpenAI-compatible coding subagents.
- Added launch-dashboard `e` setup for endpoint, API key, and model, with private `0600` provider storage.
- Added bounded durable agent jobs, cursor output, cancellation/restart interruption, transient retries, and empty-response failure handling.
- Made launch prove local port ownership before starting Cloudflare, supervise transient tunnel exits with bounded backoff, and keep the local server alive during tunnel recovery.
- Added private rotating runtime and Cloudflare logs, explicit stale MCP-session diagnostics, and log paths to `loom doctor`.
- Made signal shutdown await server cleanup, suppress the Ink dashboard outside a real terminal, and label public reachability separately from client-session readiness.
- Restored ChatGPT OAuth callbacks by allowing only the validated redirect origin in `form-action`, and simplified the authorization page styling.
- Removed MCP artifact links so image reads and browser screenshots stay model-visible without triggering ChatGPT file-materialization approval.
- Refreshes the bundled skill reminder every ten MCP calls and gives ChatGPT and subagents default Ponytail, Caveman, Cavekit, coding-guardrail, and durable-memory guidance; ChatGPT alone receives the adapted behavior prompt.
- Added a private global agent-maintained `MEMORY.md` with cross-runtime locking, bounded exact edits, frozen validated subagent snapshots, tenth-call maintenance reminders, safe-path enforcement, migration coverage, and focused memory, MCP, and agent tests.
- Added deterministic token estimates for provider responses that omit usage metadata, ChatGPT-visible MCP traffic, and the combined launch-dashboard total; retained only the six latest tool calls and added `l` to open runtime and Cloudflare logs separately.

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

- `packages/loom-v2/src/tool-descriptors.ts` — eight public Loom tool contracts.
- `packages/loom-v2/src/session-hook.ts` — per-authenticated-session tenth-call skill refresh.
- `packages/loom-v2/src/bundled-skills.ts` — shared coding guardrails, ChatGPT-only behavior, and default Ponytail, Using Superpowers, Caveman, and Cavekit guidance.
- `packages/loom-v2/src/files.ts` — bounded text, binary, image, write, and edit operations.
- `packages/loom-v2/src/terminal.ts` — bounded jobs, PTY/stdin interaction, cleaned output, repository checks, process-group shutdown, and explicit-danger guard.
- `packages/loom-v2/src/browser.ts` — dedicated Playwright Chromium profile.
- `packages/engine/src/version.ts` — single installed-package version source for CLI, dashboard, MCP, and HTTP metadata.
- `packages/loom-v2/src/skills.ts` — compact skill discovery and activation.
- `packages/loom-v2/src/memory.ts` — private global `MEMORY.md`, cross-runtime atomic exact edits, safe-path storage, legacy migration, and 16 KiB validation.
- `packages/engine/src/agent-provider.ts` — safe private provider storage, bounded OpenAI-compatible client, and usage accounting.
- `packages/engine/src/agents.ts` — child-free agent queue, serialized lifecycle/persistence, frozen memory injection, token accounting, and tenth-call guidance.
- `packages/engine/src/loom-tools.ts` — MCP registration and dispatch.
- `packages/engine/src/oauth-provider.ts` / `packages/engine/src/oauth-store.ts` — owner OAuth, anti-clickjacking headers, and refresh-family replay revocation.
- `packages/engine/src/server.ts` — authenticated HTTP MCP transport for eight tools.
- `packages/engine/src/tui.tsx` — foreground terminal dashboard with readiness, agent-token metrics, six-call activity, agent setup, copy controls, and external log opening.
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
