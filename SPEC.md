# Loom v1 Specification

Status: approved implementation baseline
Source of truth: `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
Target platform: macOS 14+, Node.js 22+
Primary unrestricted command: `loom launch --yolo`

## Product

Loom is a foreground-only, single-owner remote MCP server. Unrestricted tools are enabled only when the owner explicitly runs `loom launch --yolo` in a visible local terminal. While that process is running, an authenticated ChatGPT MCP client may execute unrestricted noninteractive commands as the current macOS user, read supported text and local images, write and exactly edit text files, search skills and memory, manage Loom-owned memory, and control a dedicated persistent Playwright browser. Plain `loom launch` must not start listeners or enable unrestricted access. Closing the terminal or terminating Loom must stop remote access and clean up Loom-owned processes.

Loom exposes exactly seven tools: `loom_terminal`, `loom_read`, `loom_write`, `loom_edit`, `loom_skills`, `loom_memory`, and `loom_browser`.

## Locked decisions

- No launchd, login item, hidden daemon, persistent background supervisor, cloud control plane, workspaces, approvals, command classification, path allowlist, PTY, browser extension, custom MCP UI, database, vector search, plugin runtime, or automatic startup.
- `loom launch --yolo` is the only unrestricted launch path. YOLO mode cannot be enabled through config, environment variables, or an alternate command spelling.
- Terminal access is unrestricted but noninteractive: no PTY and no usable stdin.
- Owner password is a persistent installation credential. It changes only through `loom auth reset`; tunnel URL changes, restarts, token rotation, browser resets, and upgrades never rotate it.
- Quick Tunnel is setup/testing only and is never production certified. Named Cloudflare Tunnel with stable HTTPS hostname is required for production certification.
- File paths and terminal `cwd` accept only absolute paths or `~/...`; bare relative paths are rejected. Reads may follow a final symbolic link only after resolving and verifying a stable regular-file target. Terminal `cwd` canonicalizes through `realpath` and may traverse safe symbolic links.
- Writes and edits reject any existing symbolic-link component and use per-path serialization, conflict detection, required audit start records, and same-directory atomic replacement.
- `loom_read` recognizes PNG, JPEG, GIF, and WebP by magic bytes and returns MCP image content within the fixed limit.
- Loom installs the pinned Playwright Chromium build only through explicit `loom setup browser` into `~/.loom/browser/`. Setup resolves the bundled Playwright CLI independently of the caller’s working directory, forces the official Playwright CDN, verifies the exact architecture-specific executable hash, proves a real wrapper-owned loopback CDP launch, and atomically rolls back a failed replacement.
- Loom uses a dedicated persistent browser profile at `~/.loom/browser-profile/` and never attaches to the normal Chrome profile. Browser shutdown sends CDP `Browser.close` and waits for natural managed-process exit so profile data is flushed, with bounded process-group cancellation only as fallback.
- State lives under `~/.loom/`, created with restrictive permissions and atomic writes.
- Audit is private best-effort local activity logging, not tamper-proof against the same macOS user. Audit failure closes mutating operations while reads remain available.
- All terminal, Cloudflared, and Chromium process trees launch through the child wrapper and watchdog protocol with heartbeat, process-table fallback, PID/start-time/executable identity checks, five-second graceful termination, and a fifteen-second absolute shutdown deadline. Loom-owned binaries use direct verified executable paths and explicit argument arrays; only the intentionally unrestricted terminal tool invokes `/bin/sh -lc` through a static typed adapter.
- MCP and dashboard bind to loopback ephemeral ports. `/mcp` remains fail-closed until the public HTTPS URL is resolved and endpoint-bound OAuth metadata is ready.
- OAuth supports rotating refresh tokens bound to the exact canonical public `/mcp` resource URI. The authorization page uses a short-lived, single-use server-side transaction so the password POST cannot substitute client, redirect, resource, scope, state, endpoint generation, or PKCE parameters.
- Cloudflared is pinned to version `2026.7.0` for macOS arm64 and x64. Acquisition uses official credential-free HTTPS release URLs, manual bounded redirects, exact archive byte counts and SHA-256 values, a bounded 30-minute transfer deadline, private staged extraction, exact executable SHA-256/version verification, and atomic promotion with failure cleanup.
- Cloudflared runs with `--no-autoupdate`; metrics bind only to `127.0.0.1:0`; named tunnels use an explicit ephemeral origin mapping and never fall back to Quick Tunnel. Normal PATH symlinks are canonicalized and the resolved binary is verified by ownership, executable mode, version, hash, and stable identity. Every launch re-verifies the executable and uses direct ProcessManager argv rather than shell construction.
- Skill files with an unterminated frontmatter block are skipped with a malformed diagnostic. Interrupted Loom-owned memory-delete tombstones are safely cleaned during initialization or rescan.
- Browser public-tool policy is separated from the Playwright backend. All internal page evaluations, including snapshots, are deadline-bounded with per-tab recovery before whole-browser restart. Downloads and collision-safe, human-sortable screenshots persist under `~/.loom/downloads/` using private no-overwrite creation.

## Technology

Pinned production dependencies:

- `@modelcontextprotocol/sdk` 1.29.0
- `express` 5.2.1
- `zod` 4.4.3
- `playwright-core` 1.61.1

Development dependencies are pinned in `package.json` and `package-lock.json`.

## Required CLI

- `loom launch`
- `loom launch --yolo`
- `loom setup browser`
- `loom auth reset`
- `loom config check`
- `loom config reset`
- `loom --version`
- `loom --help`

## Release contract

Release-ready status requires every automated gate, clean packed install, real named-tunnel test, real ChatGPT OAuth and tool calls, verified process cleanup, verified stable endpoint and owner-password persistence, committed evidence, and a clean repository. Quick Tunnel testing alone cannot satisfy production certification. No push or npm publication occurs without explicit user instruction.
