# Loom Security Model

Loom is deliberately powerful. Its security boundary is explicit local owner consent plus endpoint-bound OAuth, not command approval or sandboxing.

> **FULL COMPUTER ACCESS ENABLED — sharing the owner password or authorizing an untrusted client is equivalent to giving away this macOS account.**

## Security goals

Loom aims to ensure that:

- unrestricted access exists only while `loom launch --yolo` is running in a visible local terminal
- public MCP remains NOT_READY until a canonical HTTPS `/mcp` resource is known and OAuth is bound to it
- owner credentials, OAuth secrets, commands, environment values, browser typed values, and file content do not enter the dashboard or structured audit metadata
- Loom-owned process trees are identifiable, bounded, and cleaned on stop, timeout, signal, or parent death
- state is private, validated, and written atomically
- file mutations and other sensitive actions fail closed when durable audit start is unavailable
- a changed tunnel endpoint invalidates endpoint-bound OAuth without rotating the installation owner password

## Non-goals

Loom does not provide:

- a command approval layer
- command risk classification
- a filesystem allowlist or workspace sandbox
- a PTY or interactive stdin
- multi-user authorization
- protection from the same macOS user modifying Loom files or binaries
- tamper-proof audit logs
- a hidden daemon or persistent cloud control plane
- automatic recovery of a lost owner password

The same macOS user can inspect, modify, or delete local state. Audit is operational evidence, not a cryptographic accountability system against that user.

## Foreground-only access

`loom launch --yolo` is the only unrestricted launch path. The mode cannot be enabled through configuration, environment variables, aliases, or plain `loom launch`.

Launch requires a direct local `/dev/tty`, macOS 14 or newer, and Node.js 22 or newer. Loom prints the full-access warning locally. A newly generated owner password is displayed only on that local terminal.

There is no launchd job, login item, auto-start, or detached long-lived Loom daemon.

## Owner password

The owner password is a persistent installation credential stored only as a scrypt-derived verifier. It is created once and changes only through:

```bash
loom auth reset
```

The reset command requires direct local confirmation. It rotates the owner credential and revokes OAuth state. Restarts, Quick Tunnel changes, Named Tunnel changes, browser reset, configuration reset, refresh-token rotation, and package upgrades do not rotate it.

Never share the password with a client, collaborator, support contact, or advertiser. Authorizing an untrusted client is equivalent to granting that client the enabled macOS account capabilities.

## OAuth boundary

OAuth state is bound to the exact canonical public resource:

```text
https://<public-host>/mcp
```

Authorization uses a short-lived, single-use server-side transaction containing the client, redirect URI, scope, resource, state, endpoint generation, and PKCE challenge. The password POST carries only the transaction ID and owner password, preventing parameter substitution.

Access and refresh tokens are generation-bound. Refresh rotates both tokens and cannot expand scopes or change resources. Endpoint changes and revoke-all increment generation and invalidate clients, transactions, codes, access tokens, and refresh tokens while preserving the owner password.

## Terminal boundary

`loom_terminal` is unrestricted but noninteractive. The only shell adapter is statically defined as:

```text
/bin/sh -lc <command>
```

There is no PTY and no usable stdin. Loom does not use reflection, method-name guessing, or command strings to launch its own browser or Cloudflared binaries. Those components use verified executable paths and explicit argument arrays.

Commands, cwd, environment names/values, and output do not enter audit records. Output is returned only in MCP content; structured metadata contains lifecycle, cursor, byte, exit, signal, and process-group information.

Audit failure blocks start and cancel. Polling an already-running job remains available so the owner can observe and recover it.

## Process ownership

Terminal, Cloudflared, and Chromium run under a wrapper-owned detached process group. The wrapper:

- establishes the process group before reporting readiness
- ignores stdin
- forwards bounded stdout/stderr
- receives heartbeats
- validates parent PID, start time, and executable identity
- terminates the complete group after missed heartbeat or parent mismatch
- escalates TERM to KILL within fixed deadlines

Negative-PGID signaling retries transient `EPERM` only after ownership revalidation. Persistent permission failure rejects cleanup rather than widening the signal target.

