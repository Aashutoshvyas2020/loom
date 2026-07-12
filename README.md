<p align="center">
  <img src="public/logo.png" alt="Loom logo" width="180">
</p>

<h1 align="center">Loom</h1>

<p align="center">
  Foreground-only, single-owner MCP server for macOS.
</p>

<p align="center">
  Loom exposes exactly seven bounded tools to an authenticated MCP client while the owner is visibly running the app.
</p>

> FULL COMPUTER ACCESS ENABLED — sharing the owner password or authorizing an untrusted client is equivalent to giving away this macOS account.

## What Loom does

- `loom_terminal` for unrestricted noninteractive terminal jobs.
- `loom_read` for local file, directory, text, binary, and image reads.
- `loom_write` for atomic writes inside approved roots.
- `loom_edit` for exact-match edits inside approved roots.
- `loom_skills` for skill discovery and activation.
- `loom_memory` for Loom-owned session memory.
- `loom_browser` for a dedicated Playwright Chromium profile.

Loom is intentionally simple at the product edge:

- no launch daemon
- no login item
- no hidden background supervisor
- no cloud control plane
- no workspace sandbox
- no command approval layer

Stopping the foreground process ends public access and cleans Loom-owned processes.

## Quick start

```bash
loom launch --yolo
```

That starts the foreground server, prints the owner password on first launch, and opens the public MCP endpoint through the configured tunnel.

If you already have the repository:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm link
loom launch --yolo
```

If you want the packed artifact instead:

```bash
npm pack --dry-run
npm pack
npm install -g ./loom-mcp-0.1.0.tgz
loom --version
loom --help
```

## Requirements

- macOS 14 or newer
- Node.js 22 or newer
- A direct local terminal for unrestricted launch and credential reset
- Cloudflare access for a production Named Tunnel
- A ChatGPT workspace or account with custom MCP or developer-mode support for connector certification

Windows and Linux are not release targets for Loom v1.

## Launch flow

`loom launch --yolo` is the only supported public entrypoint. Plain `loom launch` deliberately refuses to start unrestricted access.

On first launch, Loom prints the full-access warning and the generated owner password in red. Store that password securely. The password is persistent across restarts, tunnel URL changes, token refresh, browser reset, config reset, and package upgrades until you rotate it explicitly.

```bash
loom auth reset
```

The CLI reset command requires local terminal confirmation, revokes OAuth state, and preserves non-auth state.

## Tunnel modes

### Quick Tunnel

Quick Tunnel is for setup and temporary testing only. It produces a changing `https://<label>.trycloudflare.com` origin and Loom publishes the MCP endpoint as:

```text
https://<label>.trycloudflare.com/mcp
```

Quick mode always shows `Production: no`. Loom refuses Quick mode while `~/.cloudflared/config.yaml` or `config.yml` exists because those files can change Cloudflared semantics.

### Named Tunnel

Named Tunnel is the production path. Configure a stable HTTPS hostname, tunnel name, and current tunnel credential JSON.

Example `~/.loom/config.json`:

```json
{
  "version": 1,
  "tunnel": {
    "type": "named",
    "name": "loom-prod",
    "hostname": "loom.example.com",
    "credentialsFile": "/Users/you/.cloudflared/<tunnel-id>.json"
  },
  "extraRoots": []
}
```

The public MCP resource is:

```text
https://loom.example.com/mcp
```

Named mode can be production-eligible only after Cloudflared reports a registered connection. Real DNS routing, connector persistence, and ChatGPT compatibility require external certification.

## Browser

Loom uses a dedicated persistent Playwright Chromium profile under `~/.loom/browser-profile/`. It does not attach to the normal Chrome profile.

If the browser manifest is missing or corrupt, Loom starts in browser-unavailable mode and keeps the other six tools available.

```bash
loom setup browser
```

## Runtime status

When the required components are ready, Loom prints one status block containing:

- MCP state
- browser state
- skill and memory state/counts
- tunnel type and connector readiness
- audit health
- full loopback MCP URL
- full public MCP URL ending in `/mcp`
- authenticated local dashboard URL
- production eligibility
- the full-access warning

Loom also requests opening the single-use authenticated dashboard bootstrap URL locally. If the browser does not open, copy the printed URL into a local browser while it is still valid.

## Stop Loom

Use any of these:

```text
Ctrl+C
SIGTERM
dashboard stop
```

Loom rejects new terminal jobs, cancels terminal process groups, closes the managed browser, stops Cloudflared, terminates MCP public access, closes the dashboard, drains the audit queue, and removes owned runtime state and lock after cleanup certainty.

Closing the foreground terminal also ends access through the parent-death watchdog.

## Configuration

Validate config without changing it:

```bash
loom config check
```

Reset config with local confirmation:

```bash
loom config reset
```

The dashboard can also write validated tunnel and extra-root settings, rescan catalogs, restart the browser, reveal the private audit folder locally, rotate the owner password, revoke OAuth state, or stop Loom.

## Security

- Filesystem access is constrained to configured roots.
- Private-network and unsafe browser URLs are blocked.
- Browser actions use accessibility snapshot references, not arbitrary selectors.
- Terminal inputs have no caller-controlled environment injection.
- Explicitly dangerous terminal commands are rejected.
- Every twentieth tool call refreshes the bundled operating-skill reminder for that authenticated MCP session.

This is powerful local access. Only connect clients you trust.

## Docs

- [Operator guide](docs/OPERATOR.md)
- [Security model](docs/SECURITY.md)
- [Development and governance](docs/DEVELOPMENT.md)
- [Release certification](docs/RELEASE_CERTIFICATION.md)
- [Release evidence index](docs/release-evidence/README.md)

## License

Loom source is licensed under the MIT License. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Chromium and Cloudflared are separately distributed third-party components and retain their own licenses and trademarks.
