# Loom Operator Guide

This guide describes the supported foreground workflow for a single macOS owner.

> **FULL COMPUTER ACCESS ENABLED — sharing the owner password or authorizing an untrusted client is equivalent to giving away this macOS account.**

## Requirements

- macOS 14 or newer
- Node.js 22 or newer
- A direct local terminal with `/dev/tty`
- Cloudflare credentials for Named Tunnel production use
- Browser setup only when `loom_browser` is required

## Public commands

```text
loom launch --yolo
loom setup browser
loom auth reset
loom config check
loom config reset
loom --version
loom --help
```

Plain `loom launch` is intentionally refused.

## Initial setup

From a source checkout:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm link
loom --version
loom --help
```

Install the dedicated browser explicitly:

```bash
loom setup browser
```

The browser can be omitted. Loom will mark browser tools unavailable while the terminal, file, skill, memory, and MCP services remain usable.

## Configuration

Loom stores configuration at `~/.loom/config.json` with mode 0600. Validate it without mutation:

```bash
loom config check
```

Reset invalid configuration only after local confirmation:

```bash
loom config reset
```

Invalid bytes are preserved with a timestamp before private defaults are written.

### Quick Tunnel configuration

```json
{
  "version": 1,
  "tunnel": { "type": "quick" },
  "extraRoots": []
}
```

Quick Tunnel is temporary testing only and always reports `Production: no`. Remove or resolve `~/.cloudflared/config.yaml` and `config.yml` before using Quick mode.

### Named Tunnel configuration

```json
{
  "version": 1,
  "tunnel": {
    "type": "named",
    "name": "loom-prod",
    "hostname": "loom.example.com",
    "credentialsFile": "/Users/you/.cloudflared/<tunnel-id>.json"
  },
  "extraRoots": [
    "/Users/you/custom-skills"
  ]
}
```

Named mode requires the current private Cloudflare origin certificate at `~/.cloudflared/cert.pem`, a private current tunnel credential JSON, a matching account and tunnel name, and a stable HTTPS hostname that is not under `trycloudflare.com`.

## Start

```bash
loom launch --yolo
```

The command requires a direct local terminal. Loom prints the warning locally. On first installation it prints the owner password once. Store it securely and never paste it into chat, source control, screenshots, logs, or tickets.

Startup proceeds in this order:

1. Validate support and configuration.
2. Acquire `~/.loom/runtime/loom.lock`.
3. Initialize audit and process ownership.
4. Start loopback MCP in NOT_READY state.
5. Start the loopback dashboard.
6. Rescan skill and memory catalogs.
7. Start the verified browser or mark it unavailable.
8. Start the configured Cloudflare tunnel.
9. Bind OAuth to the exact public `/mcp` resource.
10. Write `~/.loom/runtime/current.json`.
11. Print one status block and request opening the local dashboard.
12. Remain in the foreground.

No public OAuth challenge is available before step 9.

## Read the status block

The block reports:

- MCP phase
- browser state and version
- skills and memory state/counts
- tunnel mode
- connector readiness
- audit health
- full local MCP URL
- full public MCP URL ending `/mcp`
- dashboard URL
- production eligibility

A Quick Tunnel must show `Production: no`. A Named Tunnel is eligible only after registration and still requires real external certification.

## Local dashboard

The dashboard binds only to loopback. Loom generates a 256-bit, five-second, single-use bootstrap token and exchanges it for an HttpOnly, SameSite=Strict local session. The dashboard can:

- rescan skills and memory
- restart the dedicated browser
- reveal the private audit folder locally
- validate and save next-launch tunnel/extra-root configuration
- revoke all OAuth state without rotating the owner password
- stop Loom

It never shows the owner password, terminal commands, environment values, OAuth tokens, browser typed values, or file content.

## Stop

Use any supported path:

- press `Ctrl+C`
- send `SIGTERM`
- use the dashboard stop action
- close the foreground terminal and allow the parent-death watchdog to clean the owned process group

Shutdown rejects new terminal jobs, cancels retained terminal groups, closes the managed browser, stops Cloudflared, closes MCP and dashboard listeners, drains ProcessManager and audit, and removes ownership files only after cleanup certainty.

Private runtime files:

```text
~/.loom/runtime/current.json
~/.loom/runtime/loom.lock
```

`runtime/current.json` is deleted only when its private identity and exact serialized readiness bytes still match what Loom wrote. `runtime/loom.lock` is deleted only when its persisted identity still matches the current launch. If either file was replaced, cleanup stops and preserves the ownership evidence.

## Owner password rotation

```bash
loom auth reset
```

This requires local confirmation, rotates the owner password, increments OAuth generation, and revokes registered clients, pending authorizations, codes, access tokens, and refresh tokens. It does not delete browser state, memory, skills, audit history, downloads, or general configuration.

Tunnel URL or hostname changes never rotate the owner password.

## Browser recovery

Symptoms:

- `Browser: unavailable`
- browser tool returns a pinned-browser installation error
- manifest or executable verification fails

Repair:

```bash
loom setup browser
```

The installer downloads the pinned revision from the official Playwright CDN, verifies architecture-specific SHA-256, proves a real wrapper-owned launch, and atomically replaces the prior installation only after verification.

## Cloudflared recovery

Loom installs or verifies the pinned Cloudflared release under `~/.loom/cloudflared/`.

Quick mode failures:

- resolve `~/.cloudflared/config.yaml` or `config.yml` conflicts
- confirm outbound HTTPS access
- retry after a transient Cloudflare edge failure

Named mode failures:

- confirm `~/.cloudflared/cert.pem` is current and private
- confirm the configured credential JSON is current, private, and matches the tunnel/account/name
- confirm the stable hostname routes to the named tunnel
- do not switch to Quick mode as an automatic fallback

## Diagnostic files

- Configuration: `~/.loom/config.json`
- OAuth/owner state: `~/.loom/auth.json`
- Runtime status: `~/.loom/runtime/current.json`
- Runtime ownership: `~/.loom/runtime/loom.lock`
- Audit: `~/.loom/audit/*.jsonl`
- Memory: `~/.loom/memory/`
- Browser installation: `~/.loom/browser/`
- Browser profile: `~/.loom/browser-profile/`
- Downloads and screenshots: `~/.loom/downloads/`

Audit is private operational logging, not a tamper-proof security boundary against the same macOS user.
