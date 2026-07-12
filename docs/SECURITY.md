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

The same macOS user can inspect, modify, or delete local state. An authorized remote client has unrestricted shell capability as that user and can therefore do the same. Audit is privacy-oriented operational evidence, not a forensic, append-only, tamper-evident, or off-device accountability system.

## Authorized-agent and untrusted-content risks

OAuth authenticates a client; it does not establish that the client model, its conversation, or content returned by tools is benign. Browser pages, files, skills, terminal output, and Loom memory are untrusted inputs and can carry direct or indirect prompt injection. Loom does not attempt to identify or sanitize instructions in that content because doing so would not reliably prevent an unrestricted agent from acting on them.

A successful prompt injection can cross tool boundaries. For example, content returned by `loom_browser`, `loom_read`, `loom_skills`, or `loom_memory` can influence the authorized agent to invoke `loom_terminal`, write a file, persist a memory, or navigate elsewhere. Loom memory and the dedicated persistent browser profile survive restart and `loom auth reset`; browser cookies and saved memory can therefore carry risk into a later authorized session. Resetting the owner password revokes OAuth but does not clear those stores.

All ordinary tool content is intentionally returned to the authorized remote MCP client. Terminal output, file content, browser text, screenshots, and other results may be processed or retained by that client or its LLM provider. Local audit redaction does not redact the actual MCP response channel.

## Foreground-only access

`loom launch --yolo` is the only unrestricted launch path. The mode cannot be enabled through configuration, environment variables, aliases, or plain `loom launch`.

Launch requires a direct local `/dev/tty`, macOS 14 or newer, and Node.js 22 or newer. Loom prints the full-access warning locally. A first-install owner password is displayed only on that local terminal.

There is no launchd job, login item, auto-start, or detached long-lived Loom daemon.

## Owner password

The owner password is a persistent installation credential stored only as a scrypt-derived verifier. New verifiers use scrypt N=32768, r=8, p=3; a successful authorization transparently upgrades an older N=16384, r=8, p=1 verifier. It is created once and changes only through:

```bash
loom auth reset
```

or the authenticated local dashboard rotate action.

The CLI reset command requires direct local confirmation. The dashboard path returns the replacement password only in that single POST response and must not make it fetchable by later GET or status calls. Both paths rotate the owner credential and revoke OAuth state. Restarts, Quick Tunnel changes, Named Tunnel changes, browser reset, configuration reset, refresh-token rotation, and package upgrades do not rotate it.

Never share the password with a client, collaborator, support contact, or advertiser. Authorizing an untrusted client is equivalent to granting that client the enabled macOS account capabilities. Loom v1 has no MFA. The stable Named Tunnel hostname is an address, not a secret or authentication factor; assume it can be discovered.

## OAuth boundary

OAuth state is bound to the exact canonical public resource:

```text
https://<public-host>/mcp
```

Authorization uses a short-lived, single-use server-side transaction containing the client, redirect URI, scope, resource, state, endpoint generation, and PKCE challenge. The password POST carries only the transaction ID and owner password, preventing parameter substitution.

Access and refresh tokens are generation-bound. Refresh rotates both tokens, cannot expand scopes or change resources, and cannot extend the original refresh-token family beyond its absolute 30-day lifetime. The public owner-password POST is limited to ten attempts per monotonic 60-second window for the running process. This is an in-memory availability and brute-force control, not distributed edge rate limiting, and a remote party can consume the shared window to cause temporary authorization denial of service. Endpoint changes and revoke-all increment generation and invalidate clients, transactions, codes, access tokens, and refresh tokens while preserving the owner password.

## Terminal boundary

`loom_terminal` is unrestricted but noninteractive. The only shell adapter is statically defined as:

```text
/bin/sh -lc <command>
```

There is no PTY and no usable stdin. Loom does not use reflection, method-name guessing, or command strings to launch its own browser or Cloudflared binaries. Those components use verified executable paths and explicit argument arrays.

Commands, cwd, environment names/values, and output do not enter audit records. Output is returned only in MCP content; structured metadata contains lifecycle, cursor, byte, exit, signal, and process-group information.

Audit failure blocks terminal start and capability-increasing browser mutations. Polling an already-running job, cancelling a terminal job, and closing a browser tab remain available because they reduce active capability and are required for containment.

## Process ownership

