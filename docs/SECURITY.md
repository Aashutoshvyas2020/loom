# Loom Security Model

## The actual trust boundary

Loom is not a sandbox. `loom launch --yolo` intentionally grants an authenticated remote MCP client unrestricted access equivalent to giving that client your computer account. The owner password is an authorization credential, not a safety boundary against a client you authorize.

The seven public tools include unrestricted `loom_terminal`, file read/write/edit, skill discovery, persistent memory, and browser control. A malicious or compromised authorized client can read private files, change code, run commands, access browser sessions, persist changes, or destroy data available to the macOS account.

Do not expose Loom from a machine or account containing data you are unwilling to hand to the authorized client.

## Terminal execution

`loom_terminal` is the only intentional shell boundary. It uses one static typed adapter equivalent to `/bin/sh -lc <command>` through ProcessManager. It has no PTY and no stdin. Commands, environment values, and output are not written to audit logs.

Every terminal job receives a stable job ID and bounded output cursor. Cancellation, timeout, runtime shutdown, watchdog recovery, and parent death target the entire owned process group, including descendants.

No other Loom-owned command is assembled as a shell string. Cloudflared, Chromium, the macOS opener, and wrapper targets use explicit executable paths and argument arrays.

## Process ownership

ProcessManager launches targets through the child-wrapper/watchdog protocol. The wrapper must flush readiness before a fast target exit or IPC disconnect. The parent verifies wrapper identity, process-group membership, PID start time, and canonical executable path.

Heartbeat loss and process-table fallback trigger group cleanup. Shutdown uses graceful termination followed by forced termination within the fixed deadline. Transient negative-PGID `EPERM` is retried only after fresh identity and membership validation; persistent uncertainty fails closed.

The runtime removes ownership files only after ProcessManager reports zero active jobs.

## Runtime state ownership

`loom.lock` records the exact launch identity. A live exact identity blocks a second launch. A stale lock is re-read before removal. Release verifies that the lock bytes still represent the same launch and that the current process identity still matches.

`current.json` is owned separately. RuntimeReadiness removes it only if its bytes exactly match the canonical state that the same runtime last persisted. A replacement, disappearance, symlink, nonregular file, or other mismatch preserves the lock and fails closed.

The absolute shutdown deadline bounds every awaited cleanup operation. Hitting the deadline does not turn uncertainty into success; ownership files remain.

## Authentication and OAuth

The owner password is generated once for a new auth store, printed only to `/dev/tty`, and stored only as a verifier. It is not printed by `loom status`, included in runtime state, returned by tools, or written to AuditLogger.

OAuth clients, authorization codes, and tokens are endpoint-bound. The canonical `/mcp` resource URI has a generation. A public endpoint change increments that OAuth generation and invalidates endpoint-bound credentials. Endpoint changes do not rotate the owner password.

Revocation is available through the local dashboard. Never enter the owner password anywhere except the verified Loom authorization page for your own endpoint.

## Tunnel security

Quick Tunnel is temporary and non-production. Loom accepts only a strict single-label `trycloudflare.com` origin from bounded Cloudflared output, requires a registered connection, and rejects persistent config conflicts. URL changes invalidate endpoint-bound OAuth state.

Named Tunnel is the stable path. Loom validates current-user private origin certificate and credential files, strict fields, account matching, tunnel-name matching, UUID and secret encoding, and stable file identity before every process attempt. Authentication/configuration failures stop immediately. Only transient failures retry, cleanup must finish between attempts, and there is no Quick Tunnel fallback.

Public endpoint status remains unavailable until registration. Closing the tunnel is part of foreground shutdown and public access must end before ownership files are removed.

## Browser security

The managed browser uses the recorded supported Chromium revision and executable identity. It rejects arbitrary executable substitution. Browser absence or browser-specific validation failure produces `Browser: unavailable` and leaves non-browser tools operational.

Browser automation can access whatever the managed browser profile can access. Treat authenticated browser sessions as secrets.

## Audit

AuditLogger is append-only JSONL with private permissions and durable mutation-start records. Mutating operations fail closed if audit is unavailable before the side effect.

Audit records intentionally exclude owner passwords, OAuth secrets/tokens, command text, environment values, terminal output, Cloudflared output, tunnel hostname/endpoint, credential and certificate values, file contents, and browser screenshot bytes. Audit proves operation classes and outcomes, not secret payloads.

Dashboard stop is scheduled after its audit record finishes; otherwise shutdown would close audit before the record could be completed.

## Threats Loom does not solve

- A malicious authorized MCP client.
- A compromised macOS user account.
- Malware already running as the same user.
- A compromised browser session or external identity provider.
- Cloudflare, network, DNS, or ChatGPT account compromise.
- Physical access to an unlocked machine.
- Recovery of data already copied by an authorized client.

## Incident response

1. Stop the foreground Loom process or disconnect the machine from the network.
2. Confirm the Cloudflare tunnel and public access are gone.
3. Run `loom status` and inspect `current.json`, `loom.lock`, audit records, and Loom-owned process groups.
4. Revoke OAuth through the dashboard if it is still available; otherwise stop and reset local auth state deliberately.
5. Rotate any external credentials that may have been accessible through files, commands, memory, or browser sessions.
6. Preserve audit and ownership files when cleanup is uncertain. Do not erase evidence merely to make status look clean.
