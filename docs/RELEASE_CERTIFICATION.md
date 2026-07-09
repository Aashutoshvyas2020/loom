# Loom Release Certification

This document separates deterministic local implementation evidence from external production certification.

## Current deterministic local status

The latest committed T14 evidence records:

- exact runtime/CLI/config/OAuth target: 49/49
- five runtime stress runs: 90/90 executions
- full repository suite: 185/185
- clean typecheck and standalone build
- no Loom-owned process or listener residue after stress runs
- exact runtime state and lock ownership preservation on replacement or cleanup uncertainty

T15 packaging evidence is added only after the package tarball, clean-prefix installation, installed CLI commands, packaged dashboard assets, and documentation files are verified.

## Certification labels

### Deterministic local readiness

This label means the repository passes its local automated and real-process gates on the development Mac. It covers code behavior, not external services.

### Production eligible

This label may appear at runtime only for a registered Named Tunnel with a stable hostname. It does not by itself prove ChatGPT compatibility or external cleanup.

### Production certified

This label requires every deterministic gate plus real G5 and G6 evidence and clean supported-Mac packaging/install evidence. Quick Tunnel can never satisfy production certification.

## Certification report command

Run the deterministic collector from a clean checkout:

```bash
npm run certify -- --output /absolute/path/to/loom-certification-report.json
```

An optional `--external /absolute/path/to/evidence.json` manifest validates strict field shape, the exact release SHA, pinned managed-component metadata, and the SHA-256 integrity of referenced private regular files. It does not prove that Cloudflare, ChatGPT, OAuth, tool calls, or cleanup events actually occurred. Those gates remain blocked until a human reviews the real sanitized evidence. The current automated verifier therefore returns exit code 2 when deterministic checks pass, and exit code 1 when a performed check fails; it does not independently grant production certification.

## G5 — real Named Tunnel and ChatGPT prerequisite

Required evidence:

1. An eligible ChatGPT workspace/account with custom MCP or developer-mode support.
2. A real Cloudflare account with a current private origin certificate.
3. A real Named Tunnel with current private credential JSON.
4. Stable public DNS hostname routing to that tunnel.
5. Loom launched against the exact ephemeral loopback MCP origin.
6. Public requests to the exact `https://<hostname>/mcp` resource.
7. OAuth protected-resource and authorization-server discovery over the public hostname.
8. No Named-to-Quick fallback.

Record:

- date and machine
- Loom commit SHA and package version
- hostname and tunnel ID in redacted form
- Cloudflared version and verified executable hash
- local MCP origin and public `/mcp` URL
- HTTP status and response headers for discovery routes
- process IDs/PGIDs before and after launch
- sanitized command transcript or screenshots

G5 is not yet certified in this repository because real account, DNS, and eligible ChatGPT workspace evidence is external.

## G6 — real ChatGPT OAuth, tools, reconnect, and cleanup

Required evidence after G5:

1. Add Loom as a custom MCP connector using the real public `/mcp` URL.
2. Complete OAuth through the Loom owner authorization page.
3. Verify the client sees exactly seven tools.
4. Execute representative calls for terminal, read, write/edit, skills, memory, and browser.
5. Verify refresh-token rotation and reconnect without owner-password rotation.
6. Verify an endpoint change invalidates endpoint-bound OAuth.
7. Stop via `Ctrl+C` and prove the public endpoint, local listeners, wrapper groups, terminal descendants, browser, and Cloudflared are gone.
8. Repeat for `SIGTERM`.
9. Close the foreground terminal and prove parent-death watchdog cleanup.
10. Force-kill the foreground parent and prove watchdog cleanup.
11. Confirm `runtime/current.json` and `runtime/loom.lock` are removed only after certain cleanup.
12. Confirm no owner password, token, command, browser typed value, or file content appears in dashboard or audit.

Record sanitized ChatGPT screenshots, OAuth/reconnect observations, representative tool results, process/listener scans, and exact shutdown timing.

G6 is not yet certified in this repository because it requires a real eligible ChatGPT account/workspace and public connector.

## Packaging and clean-machine evidence

Required before release certification:

1. `npm ci`
2. typecheck, full tests, and build
3. `npm pack --dry-run`
4. inspect tarball file list
5. `npm pack`
6. install tarball into a clean temporary prefix
7. run installed `loom --version` and `loom --help`
8. confirm plain launch refuses
9. confirm sessionless YOLO launch fails before state creation
10. confirm dashboard assets, docs, license, and notice are packaged
11. test explicit browser setup on a supported clean Mac
12. test Quick launch as non-production
13. test Named launch with real credentials
14. repeat process/listener cleanup scans

## Unsupported claims

Do not claim any of the following without recorded real evidence:

- stable Quick Tunnel ownership or persistence
- stale Quick subdomain takeover resistance
- real Cloudflare DNS routing
- Named connector persistence across sleep/wake
- ChatGPT custom MCP availability for every account
- real ChatGPT OAuth, reconnect, or tool compatibility
- Windows or Linux support
- protection from the same macOS user
- tamper-proof audit

## Evidence storage

Store sanitized evidence under `docs/release-evidence/` and index it in `docs/release-evidence/README.md`. Never commit owner passwords, OAuth tokens, Cloudflare secrets, authorization headers, private file content, or unredacted account identifiers.