## Filesystem boundary

Public file paths and terminal cwd accept only absolute paths or `~/...`.

- Reads may follow a final symlink only after resolving a stable regular-file target.
- Terminal cwd resolves through `realpath` and may use safe symlink traversal.
- Writes and edits reject every existing symlink component.
- Mutations serialize per canonical path, support expected-hash conflicts, audit before mutation, and replace atomically in the same directory.
- PNG, JPEG, GIF, and WebP are recognized by magic bytes rather than extension.

## Browser boundary

The browser uses a pinned Playwright Chromium revision and a dedicated persistent profile. Loom never attaches to the normal Chrome profile.

Browser setup is explicit and verifies:

- architecture and revision
- exact executable SHA-256
- official Playwright download source
- a real wrapper-owned loopback CDP launch
- atomic promotion and rollback

Missing or corrupt browser installation data puts Loom in browser-unavailable mode while preserving the other six tools. Internal page evaluations are bounded; a hung page is recovered before considering a full-browser restart. Screenshots and downloads use private no-overwrite persistence.

## Cloudflare boundary

Cloudflared is pinned by architecture, archive size, archive SHA-256, executable SHA-256, and exact version. Downloads use credential-free HTTPS, bounded redirects and timeout, private staging, safe extraction, verification, and atomic promotion.

Every launch re-verifies the executable and uses explicit arguments with:

```text
tunnel --no-autoupdate --metrics 127.0.0.1:0
```

### Quick Tunnel

Quick Tunnel is temporary testing only and is never production certified. Loom rejects conflicting persistent Cloudflared config, validates a strict single-label `trycloudflare.com` URL, requires a registered connection, permits one transient recreation, and reports `Production: no`.

Quick Tunnel does not prove stable-subdomain ownership, connector persistence, or takeover resistance.

### Named Tunnel

Named Tunnel is the production path. Loom validates the private current origin certificate and credential JSON, account and tunnel matching, tunnel UUID, canonical secret, stable hostname, explicit ephemeral-origin mapping, transient-only retries, cleanup before retry, and no fallback to Quick.

Automated tests do not prove real DNS routing or Cloudflare account state.

## Dashboard boundary

The dashboard binds only to loopback. Bootstrap uses a 256-bit random token with a five-second TTL and single use, exchanged for an HttpOnly, SameSite=Strict session. Mutations require a per-session CSRF value.

Host and Origin are exact. There is no permissive CORS. Responses use CSP, no-store, no-sniff, frame denial, and no-referrer headers. Rendered values are escaped and recursively redacted.

## Runtime state and lock ownership

Runtime files are private:

```text
~/.loom/runtime/current.json
~/.loom/runtime/loom.lock
```

The lock records PID, start time, executable path, launch ID, and state path. A live exact-identity lock blocks a second runtime. Stale locks are replaced only after process-table validation.

Shutdown removes `runtime/current.json` only when its private file identity and exact serialized readiness bytes still match the immutable state Loom wrote. It removes `loom.lock` only when the persisted lock identity still matches the acquiring launch. Replacement, timeout, or ownership uncertainty preserves evidence fail-closed.

## Audit limitations

Audit files are private 0600 JSONL with bounded rotation and retention. Mutation-start records must be durable before the mutation begins. Sensitive metadata keys and token-like values are redacted.

Audit does not contain terminal commands, terminal output, environment values, file content, browser typed text, screenshots, OAuth secrets, authorization headers, or owner passwords.

Audit is not tamper-proof against the same macOS user.

## Incident response

1. Stop Loom with `Ctrl+C` or terminate the foreground process.
2. Verify no Loom-owned wrapper, terminal, browser, or Cloudflared process remains.
3. Inspect `runtime/current.json`, `runtime/loom.lock`, and private audit files.
4. Rotate the owner password with `loom auth reset` if authorization may have been exposed.
5. Revoke or replace Cloudflare credentials if tunnel credentials may have been exposed.
6. Preserve state and logs before manual cleanup when ownership files were intentionally retained fail-closed.
