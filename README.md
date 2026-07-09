# Loom

Loom is a foreground-only, single-owner MCP server for macOS. It exposes unrestricted noninteractive terminal execution, local file tools, skill and memory catalogs, and a dedicated Playwright browser to an authenticated MCP client only while the owner is visibly running:

```bash
loom launch --yolo
```

> **FULL COMPUTER ACCESS ENABLED — sharing the owner password or authorizing an untrusted client is equivalent to giving away this macOS account.**

Loom has no launch daemon, login item, hidden background supervisor, cloud control plane, workspace sandbox, command approval layer, path allowlist, PTY, or usable stdin. Stopping the foreground process ends public access and cleans Loom-owned processes.

## Support floor

- macOS 14 or newer
- Node.js 22 or newer
- A direct local terminal for unrestricted launch and credential reset
- Cloudflare access for a production Named Tunnel
- An eligible ChatGPT workspace/account with custom MCP or developer-mode support for real connector certification

Windows and Linux are not release targets for Loom v1.

## Install from source

```bash
git clone <your Loom repository URL>
cd loom
npm ci
npm run typecheck
npm test
npm run build
npm link
```

No browser is downloaded by `npm install`. Browser installation is explicit:

```bash
loom setup browser
```

The pinned Chromium build is installed under `~/.loom/browser/`, verified by revision, architecture-specific SHA-256, and a real wrapper-owned launch. Loom uses a separate persistent profile under `~/.loom/browser-profile/`; it never attaches to the normal Chrome profile.

## Install a packed build

Create and inspect a package without publishing it:

```bash
npm pack --dry-run
npm pack
```

Install the generated tarball into a clean prefix or globally:

```bash
npm install -g ./loom-mcp-0.1.0.tgz
loom --version
loom --help
```

Publication and deployment are separate explicit actions. The repository does not push or publish automatically.

## Commands

```text
loom launch --yolo
loom setup browser
loom auth reset
loom config check
loom config reset
loom --version
loom --help
```

Plain `loom launch` deliberately refuses to start unrestricted access.

## First launch

```bash
loom launch --yolo
```

Launch requires `/dev/tty`. Loom prints the full-access warning there. On the first installation only, it also prints the generated owner password in red. Store that password securely. It is never shown in the dashboard, status block, audit log, or remote MCP response.

The owner password is persistent. Restarts, Quick Tunnel URL changes, Named Tunnel hostname changes, token refresh, browser reset, configuration reset, and package upgrades do not rotate it. To rotate it explicitly:

```bash
loom auth reset
```

That command requires local terminal confirmation, revokes OAuth state, and preserves non-auth state.

## Tunnel modes

### Quick Tunnel

Quick Tunnel is for setup and temporary testing only. It produces a changing `https://<label>.trycloudflare.com` origin and Loom publishes the MCP endpoint as:

```text
https://<label>.trycloudflare.com/mcp
```

Quick mode is always shown as `Production: no`. Loom refuses Quick mode while `~/.cloudflared/config.yaml` or `config.yml` exists because those files can change Cloudflared semantics. A changed Quick URL invalidates endpoint-bound OAuth state but does not rotate the owner password.

### Named Tunnel

Named Tunnel is the production path. Configure a stable HTTPS hostname, tunnel name, and current tunnel credential JSON. Loom also validates the current private Cloudflare origin certificate, verifies account/name/UUID/secret consistency, and launches an explicit ephemeral-origin mapping to the actual loopback MCP port. It never falls back to Quick Tunnel.

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

The public MCP resource is exactly:

```text
https://loom.example.com/mcp
```

Named mode can be production-eligible only after Cloudflared reports a registered connection. Real DNS routing, connector persistence, and ChatGPT compatibility require external certification; deterministic local tests do not prove them.

## Browser behavior

When the verified pinned browser is installed, Loom starts it through the same wrapper/watchdog process boundary as terminal and Cloudflared, using the dedicated persistent profile. When the browser manifest is missing or corrupt, Loom starts in browser-unavailable mode and leaves the other six tools available. Run:

```bash
loom setup browser
```

to install or repair the browser.

## Runtime status

After every required component is ready, Loom prints one status block containing:

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

Loom also requests opening the single-use authenticated dashboard bootstrap URL locally. Failure to open the browser is nonfatal; copy the printed dashboard URL into a local browser while it remains valid.

Runtime ownership files are private:

```text
~/.loom/runtime/current.json
~/.loom/runtime/loom.lock
```

They are removed only after cleanup and exact ownership checks succeed. Replacement, deadline, or cleanup uncertainty preserves them fail-closed for diagnosis.

## Stop Loom

Press `Ctrl+C`, send `SIGTERM`, or use the dashboard stop action. Loom rejects new terminal jobs, cancels terminal process groups, closes the managed browser, stops Cloudflared, terminates MCP public access, closes the dashboard, drains the audit queue, and removes owned runtime state and lock after cleanup certainty.

Closing the foreground terminal also ends access through the parent-death watchdog. A forced parent-death case is part of local process testing, but external public-access termination remains part of release certification.

## Configuration and recovery

Validate configuration without modifying it:

```bash
loom config check
```

Preserve invalid bytes and write private defaults after local confirmation:

```bash
loom config reset
```

The dashboard may write validated tunnel and extra-root settings for the next launch. It may also rescan catalogs, restart the dedicated browser, reveal the private audit folder locally, revoke all OAuth state without rotating the owner password, or stop Loom.

## ChatGPT connector boundary

Loom implements standard endpoint-bound OAuth and Streamable HTTP MCP. The protected resource is the exact public `/mcp` URL. Availability and naming of custom MCP/developer-mode controls are external to this repository and may differ by ChatGPT workspace or account. Do not claim successful ChatGPT integration until the real G5/G6 evidence in `docs/RELEASE_CERTIFICATION.md` has been collected.

## Security and operations

- [Operator guide](docs/OPERATOR.md)
- [Security model](docs/SECURITY.md)
- [Development and governance](docs/DEVELOPMENT.md)
- [Release certification](docs/RELEASE_CERTIFICATION.md)
- [Release evidence index](docs/release-evidence/README.md)

## License and notices

Loom source is licensed under the MIT License. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Chromium and Cloudflared are separately distributed third-party components and retain their own licenses and trademarks.
