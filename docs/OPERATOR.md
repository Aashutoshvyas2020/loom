# Loom Operator Guide

Loom exposes unrestricted local computer tools through a remote MCP endpoint. It is not a sandbox. Only run it for a connector and account you trust completely.

## Requirements

- A supported macOS host.
- Node.js 22 or newer.
- A controlling local terminal. `loom launch --yolo` refuses to start without `/dev/tty`.
- For a Named Tunnel: a stable DNS hostname, `~/.cloudflared/cert.pem`, and the matching private Cloudflare `credentialsFile` JSON.
- For ChatGPT: an account or workspace currently eligible to add a custom MCP app/connector. OpenAI changes labels and eligibility; verify the current official Connectors and MCP documentation before certification.

Until Loom is published, install from a checked-out source tree:

```bash
npm ci
npm run build
npm link
```

## Commands

```text
loom setup
loom setup --with-browser
loom launch
loom launch --yolo
loom status
loom reset --confirm
```

`loom setup` creates the private `~/.loom` state tree and default config. `loom setup --with-browser` also installs and records the supported pinned Chromium revision. Cloudflared is acquired and verified through Loom's managed release path when the foreground runtime needs it.

`loom launch` is intentionally side-effect free. It explains that unrestricted launch requires the explicit `--yolo` flag.

`loom launch --yolo` writes a red `FULL COMPUTER ACCESS ENABLED` warning to `/dev/tty`, shows a newly generated owner password there once, starts the complete runtime, prints one status block, opens the local dashboard, and remains in the foreground until dashboard stop, SIGINT, or SIGTERM.

`loom status` reads the private runtime state. It does not reveal the owner password.

`loom reset --confirm` removes Loom state only after refusing an exact live runtime owner. Stop Loom first. Back up anything under `~/.loom` you intend to keep.

## State and configuration

Loom keeps private state under `~/.loom`. Important files include:

- `~/.loom/config.json`: strict versioned configuration.
- `~/.loom/runtime/current.json`: the latest canonical runtime status.
- `~/.loom/runtime/loom.lock`: launch identity and ownership.
- `~/.loom/auth.json`: owner-password verifier and OAuth state.
- `~/.loom/audit/`: secret-minimized JSONL audit records.
- `~/.loom/browser/`: pinned browser installation and manifest.
- `~/.loom/cloudflared/`: managed Cloudflared binary and release metadata.

Loom removes `current.json` only when its bytes exactly match the state that the same runtime last wrote. It removes `loom.lock` only after all supervised jobs are gone and the persisted launch identity still matches the live process. Replacement or uncertain state fails closed and remains for inspection.

The default Quick Tunnel configuration is equivalent to:

```json
{
  "version": 1,
  "tunnel": { "type": "quick" },
  "extraRoots": []
}
```

A Named Tunnel configuration is equivalent to:

```json
{
  "version": 1,
  "tunnel": {
    "type": "named",
    "name": "loom-prod",
    "hostname": "loom.example.com",
    "credentialsFile": "~/.cloudflared/6f4f721c-22f2-41c7-a77d-41e5b09e4fc2.json"
  },
  "extraRoots": []
}
```

The default origin certificate path is `~/.cloudflared/cert.pem`. Named credentials must match the certificate account, configured tunnel name, and current strict credential schema. Authentication files must be current-user private regular files with no symlink components.

## Tunnel modes

### Quick Tunnel

A Quick Tunnel uses a temporary `https://<label>.trycloudflare.com` origin and publishes the complete MCP endpoint ending in `/mcp`. Quick Tunnel is explicitly non-production. Loom rejects persistent Cloudflared config files that could redirect the ephemeral local origin, requires registration within the readiness deadline, and permits only the bounded transient recreation defined by the implementation.

The temporary URL can change on restart. A URL change increments the OAuth generation and invalidates endpoint-bound OAuth state. It does not rotate the persistent owner password.

### Named Tunnel

A Named Tunnel uses the configured stable hostname and publishes:

```text
https://<hostname>/mcp
```

Loom uses an explicit ephemeral loopback origin mapping rather than a persistent ingress target, validates the certificate and credentials before every attempt, waits for a registered connection, retries only transient failures within the fixed bounds, and never falls back to Quick Tunnel.

Restarting with the same canonical stable endpoint preserves the OAuth generation and owner password. Changing the hostname changes the endpoint, increments the OAuth generation, and invalidates endpoint-bound OAuth state without rotating the owner password.

## Connecting ChatGPT

The exact ChatGPT UI labels can change. Use the current official OpenAI Connectors/Apps and MCP documentation for your eligible account or workspace.

1. Run `loom launch --yolo` and wait for `Connector ready: yes`.
2. Copy the full `Public MCP` value from the status block. It must be HTTPS and end in `/mcp`.
3. In ChatGPT's current custom app/connector or developer-mode interface, add a remote MCP server using that exact URL.
4. Complete the OAuth flow. Enter the Loom owner password only on the authorization page served from the Loom endpoint after verifying its hostname. Never paste the owner password into a conversation, message, configuration shared with another person, or support ticket.
5. Confirm the connector exposes all seven tools before using it with sensitive data.

Useful official references:

- OpenAI Help Center: Connectors in ChatGPT — https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
- OpenAI platform MCP documentation — https://platform.openai.com/docs/mcp

## Reading the status block

A ready runtime prints the local MCP endpoint, dashboard URL, public origin, complete public `/mcp` endpoint, tunnel mode, connector readiness, production eligibility, browser state, catalog counts, and audit state.

`Browser: unavailable` is an intentional degraded state. Missing, corrupt, unsupported, or unverifiable browser installation disables only browser tools. File, terminal, skill, memory, OAuth, dashboard, and connector operation continue.

A Quick Tunnel always reports non-production eligibility. A Named Tunnel becomes production-eligible only after registration and stable endpoint binding. This label is an implementation status, not external release certification.

## Shutdown

Use the dashboard stop control or send SIGINT/SIGTERM to the foreground process. Loom immediately rejects new terminal jobs, then shuts down terminal groups, browser, tunnel/public access, MCP, dashboard, supervised processes, audit, owned `current.json`, and the exact owned lock.

Every awaited cleanup operation shares one absolute shutdown deadline. If a process, state file, or lock cannot be proven clean, Loom preserves ownership evidence and exits with an error instead of claiming success.

## Troubleshooting

**No controlling local terminal:** Run the command directly in Terminal, iTerm, or another real macOS terminal. Piped or detached launch is intentionally refused.

**`Browser: unavailable`:** Run `loom setup --with-browser`. If it remains unavailable, inspect the browser manifest and executable ownership/version. Do not substitute an arbitrary Chromium binary.

**Quick Tunnel config conflict:** Remove or relocate `~/.cloudflared/config.yaml` or `config.yml` only after confirming it is yours and not needed. Loom will not silently ignore persistent ingress configuration.

**Named Tunnel authentication/config failure:** Verify `credentialsFile`, `~/.cloudflared/cert.pem`, tunnel name, hostname, file ownership, and permissions. Loom does not fall back to Quick Tunnel.

**Lock remains after shutdown:** Treat it as cleanup uncertainty. Run `loom status`, inspect `current.json`, `loom.lock`, audit records, and process groups. Do not delete ownership files until you have proved no Loom process or descendant remains.

**Owner password lost:** Loom stores only a verifier and will not reveal it again. Stop Loom and use the explicit reset workflow, understanding that reset invalidates local state and OAuth material.