Terminal, Cloudflared, and Chromium run under a wrapper-owned detached process group. The wrapper:

- establishes the process group before reporting readiness
- ignores stdin
- forwards bounded stdout/stderr
- receives heartbeats
- validates parent PID, start time, and executable identity
- terminates the complete group after missed heartbeat or parent mismatch
- escalates TERM to KILL within fixed deadlines

Negative-PGID signaling retries transient `EPERM` only after ownership revalidation. Persistent permission failure rejects cleanup rather than widening the signal target. Watchdog `ps` and `lsof` calls use a fixed C locale, bounded buffers, and a two-second hard timeout.

The process-group boundary is reliable for ordinary descendants that stay in the inherited group. An unrestricted command can deliberately call `setsid()` or otherwise create a new session/process group and escape that ownership tree. Loom v1 does not sandbox or prevent that behavior. The controlled adversarial test confirmed such an escaped process survives owned-group cancellation; operators must treat deliberate daemonization as outside the cleanup guarantee.

## Filesystem boundary

Public file paths and terminal cwd accept only absolute paths or `~/...`.

- Reads may follow a final symlink only after resolving a stable regular-file target; the target is opened nonblocking before regular-file verification so FIFO or device replacement cannot hang the server.
- Terminal cwd resolves through `realpath` and may use safe symlink traversal.
- On macOS, the root-owned compatibility aliases `/tmp` and `/var` are canonicalized to `/private/tmp` and `/private/var`; other symbolic-link components remain rejected for mutation.
- Writes and edits reject every other existing symlink component.
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

The dedicated browser profile is persistent by design. Cookies, local storage, login state, and browsing artifacts can outlive the foreground process and be available to a later authorized client. Loom does not currently impose automatic retention or cleanup on the profile, downloads, or screenshots. Do not use the profile for sensitive accounts unless that persistence is intended.

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

## Localhost, private-network, and macOS permission boundary

`loom_browser` intentionally permits HTTP/HTTPS navigation to localhost and private-network addresses, and `loom_terminal` can reach the same resources. This is useful for development but creates an SSRF/LAN pivot for any authorized or prompt-injected agent. Services that rely only on network position are not protected from Loom.

macOS Transparency, Consent, and Control (TCC) remains enforced by the operating system. Desktop, Documents, Downloads, network volumes, Full Disk Access, Accessibility, Automation, Camera, and Microphone may require user approval and can fail with `Operation not permitted`. Loom does not bypass TCC and cannot reliably answer those prompts remotely.

Terminal commands execute through `/bin/sh -lc`, so the login shell can source profile files and inherits the Loom process environment plus explicit overrides. Exported credentials and secrets in shell profiles or the launch environment are available to an authorized terminal client. Start Loom from a minimal environment and inspect profile files before use.

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

Audit is not tamper-proof against the same macOS user or an authorized remote client with shell access. Its deliberate omission of commands, output, file contents, browser text, and secrets means it cannot reconstruct exactly what a compromised agent executed. It should not be described as forensic evidence.

## Incident containment

The dashboard and foreground stop controls are local-only. Loom has no independent remote kill service. If the owner is away from the Mac and an authorized session becomes malicious, immediate containment requires another trusted access path to that Mac or physical access. The compromised client itself is not a trusted recovery channel.

The owner password can be shown on the local terminal or once in the authenticated local dashboard after a rotation. Terminal scrollback, browser screenshots, shell recording, screen sharing, and copied page contents can retain it. Clear or protect those surfaces after first launch or reset.

## Incident response

1. Stop Loom with `Ctrl+C` or terminate the foreground process.
2. Verify no Loom-owned wrapper, terminal, browser, or Cloudflared process remains.
3. Inspect `runtime/current.json`, `runtime/loom.lock`, and private audit files.
4. Rotate the owner password with `loom auth reset` or the authenticated local dashboard if authorization may have been exposed.
5. Do not treat reset as full remediation: it does not clear memory, skills, browser cookies/profile state, downloads, screenshots, shell profiles, scheduled jobs, or files written by the client. Review or remove those separately while Loom is stopped.
6. Revoke or replace Cloudflare credentials if tunnel credentials may have been exposed.
7. Preserve state and logs before manual cleanup when ownership files were intentionally retained fail-closed, while recognizing that the local audit cannot prove which commands or content were used.
