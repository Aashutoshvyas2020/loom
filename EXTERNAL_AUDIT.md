# Loom v1 External Expert Audit Dossier

> **Purpose:** This is the single-file audit dossier for the complete Loom v1 repository. It is intentionally long. It combines an independently readable architectural and security description with exact repository inventories, implementation history, evidence boundaries, and verbatim snapshots of the governing documents used to build the system.
>
> **Audit baseline parent commit:** `9cc293323a88bd9100319949e90fe64f19293f34`
>
> **Branch:** `planning/loom-v1-cavekit`
>
> **Repository:** `/Users/aashu/loom`
>
> **Product version:** `loom-mcp` `0.1.0`
>
> **Supported floor:** macOS 14 or newer and Node.js 22 or newer
>
> **Documentation task:** T15.2, added by explicit plan amendment for external expert audit
>
> **Interpretation of status:** `implemented` means production code and deterministic local tests exist. `locally verified` means a real local command or process was exercised. `externally certified` is reserved for the real Named Tunnel, ChatGPT, lifecycle, sleep/wake, and connector-persistence evidence required by G5, G6, T16, and G7. This dossier does not promote local evidence into external certification.

## How to use this dossier

An auditor can read this file in four passes:

1. Read the product, architecture, and security sections to understand what Loom is designed to do and what it intentionally refuses to do.
2. Read the subsystem sections to trace concrete control flow from CLI invocation through local listeners, process ownership, tunnel publication, OAuth, MCP dispatch, tools, and shutdown.
3. Read the complete file ledger, generated source/export inventory, and test inventory to locate every implementation and verification boundary in the repository.
4. Read the embedded canonical documents to compare this synthesized description against the exact specification, plan, governance contract, operating guides, security guide, release rules, evidence records, and implementation chronology that governed the work.

The dossier is repository documentation only. It is deliberately excluded from the npm package allowlist. Its creation does not alter runtime behavior, public APIs, security policy, dependencies, or release eligibility.

## Executive summary

Loom is a foreground-only, single-owner remote Model Context Protocol server for macOS. Its core purpose is to let an authenticated ChatGPT MCP client operate the owner’s computer through seven deliberately broad tools while the owner has explicitly launched an unrestricted foreground session. The unrestricted mode is enabled only by the exact command `loom launch --yolo`, entered from a visible local terminal with a usable `/dev/tty`. Plain `loom launch` fails closed and starts no listeners. There is no daemon, launch agent, login item, hidden service, background cloud controller, command approval layer, path allowlist, PTY, browser extension, multi-user model, or automatic startup.

The seven public MCP tools are exactly:

- `loom_terminal`
- `loom_read`
- `loom_write`
- `loom_edit`
- `loom_skills`
- `loom_memory`
- `loom_browser`

The terminal and filesystem capabilities are intentionally powerful. `loom_terminal` executes unrestricted noninteractive shell commands as the current macOS user through one static `/bin/sh -lc` adapter. File reads can inspect supported text, binary, and image content. Writes and edits can mutate arbitrary paths available to that user, subject to strict path parsing, symlink rejection for mutations, size bounds, durable audit admission, optimistic conflict detection, serialization, and same-directory atomic replacement. The browser tool controls a dedicated persistent Chromium profile installed and verified by Loom; it never attaches to the owner’s normal Chrome profile.

The foreground process is the primary lifetime boundary. Loom owns terminal, Cloudflared, and Chromium process trees through a dedicated child-wrapper and process-group supervisor. It tracks PID, process-group ID, process start time, executable identity, launch identity, and canonical state location. Normal shutdown, Ctrl+C, SIGTERM, terminal closure, and parent death are designed to terminate Loom-owned descendants. Runtime state and locks are removed only when their file identity and serialized ownership state still match what Loom created. Uncertainty preserves ownership files and fails closed rather than deleting potentially replaced state.

Public access is provided through Cloudflare Tunnel. Quick Tunnel is temporary setup/testing only and can never be production certified. Named Tunnel is the production path and requires a stable HTTPS hostname, a private origin certificate, current exact-schema credentials, account and tunnel-name agreement, a registered connection, and no fallback to Quick Tunnel. The MCP listener and dashboard bind only to loopback ephemeral ports. `/mcp` remains deterministically `NOT_READY` until a canonical public HTTPS origin has been validated and endpoint-bound OAuth metadata is ready.

Authentication is a single-owner OAuth authorization-code flow protected by a persistent owner password. New owner verifiers use scrypt N=32768, r=8, p=3 with explicit memory bounds, and a successful authorization transparently upgrades the earlier N=16384, r=8, p=1 format. The password is generated once, stored only as a verifier, and reprinted only when first created or explicitly changed with `loom auth reset`. Public password authorization is limited to ten attempts per monotonic 60-second foreground-process window. OAuth clients, server-side authorization transactions, authorization codes, access tokens, and refresh tokens are bound to the exact canonical public `/mcp` resource and endpoint generation. Refresh tokens rotate on use but retain one absolute 30-day family expiration. Endpoint changes invalidate endpoint-bound OAuth state while preserving the owner password.

The repository has deterministic local coverage across process supervision, auditing, OAuth, MCP, file safety, catalogs, browser lifecycle, Cloudflared acquisition, Quick and Named tunnel managers, runtime orchestration, package boundaries, and certification logic. T15.3 completed typecheck, all `214/214` tests, build, a ten-run transient-EPERM stress check, package inspection, and an isolated installed-package smoke test. The hardened candidate remains 90 public files, is 194,258 bytes, and has SHA-256 `31c0f309a0bb94d3b974a852f0510282898ec5087c98f1229fe94c8203f1a491`.

Loom is not yet externally certified. G5, G6, T16’s external/manual portions, and G7 remain blocked until a human reviews real Named Tunnel routing, eligible ChatGPT custom-MCP support, OAuth authorization and refresh, representative calls to all seven tools, public-access termination, process tables for every required shutdown path, manual sleep/wake behavior, and connector persistence. T15.3 also established explicit residual risks: prompt injection from tool content, provider disclosure of returned data, persistent browser/memory state, login-shell secrets, localhost/LAN pivoting, macOS TCC, local-only containment, non-forensic audit, and deliberate process-session escape. The packaged `loom-certify` command is designed to remain blocked in the absence of human review and an independently checked artifact hash; it cannot establish its own integrity.

## Product, scope, and non-goals

### Intended operating model

Loom is operated by one macOS account owner on one machine. The owner launches it intentionally, sees a full-access warning, retains the foreground process, and authorizes a remote MCP client through the owner-password-gated OAuth page. The resulting authenticated client receives capabilities comparable to those of the local account because the terminal tool is unrestricted and file tools are not confined to a workspace.

The intended lifecycle is:

1. The owner installs the package and explicitly installs the pinned Chromium build with `loom setup browser` when browser support is desired.
2. The owner configures either a temporary Quick Tunnel or a stable Named Tunnel.
3. The owner runs `loom launch --yolo` in a visible local terminal.
4. Loom validates support, state, config, process ownership, browser state, Cloudflared, and tunnel credentials before publishing readiness.
5. Loom starts local loopback services, then a verified tunnel, then binds OAuth and `/mcp` to the exact public endpoint.
6. The owner authorizes ChatGPT or another compatible MCP client using the persistent owner password and PKCE OAuth flow.
7. The client invokes the seven tools while the local foreground process remains alive.
8. The owner ends access by stopping Loom. Loom tears down all owned processes and listeners before removing ownership files.

### Explicitly supported capability

- Unrestricted noninteractive command execution as the current macOS user.
- Text, supported image, and explicit binary file reads.
- Atomic text writes and exact text edits.
- Discovery and reading of configured skills.
- A Loom-owned persistent memory store.
- A dedicated persistent Chromium browser with tabs, navigation, snapshots, interactions, evaluation, screenshots, permissions, and geolocation.
- Local private audit records for mutations and selected lifecycle events.
- Quick Tunnel for temporary testing and Named Tunnel for the production path.
- OAuth dynamic client registration, authorization-code flow, S256 PKCE, rotating refresh tokens, access validation, revocation, and endpoint-generation invalidation.
- A loopback-only authenticated dashboard with a fixed action allowlist.
- A deterministic certification collector that reports local gate status and validates the structure and integrity of optional external artifacts without claiming those artifacts prove the events described.

### Explicit non-goals

Loom v1 does not provide:

- Windows or Linux support claims.
- A hidden daemon, `launchd` job, login item, persistent supervisor, or automatic startup.
- A cloud control plane or cloud-hosted command queue.
- Multi-user or organization-level authorization.
- A workspace sandbox, path allowlist, command allowlist, command classification, approval prompt, or policy engine.
- A PTY or usable stdin for terminal jobs.
- A browser extension, normal-Chrome attachment, or use of the owner’s normal browser profile.
- A database, vector database, plugin runtime, generic event bus, or speculative abstraction layer.
- Command replay, command undo, automatic password recovery, or remote update installation.
- A custom MCP UI beyond the local dashboard.
- Production certification from Quick Tunnel behavior.
- A claim that local audit logs are tamper-proof against the same macOS user who runs Loom.

### Security consequence of the scope

The absence of a command or path sandbox is deliberate. The authentication and local lifetime controls therefore carry more weight than they would in a restricted automation service. Sharing the owner password or authorizing an untrusted OAuth client is practically equivalent to granting that client the current macOS account. The exact warning printed by the runtime is:

> FULL COMPUTER ACCESS ENABLED — sharing the owner password or authorizing an untrusted client is equivalent to giving away this macOS account.

## Architecture and end-to-end control flow

### Component map

```text
Visible local terminal
  └─ loom launch --yolo
       ├─ support/config/state validation
       ├─ identity-bound runtime lock
       ├─ private AuditLogger
       ├─ ProcessManager
       │    └─ child-wrapper per managed process group
       │         ├─ unrestricted /bin/sh -lc terminal target
       │         ├─ verified cloudflared target
       │         └─ verified Chromium target
       ├─ AuthStore
       ├─ loopback LoomMcpHttpServer, initially NOT_READY
       ├─ loopback LoomDashboardServer
       ├─ SkillCatalogService
       ├─ MemoryStoreService
       ├─ FileToolService
       ├─ TerminalToolService
       ├─ BrowserToolService + ManagedChromiumBackend or unavailable backend
       ├─ QuickTunnelManager or NamedTunnelManager
       └─ RuntimeReadiness
            ├─ exact public HTTPS origin validation
            ├─ exact public /mcp resource binding
            └─ private runtime/current.json publication

Authenticated public client
  └─ Cloudflare Tunnel
       └─ loopback /mcp
            ├─ OAuth metadata and registration
            ├─ owner-password authorization transaction
            ├─ code + S256 PKCE exchange
            ├─ bearer access token
            ├─ client-bound MCP session
            └─ exactly seven tool schemas
                 └─ nested concrete dispatcher chain
```

### CLI to runtime assembly

`src/cli.ts` is the executable boundary. The npm bin `loom` points to `dist/src/cli.js`. The CLI recognizes only the documented commands. It obtains local confirmation and sensitive output through direct `/dev/tty` file-handle I/O rather than stdin, environment variables, or command-line secrets. `loom launch --yolo` checks the macOS and Node support floor and refuses before state creation when no controlling terminal is available.

The default runtime factory in `src/runtime.ts` performs the following assembly:

1. Resolve the state root, normally `~/.loom`.
2. Initialize private directories and validate the strict configuration.
3. Acquire the runtime lock before creating publicly relevant components.
4. Create the audit logger and process manager.
5. Open the persistent OAuth/owner-credential store.
6. Create terminal, skills, memory, file, and browser services.
7. Compose one dispatcher chain in this order: terminal, files, skills, memory, browser, then an unreachable fallback.
8. Construct the MCP server with the AuthStore and concrete dispatcher.
9. Construct the configured tunnel lifecycle, with no Named-to-Quick fallback.
10. Construct the dashboard with six fixed actions.
11. Return the foreground runtime and the owner password only when the AuthStore created it for the first time.

The factory’s test seams are narrow: explicit browser, tunnel, and skill-root overrides. It does not expose a generic dependency-injection container.

### Runtime startup sequence

The actual `ForegroundLoomRuntime` sequence is ordered so that public capability appears only after local prerequisites are ready:

1. Set phase to `starting`.
2. Acquire or confirm exclusive identity-bound runtime ownership.
3. Start the MCP listener on loopback. The route is still `NOT_READY`.
4. Persist the private not-ready runtime snapshot.
5. Start the loopback dashboard.
6. Rescan skills and publish an immutable catalog generation.
7. Rescan Loom-owned memory and publish an immutable memory generation.
8. Start the verified dedicated browser, or mark browser support unavailable without disabling the other tools.
9. Start the configured tunnel lifecycle.
10. Validate the returned public origin as a bare canonical HTTPS origin.
11. Derive the exact public resource by appending `/mcp`.
12. Validate the runtime-state target before changing MCP endpoint state.
13. Bind MCP/OAuth to the exact public resource.
14. Atomically publish the ready runtime snapshot.
15. Mark connector readiness and production eligibility. Only a ready Named Tunnel is production-eligible.
16. Print one secret-free status block.
17. Generate a single-use local dashboard bootstrap URL and request `/usr/bin/open`; local-open failure is nonfatal.
18. Remain in the foreground until stopped.

A lifecycle generation counter is checked after each asynchronous startup operation. If stop is requested during tunnel startup or any earlier phase, later startup work cannot publish stale readiness or recreate stopped processes.

### Runtime shutdown sequence

Shutdown is idempotent and shared by explicit stop, dashboard stop, SIGINT, SIGTERM, and startup failure:

1. Change phase to `stopping` and record the reason.
2. Stop accepting new terminal jobs.
3. Shut down every retained terminal job and complete owned process group.
4. Close the managed browser. Normal browser closure uses CDP `Browser.close`; process-group cancellation is fallback.
5. Stop the tunnel manager and its Cloudflared group.
6. Close MCP sessions and the MCP listener.
7. Close the dashboard listener.
8. Ask ProcessManager to drain any remaining owned jobs.
9. Close the audit logger.
10. Verify ProcessManager owns zero active jobs.
11. Verify `runtime/current.json` is still the same private regular file with the exact serialized snapshot Loom wrote, then remove it.
12. Verify `runtime/loom.lock` still contains the exact acquiring identity and that the current process still matches PID, start time, and executable, then remove it.
13. Mark the runtime stopped.

Every cleanup operation shares one absolute shutdown deadline. Timeout, identity replacement, file replacement, process residue, or other uncertainty records a failure and preserves ownership state. This favors an explicit stale lock requiring recovery over silently declaring cleanup complete.

## Security model and trust boundaries

### Primary trust boundaries

1. **Local human opt-in:** Only the exact `loom launch --yolo` path enables unrestricted access, and it requires a local `/dev/tty`.
2. **Foreground lifetime:** Public access should exist only while the visible local process owns the runtime.
3. **Owner credential:** The persistent owner password gates OAuth authorization. It is a high-value secret equivalent to local-account access during an active Loom runtime.
4. **OAuth endpoint binding:** Clients and tokens are bound to the exact canonical public `/mcp` resource and endpoint generation.
5. **Loopback services:** MCP and dashboard listeners bind to loopback ephemeral ports, not public interfaces.
6. **Cloudflare edge:** Cloudflare forwards to an ephemeral local origin but does not receive or validate the owner password.
7. **Managed process identity:** Loom-owned process trees are controlled by process group plus PID/start-time/executable identity, not PID alone.
8. **Local state identity:** Sensitive state must be a current-user private regular file or directory with stable identity and no unsafe symlink traversal.
9. **Audit admission:** Mutating operations require a durable audit-start record within a fixed deadline. Failure blocks mutation.
10. **Human certification review:** Automated artifact checks cannot assert that real external actions happened.

### Threats the design directly addresses

- Accidental launch of unrestricted capability through a benign default command.
- An environment-variable or config bypass that enables YOLO mode.
- OAuth parameter substitution at the password POST.
- Authorization-code replay, refresh-token replay, scope expansion, wrong audience, wrong resource, and stale endpoint tokens.
- Public MCP availability before endpoint-bound OAuth metadata is ready.
- Session reuse by a different OAuth client.
- Symlink traversal during file mutations, state writes, browser installation, Cloudflared installation, and evidence/report writes.
- Lost updates from concurrent writers and stale edit clients.
- PID reuse and stale lock confusion.
- Child and grandchild process residue after cancellation, timeout, target exit, parent death, or signal escalation.
- Fast target exit before the wrapper readiness handshake reaches the parent.
- Transient negative-PGID `EPERM` during escalation.
- Untrusted Cloudflared binaries, release downloads, versions, archive bytes, or symlinked PATH entries.
- Cloudflare credential/config mismatch and accidental Named-to-Quick fallback.
- Quick Tunnel URL parser confusion or unsafe candidate URLs.
- Chromium/profile lock confusion and attachment to an unrelated browser process.
- Audit leakage of command text, file content, environment values, tokens, page text, screenshots, and typed browser data.
- Dashboard bootstrap replay, cross-site requests, hostile Host headers, and unrestricted action dispatch.
- A self-authored certification manifest granting itself release approval.

### Threats explicitly outside the guarantee

- A malicious or compromised process running as the same macOS user can modify Loom’s local files, logs, package, or runtime environment. The audit system is not tamper-proof against that user.
- An authorized MCP client is intentionally powerful and can use terminal or file tools to access secrets available to the account.
- The owner password cannot make an untrusted authorized client safe.
- Cloudflare, DNS, ChatGPT account eligibility, connector storage, and network behavior are external systems that deterministic repository tests cannot fully prove.
- Unexpected operating-system behavior across sleep/wake or terminal-host termination must be manually exercised for certification.
- Quick Tunnel hostname persistence and stale-subdomain behavior are not production guarantees.
- Loom v1 does not claim containment against kernel compromise, root, malicious endpoint security software, or a hostile administrator.

### Fail-closed versus fail-open decisions

Loom fails closed for unrestricted launch authorization, support checks, config parsing, private state ownership, mutating audit admission, public endpoint binding, OAuth token validation, Named Tunnel authentication, managed executable verification, package certification, and uncertain cleanup. Read-only audit recording is best effort so that audit degradation does not prevent reads or polling an already running terminal job. Browser absence degrades only the browser tool; it does not disable the other six tools. Failure to open the local dashboard automatically is nonfatal because the dashboard URL remains local and the runtime is already ready.

## State layout, ownership, and atomicity

The default state root is `~/.loom/`. The implemented layout is:

```text
~/.loom/
  auth.json
  config.json
  audit/
    YYYY-MM-DD.jsonl
  browser/
    loom-browser.json
    chromium-1228/
  browser-profile/
  cloudflared/
    cloudflared
  downloads/
    screenshots/
  memory/
  runtime/
    browser.lock
    current.json
    loom.lock
```

Directories are created or repaired to mode `0700` when safely owned by the current user. Sensitive files are created as `0600`. Existing symbolic-link roots, wrong ownership, unsafe file kinds, and unsafe permissions fail closed when they cannot be safely repaired.

`src/paths.ts` accepts only absolute paths or `~/...`. It rejects bare relative paths, alternate-user home syntax, NUL bytes, malformed UTF-16 surrogate sequences, and empty input. Mutating paths are walked with `lstat`; every existing symbolic-link component is rejected. Terminal working directories are different: the user input must still be absolute or home-relative, but the directory is canonicalized with `realpath`, so a safe directory reached through a normal symlink is accepted.

`src/atomic-file.ts` implements same-directory atomic replacement. It serializes by canonical target path, checks the approved size limit, verifies existing target identity and regular-file type, optionally verifies an expected SHA-256, creates an exclusive random temporary file with restrictive mode, writes and syncs it, rechecks target identity immediately before rename, renames atomically, syncs the parent directory, and removes uncommitted temporary files on failure. Existing file mode is preserved; new files default to `0600`.

Runtime ownership files receive additional checks. `runtime/current.json` is removed only if the open file, post-read file, and pathname identity agree and the bytes exactly match the immutable state Loom last wrote. Runtime and browser locks contain PID, process start time, canonical executable, launch ID, and canonical state/profile path. Live ownership requires all fields to agree with a fresh process-table observation.

## CLI and local-owner interaction

The supported CLI surface is:

- `loom launch`
- `loom launch --yolo`
- `loom setup browser`
- `loom auth reset`
- `loom config check`
- `loom config reset`
- `loom --version`
- `loom --help`
- `loom-certify --output <report.json> [--external <evidence.json>]`

Plain `loom launch` exits nonzero and instructs the owner to use the explicit YOLO command. It does not initialize state or start listeners.

`loom launch --yolo` enforces macOS 14+, Node.js 22+, and direct local terminal ownership. The warning and newly created owner password are written only to the local terminal. The CLI then runs the foreground runtime and signal handlers.

`loom setup browser` is the only browser-install path. npm installation and `npm ci` do not download Chromium. The command initializes the private browser directory, invokes the locally installed Playwright Core CLI independently of caller working directory, forces the official Playwright CDN, verifies the pinned architecture-specific executable, proves a real wrapper-owned loopback CDP launch, and writes a private manifest atomically.

`loom auth reset` refuses when a live runtime lock matches the process table. It requires local confirmation by typing the required value on `/dev/tty`, rechecks runtime ownership after confirmation, rotates only the owner credential, revokes all OAuth state, and prints the new password only to the terminal.

`loom config check` parses and validates without writing or changing timestamps. `loom config reset` requires local confirmation, preserves invalid original bytes in a timestamped private backup, and writes strict defaults atomically.

## Process supervision, output, and watchdog behavior

### Child-wrapper protocol

Every terminal, Cloudflared, and Chromium target is launched through `src/child-wrapper.ts`. The wrapper is the leader of a dedicated detached process group. It receives the target executable, explicit argument vector, cwd, environment, and timeout-related launch data over Node IPC rather than command-line serialization. The target receives ignored stdin and separately piped stdout and stderr.

The wrapper sends a `ready` message only after the target is launched and process ownership is established. The readiness message is flushed before any rapid target `exit` message or IPC disconnect. Startup errors are also flushed before disconnect. Duplicate finish paths are suppressed. The wrapper receives monotonic heartbeats from the parent and independently observes the parent’s identity. Its bounded `ps`/`lsof` identity probes are serialized so fallback intervals cannot overlap. A confirmed mismatch terminates the complete process group; temporary inspection failure does not kill a healthy-heartbeat parent, while stale heartbeats plus unavailable identity still fail closed.

### ProcessManager

`src/process-manager.ts` starts the detached wrapper, observes the wrapper/target handshake, records process metadata, streams output, applies timeouts, and owns cancellation. It preserves target exit events that arrive between readiness and managed-object construction. If the wrapper exits before readiness, startup rejects immediately rather than waiting for a generic startup timeout.

Cancellation and timeout signal the negative process-group ID. Loom first sends SIGTERM, waits within the five-second soft grace, then sends SIGKILL if members remain. `ESRCH` means the group is already gone. A negative-PGID `EPERM` is not blindly retried: Loom revalidates the wrapper’s PID, start time, canonical executable, and current group membership, then retries only inside the existing absolute deadline. Persistent `EPERM` fails closed.

The process manager exposes an active count used by runtime shutdown. Runtime ownership files are not removed while any managed group remains. This ownership model covers ordinary descendants that stay in the inherited process group. A deliberately unrestricted command can call `setsid()` or create a new session and escape; a controlled T15.3 experiment confirmed such a process survives group cancellation, so Loom does not claim cleanup of intentional daemon escape.

### Watchdog identity

`src/watchdog.ts` uses macOS `ps` for PID, PPID, PGID, and start time, and `lsof` for canonical executable resolution. Every probe uses a fixed C locale, bounded output, and a two-second SIGKILL timeout. Identity comparisons require PID, start time, and executable path. The code also lists current process-group members. PID-only liveness is never accepted as ownership proof.

### Bounded output

`src/output.ts` combines separately piped stdout and stderr into one ordered sequence. It strips ANSI escapes and unsafe controls. Invalid UTF-8 or NUL-bearing chunks become a deterministic binary-suppression marker rather than arbitrary decoded output. The store keeps a UTF-8-safe bounded head and tail, total byte counts, first available cursor, next cursor, truncation state, and process lifecycle state.

Polling returns the requested cursor, available-from cursor, next cursor, and an explicit gap flag. This makes lost output visible when an old cursor falls before retained output. Public terminal results place command output only in MCP content. Structured metadata contains lifecycle, cursor, byte-count, process-group, and exit fields without command, cwd, environment, or output text.

## Audit subsystem

`src/audit.ts` writes private JSON Lines records under `~/.loom/audit/YYYY-MM-DD.jsonl`. The audit directory is `0700`; files are `0600`. Mutating operations call `recordMutationStart` before performing the mutation. That promise resolves only after the record is written and synced. The admission deadline is 2,000 milliseconds.

The logger uses a bounded serialized queue. Saturation, admission deadline expiry, or durable write failure marks the logger degraded. Subsequent capability-increasing mutations that require audit are rejected. Read audit is explicitly nonthrowing so read-only tools and polling can remain available. Terminal cancellation and browser-tab closure remain available with best-effort audit because they reduce active capability and are containment actions.

Start and finish records use an operation ID, timestamp, operation name, status, and measured duration. Rotation occurs at 50 MiB inside the same serialization boundary so concurrent writes cannot corrupt JSONL. Startup retention removes only date-named audit files older than 30 days.

Metadata is recursively bounded and sanitized. The logger does not persist command text, output, cwd, environment names or values, authorization headers, cookies, tokens, owner passwords, file contents, browser typed values, selectors, page text, expressions, screenshots, or values that resemble secrets. The audit is useful for coarse local activity tracing, but it is neither forensic nor tamper-evident against the same account or an authorized remote shell client.

## OAuth, MCP transport, and session lifecycle

### Owner credential and AuthStore

`src/oauth.ts` stores one strict versioned `auth.json` through the atomic-file primitive. On first open it generates a high-entropy owner password, a fresh salt, and a Node `crypto.scrypt` verifier using N=32768, r=8, p=3 with explicit memory bounds. A successful authorization upgrades the legacy N=16384, r=8, p=1 verifier atomically. The plaintext password is returned to the local caller only at creation time. Reopening the store does not rotate or reveal it.

OAuth client secrets, authorization codes, access tokens, and refresh tokens are persisted only as SHA-256 hashes. The store uses optimistic cross-process conflict detection so concurrent state writers cannot silently overwrite each other.

### Endpoint generation

The canonical resource is the exact public HTTPS URL ending `/mcp`. Binding a new endpoint compares it to the persisted endpoint. Rebinding the same stable endpoint preserves endpoint generation, clients, tokens, and owner password. Changing the endpoint increments the generation and clears clients, pending transactions, codes, access tokens, and refresh tokens. The owner password is preserved.

This is important for Quick Tunnel, where URLs normally change, and for an explicit Named Tunnel hostname change. A restart using the same Named hostname should preserve the generation.

### Authorization flow

1. A client dynamically registers exact redirect URIs.
2. The authorization GET validates client, redirect, resource, scope, endpoint generation, and mandatory S256 PKCE.
3. The server creates a short-lived random authorization transaction containing those validated values and the client’s state.
4. The browser authorization form contains only the transaction identifier. The password POST accepts only transaction ID, owner password, and decision.
5. The server atomically consumes the stored transaction. Client, redirect, resource, scope, state, endpoint generation, and PKCE values cannot be substituted in the POST.
6. A successful decision creates a single-use five-minute authorization code.
7. The token endpoint validates client, redirect, resource, code, endpoint generation, and PKCE verifier.
8. The code exchange returns a fifteen-minute access token and a refresh token belonging to one absolute thirty-day family.
9. Refresh rotates both access and refresh tokens. Reuse of the old refresh token fails. Resource, client, and scope cannot change or expand, and rotation cannot extend the family deadline.
10. The public password POST is limited to ten attempts per monotonic sixty-second foreground-process window. This is not distributed edge protection and can be consumed as an availability attack.
11. Protocol revocation invalidates an individual client token; dashboard revoke-all increments generation and clears all OAuth state while preserving endpoint and owner credential.

The authorization page sends no-store, no-sniff, no-referrer, strict CSP, `frame-ancestors 'none'`, and `X-Frame-Options: DENY` headers.

### MCP HTTP server

`src/mcp.ts` binds Express only to `127.0.0.1` on an ephemeral port and preserves the pinned SDK's localhost Host-header validation. Before public binding, `/mcp` returns a structured `NOT_READY` response and does not advertise incomplete OAuth metadata. MCP JSON is capped at 9 MiB before SDK parsing; OAuth metadata JSON/forms are capped at 64 KiB. Oversized MCP input receives a structured 413. After binding, the server publishes path-correct protected-resource metadata and authorization-server metadata, and unauthenticated `/mcp` requests receive a bearer challenge pointing to the public metadata URL.

The server uses the pinned MCP SDK’s stateful Streamable HTTP transport. Session identifiers are validated, associated with the OAuth client that initialized them, counted before transport creation to avoid concurrent capacity races, protected from inactivity reaping while requests are active, closed after bounded inactivity, and closed on server shutdown or endpoint-generation change. Missing, malformed, unknown, cross-client, or over-capacity sessions return structured errors.

The server registers exactly seven tools through `src/tools/register.ts`. Public input schemas are strict Zod v4 schemas. Unknown fields and malformed action-specific combinations fail before concrete handlers run.

## Public tool contracts and implementation

### `loom_terminal`

Implemented by `src/tools/terminal.ts`.

Actions are `start`, `poll`, and `cancel`. A start request accepts a command, optional absolute-or-home cwd, optional environment overrides, and timeout within centralized bounds. The service validates command bytes, environment entry count, key grammar, key/value bytes, aggregate environment bytes, cwd, and timeout before audit or process launch.

There is one execution adapter:

```text
ProcessManager.start({
  executable: '/bin/sh',
  args: ['-lc', command],
  cwd,
  env,
  timeoutMs
})
```

No reflection, alternate method probing, PTY, or usable stdin exists. Jobs receive cryptographic `job_<uuid>` identifiers. Polling supports bounded cursor output and up to 60 seconds of wait. Public states are running, exited, cancelled, and timed-out. Start requires durable audit admission. Polling and cancellation remain available after audit degradation because cancellation reduces active capability.

The service retains at most 128 jobs. It never evicts a running job. When full, it awaits process and audit completion before evicting the oldest finished job. If every retained job is running, new starts fail with a typed capacity error. Service shutdown cancels all running groups, including grandchildren.

### `loom_read`

Implemented by `src/tools/files.ts`.

The read path accepts only absolute or `~/...` input. On macOS, exact `/tmp` and `/var` aliases are canonicalized to `/private/tmp` and `/private/var`; other parent symlinks are rejected. A final symlink is allowed only for reads and only after resolving the canonical target, opening it nonblocking without following another final symlink, requiring a regular file, reading a stable snapshot, and rechecking both the original pathname identity and canonical target identity. The nonblocking open prevents a swapped FIFO or device from hanging the server before type verification.

Text decoding is deterministic and reports ranges and truncation. The complete stable file receives a SHA-256 even for ranged reads so clients can use the hash for later optimistic mutation. PNG, JPEG, GIF, and WebP are detected from magic bytes rather than extension and returned as MCP image content when within the fixed limit. Unsupported binary input is rejected unless explicit base64 behavior is requested.

### `loom_write`

Implemented by `src/tools/files.ts` and `src/atomic-file.ts`.

Input includes path, content, optional parent creation, and optional expected SHA-256. Content is limited to 8 MiB. Every existing symlink component is rejected. The operation obtains a durable audit-start receipt before mutation, serializes on canonical path, checks the expected hash and current identity, then uses same-directory atomic replacement. New files are private; existing regular-file mode is preserved.

### `loom_edit`

Implemented by `src/tools/files.ts` and `src/atomic-file.ts`.

Input includes path, nonempty `oldText`, `newText`, optional explicit `replaceAll`, and optional expected SHA-256. The editable window is limited to 256 KiB. Matching is exact. Without `replaceAll`, exactly one occurrence is required. The operation applies the same audit, symlink, serialization, conflict, identity, and atomicity guarantees as write.

### `loom_skills`

Implemented by `src/tools/skills.ts`.

Actions are list, search, read, and rescan. Default roots are `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, and `~/.gemini/skills`, plus strict configured extra roots. Namespaces and canonical paths are deduplicated.

The scanner uses asynchronous filesystem operations, bounded concurrency, a 12-level depth limit, 10,000 files per root, 1 MiB per file, 64 MiB aggregate indexed bytes, and a 10-second budget. It does not follow directory symlinks and skips file symlinks. It builds a candidate generation separately and publishes it atomically only after a successful scan, leaving the prior immutable generation available during work or after a hard failure.

Stable IDs include namespace and path identity. Search ranking is deterministic. Duplicate names remain distinguishable. A `SKILL.md` beginning YAML frontmatter without a closing delimiter is skipped with a deterministic `malformed_frontmatter_skipped` diagnostic and is not partially indexed.

### `loom_memory`

Implemented by `src/tools/memory.ts`.

Actions are list, search, read, save, delete, and rescan. Mutable memory exists only under `~/.loom/memory/` and is addressed through Loom-owned stable IDs, never arbitrary user paths. Saves and deletes are serialized and require durable audit admission. Saves use private atomic files. Deletes use a tombstone protocol so the visible item disappears atomically and interrupted committed deletes can be recovered.

Initialization and rescan recognize only exact Loom tombstone names. A stale tombstone is removed only after containment, regular-file type, current-user ownership, restrictive permission, and symlink checks. Unsafe tombstones remain in place with diagnostics. Candidate scans respect file and aggregate limits and never replace the published generation with partial state.

Search is deterministic and gives title matches greater weight than content-only matches. Audit records omit title and content.

### `loom_browser`

The public policy boundary is `src/tools/browser.ts`; the backend is `src/browser/backend.ts`; installation is `src/browser/setup.ts`; shared contracts and typed errors are in `src/browser.ts`.

Actions are status, tabs, open, navigate, snapshot, click, type, evaluate, screenshot, close, grant_permissions, clear_permissions, and set_geolocation. Navigation accepts `https`, `http`, and `about:blank`. It rejects `file:`, `javascript:`, direct `data:`, unsupported schemes, invalid origins, malformed tab identifiers, unsupported permissions, and excessive output bounds before backend calls.

Browser mutations and persisted artifacts require durable audit admission. Audit records do not contain URL queries, selectors, text, expressions, page content, or screenshot bytes. Read results place content in MCP content rather than structured metadata.

The backend launches only the verified Chromium executable with an explicit argument vector through ProcessManager. It uses a dedicated profile at `~/.loom/browser-profile/`, loopback ephemeral CDP, stable page identifiers, and a maximum of 12 tabs. It never attaches to normal Chrome.

Snapshots and public evaluation share bounded evaluation infrastructure. On timeout, Loom marks only the page unhealthy, attempts `page.close({ runBeforeUnload: false })`, and verifies another tab remains usable. It restarts the entire browser only when page cleanup fails or CDP health is lost.

Downloads are persisted privately without overwrite. Screenshots use human-sortable collision-safe names composed from UTC time, tab identity, monotonic counter, and random suffix. Normal shutdown sends CDP `Browser.close` so profile storage flushes, waits for natural wrapper-owned process exit within the soft grace, then cancels the process group only as fallback.

## Browser installation and persistence

Pinned browser metadata is:

- Playwright Core: `1.61.1`
- Chromium revision: `1228`
- Chromium version: `149.0.7827.55`
- macOS arm64 executable SHA-256: `b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7`
- Official arm64 archive SHA-256 observed during real setup: `311211b54c429245e2cec0314ee1e314085e9c00350215b95e1a879350786630`

Architecture-specific descriptors in `src/browser/setup.ts` also cover x64. Setup resolves the installed Playwright CLI through the package location, not caller cwd. It forces the official CDN instead of inheriting a caller download-host override. It installs into a private staging location, locates the expected revision, verifies stable executable identity and exact hash, starts the browser through the wrapper, waits for a safe `DevToolsActivePort`, validates loopback CDP `/json/version`, and promotes the staged installation atomically. A failed promoted verification restores the prior installation.

The private manifest records schema version, Playwright version, Chromium revision/version, architecture, archive URL/hash, executable path/hash, and installation time. Runtime refuses an invalid present manifest. A missing or recognized corrupt manifest produces browser-unavailable mode while preserving the other six tools.

Real local evidence recorded during T9 and subsequent clean-HOME work showed localStorage persisted across two controlled restarts and no browser process or lock remained after shutdown. That evidence proves the exercised local environment, not ChatGPT or full T16 external certification.

## Cloudflared acquisition and tunnel lifecycle

### Managed Cloudflared

The managed version is `2026.7.0`. `src/cloudflare.ts` contains architecture-specific official GitHub HTTPS release URLs, exact archive byte counts, archive SHA-256 values, and extracted executable SHA-256 values for macOS arm64 and x64.

Observed pinned executable hashes are:

- arm64: `cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04`
- x64: `c0c65579c6f11b1381cf5ffd1614f5094bf140e18938eae4ad16931da9f69499`

Downloads follow credential-free HTTPS with manual redirects capped at five and a 30-minute total deadline. The installer streams into a private exclusive staging file, validates optional `Content-Length`, exact bytes, and exact archive hash, extracts through `/usr/bin/tar` only when the archive contains the expected single `cloudflared` file, verifies ownership/mode/stable identity/executable hash/version, and atomically promotes it. Failure removes staging residue and leaves any previous binary unchanged.

A PATH binary is accepted only as the first match. A normal symlink is canonicalized, but the resolved target must be a current-user regular executable with the exact expected hash and version and stable identity. Loom does not silently skip an unknown first match.

Every Cloudflared launch is direct ProcessManager executable-plus-array invocation. The fixed prefix is equivalent to:

```text
cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:0
```

Caller tunnel arguments are appended only after reserved-option rejection. Shell construction and routing through `loom_terminal` are forbidden.

### Quick Tunnel

Quick mode checks `~/.cloudflared` before audit or launch. Existing or unsafe `config.yaml` or `config.yml` causes refusal. The manager tunnels only the exact bare loopback MCP origin.

Output accumulation is bounded to 256 KiB. The parser accepts only a whitespace- or end-delimited origin matching one valid DNS label beneath `trycloudflare.com`. Paths, ports, multiple prefix labels, malformed labels, and concatenated text are rejected. Readiness requires both a valid public origin and a registered connection within 15 seconds.

A transient process-start failure, early exit, or readiness timeout permits exactly one complete cleanup and recreation. An unsafe candidate URL fails immediately without retry. Quick status always has `production: false`. URL changes are passed through endpoint binding, invalidating OAuth state while preserving the owner password. Audit logs contain only mode/retry lifecycle metadata, not URL or Cloudflared output.

### Named Tunnel

Named mode requires a nonempty non-option-like tunnel name no longer than 128 characters and a canonical stable DNS hostname outside `trycloudflare.com`. Hostnames are lowercased for validation; surrounding whitespace and control characters are rejected.

Before audit or launch, Loom opens the origin certificate and credentials through stable current-user private regular-file handles with no symlink components. It rejects group/other access, executable/special mode bits, empty/oversized files, identity changes, malformed PEM/JSON/base64, unexpected fields, invalid UUID/secret length, account mismatch, and tunnel-name mismatch.

Current credentials must contain exactly:

- `AccountTag`
- `TunnelSecret`
- `TunnelID`
- `TunnelName`

The explicit launch is equivalent to:

```text
cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:0 \
  --origincert <private-cert-path> \
  run --url http://127.0.0.1:<ephemeral-mcp-port> \
  --credentials-file <private-credentials-path> \
  <configured-tunnel-name>
```

Status withholds the public endpoint and production eligibility until a registered connection appears within 15 seconds. A benign missing persistent-config notice is not treated as failure because Loom intentionally uses the explicit ephemeral `--url` origin. Static validation, audit failure, authentication errors, config errors, cleanup uncertainty, and stop-during-startup fail immediately. Only transient spawn, edge, and readiness failures retry. Authentication files are revalidated before each attempt. There are at most five attempts, with one-second exponential backoff capped at 60 seconds and complete cleanup between attempts. Stop aborts readiness and backoff and prevents recreation. There is no Quick fallback.

Restarting the same canonical hostname preserves endpoint generation and owner password. Changing the hostname invalidates endpoint-bound OAuth state without rotating the owner password.

## Dashboard

`src/dashboard.ts` serves `public/dashboard.html`, `public/dashboard.css`, and `public/dashboard.js` only on loopback. It generates a 256-bit random bootstrap nonce with a five-second TTL and single use. A successful bootstrap exchanges the nonce for a bounded session cookie marked HttpOnly and SameSite=Strict. Every page and API requires the session. Mutations also require the exact local Origin and a per-session `X-Loom-CSRF` token.

The server validates exact Host and Origin, provides no permissive CORS, and sends a self-only CSP, frame denial, no-store, no-sniff, no-referrer, and restrictive Permissions-Policy. Status is recursively redacted before serialization. The static client renders values with `textContent` and never evaluates returned HTML.

There is no generic command endpoint. The fixed actions are:

1. Rescan skills and memory catalogs.
2. Restart the browser under an audit record.
3. Reveal the local audit directory through direct `/usr/bin/open` under an audit record.
4. Validate and atomically replace next-launch config under an audit record.
5. Revoke all OAuth state while preserving owner password and endpoint under an audit record.
6. Stop the runtime.

The dashboard does not display the owner password, commands, environment data, file contents, OAuth tokens, authorization headers, browser expressions, typed values, page text, or screenshot bytes.

## Limits and bounded-resource policy

`src/limits.ts` is the single source of truth for 36 limits. Key values are:

| Area | Limit |
|---|---:|
| Write content | 8 MiB |
| Editable window | 256 KiB |
| Terminal command | 65,536 bytes |
| Terminal environment entries | 256 |
| Terminal environment key | 256 bytes |
| Terminal environment value | 65,536 bytes |
| Terminal total environment | 1 MiB |
| Terminal timeout | 24 hours |
| Terminal poll output | 1 MiB maximum, 64 KiB default |
| Terminal synchronous wait | 60 seconds |
| Retained terminal jobs | 128 |
| Files per catalog root | 10,000 |
| Catalog file size | 1 MiB |
| Catalog aggregate bytes | 64 MiB |
| Catalog depth | 12 |
| Catalog scan budget | 10 seconds |
| Browser tabs | 12 |
| Browser snapshot | 128 KiB |
| Screenshot | 2 MiB |
| Audit file rotation | 50 MiB |
| Audit retention | 30 days |
| Mutation audit admission | 2 seconds |
| Quick URL readiness | 15 seconds |
| Named readiness | 15 seconds |
| Named attempts | 5 |
| Named backoff | 1 second base, 60 seconds cap |
| Watchdog heartbeat | 1 second |
| Missed-heartbeat threshold | 3 |
| Process-table fallback | 2 seconds |
| Soft shutdown grace | 5 seconds |
| Absolute shutdown deadline | 15 seconds |
| Dashboard bootstrap TTL | 5 seconds |

Boundary tests import the production constants rather than duplicating values in a second runtime implementation.

## Dependencies, build, and package surface

The repository uses ESM and strict NodeNext TypeScript. Runtime dependencies are exact pins:

- `@modelcontextprotocol/sdk` `1.29.0`
- `express` `5.2.1`
- `playwright-core` `1.61.1`
- `zod` `4.4.3`

Development dependencies are exact pins:

- `typescript` `6.0.3`
- `@types/node` `26.1.0`
- `@types/express` `5.0.6`

The lockfile fixes the complete npm graph. The package declares Node `>=22`, MIT licensing, ESM, and two executable bins. It remains marked `private: true`; no npm publication has occurred.

Build scripts are intentionally simple:

```text
npm run clean      -> rm -rf dist
npm run build      -> clean, then tsc
npm run typecheck  -> tsc --noEmit
npm test           -> build, then Node test runner over dist/test/**/*.test.js
npm run prepack    -> build
npm run certify    -> build, then certification CLI
```

The explicit npm files allowlist includes compiled runtime source, public dashboard assets, README, license, notice, operator/security/development/release-certification guides, and the sanitized certification-evidence example. It excludes TypeScript source tests, compiled tests, internal plans, committed release evidence, dependencies, VCS files, and this repository-only audit dossier.

The current hardened T15.3 candidate tarball has:

- Name: `loom-mcp-0.1.0.tgz`
- Files: 90
- Bytes: 194,258
- SHA-256: `31c0f309a0bb94d3b974a852f0510282898ec5087c98f1229fe94c8203f1a491`
- Installed `loom --version`: `0.1.0`
- Installed `loom --help`: pass
- Installed `loom-certify --help`: pass
- Plain launch: exit 2
- Sessionless YOLO launch: exit 2
- State created by failed sessionless launch: no
- Published: no

## Certification model

`src/certification.ts` and `src/certification-cli.ts` separate deterministic repository checks from real external evidence.

The collector can execute and summarize exact-commit typecheck, test, build, documentation, map, package, and process-residue checks. It parses npm pack dry-run output and rejects missing public assets and forbidden private/development paths. It scans for Loom-owned wrapper/runtime/terminal, managed Cloudflared, and dedicated browser-profile residue. Reports are canonical private JSON and reject unsafe or symlinked output paths.

An optional external-evidence manifest has a strict schema and must match the release SHA, exact seven-tool set, stable endpoint form, and pinned managed-component metadata. Referenced artifacts must be stable private regular files with matching hashes. These checks establish only that the manifest is well formed and that the files have not changed.

They **do not prove** that a Named Tunnel connected, ChatGPT was eligible, OAuth completed, refresh/reconnect worked, tools were called, public access stopped, process cleanup occurred, a clean host was used, sleep/wake succeeded, or a connector remained installed. Those are events and observations requiring human review of real sanitized evidence. Even a valid external manifest leaves G5, G6, and G7 blocked. Quick Tunnel evidence is optional and never certifying.

CLI exit semantics are:

- Exit code 0 only when all deterministic checks and the required human-reviewed release state are represented by an approved process. The current automated implementation does not independently grant that state.
- Exit code 1 for deterministic failure or invalid evidence.
- Exit code 2 when deterministic work is acceptable but external gates remain blocked.

## Implementation plan and chronology

The canonical implementation plan is embedded verbatim later in this file. The following chronology explains how it was executed and where amendments were introduced.

### G0 and T0: governance and bootstrap

A fresh repository and branch were created with Cavekit governance documents, exact dependency pins, lockfile, strict TypeScript config, and the minimum CLI. G0 required the repository map to match the tracked tree before production work. T0 established version/help and fail-closed plain launch. G1 proved clean npm installation, typecheck, tests, and build without browser download.

### T1: paths, atomic files, state, config, and locks

Central limits, strict path parsing, mutating symlink rejection, atomic replacement, private state initialization, config check/reset, invalid-config preservation, and exact runtime-lock identity were added. Real filesystem and PTY tests exposed macOS `/var` canonicalization and direct `/dev/tty` behavior.

### T2 and G2: process ownership and output

Bounded terminal output, child wrapper, detached process groups, watchdog observation, heartbeat/fallback monitoring, cancellation, timeout, hard-kill escalation, and parent-death cleanup were implemented with real local processes and residue scans.

### T3: audit

Private durable JSONL audit, queue admission, deadline, mutation fail-closed behavior, redaction, rotation, and retention were implemented and tested under saturation, timeout, removed-directory failure, concurrent rotation, and secret-literal checks.

### T4: OAuth state

Persistent owner credential, scrypt verification, endpoint generations, clients, authorization transactions, codes, access/refresh tokens, rotation, expiry, revocation, and local-terminal reset were implemented. A direct file-handle TTY approach replaced an initial stream abstraction that could hang.

### T5 and G3: MCP and authorization recovery

Loopback Streamable HTTP MCP, NOT_READY behavior, OAuth HTTP routes, metadata, bearer challenges, sessions, capacity control, and exactly seven schemas were implemented. Adversarial review then replaced client-parameter replay at the password POST with server-side transactions, added frame denial, normalized an SDK metadata type boundary, and strengthened task governance.

### T6: file tools

Stable reads, magic-byte images, explicit binary behavior, atomic writes, exact edits, audit integration, conflicts, and concurrency were implemented. The final-symlink read policy was corrected to allow only a stable resolved final target while preserving strict mutation rejection.

### T7: skills and memory

Bounded deterministic skill discovery, stable IDs, malformed frontmatter handling, immutable generation publication, Loom-owned memory, deterministic search, safe deletes, tombstones, and recovery diagnostics were implemented.

### T8: dashboard

Loopback dashboard, one-time bootstrap, bounded session, CSRF, Host/Origin checks, strict headers, recursive redaction, and fixed actions were implemented.

### T9 and G4: browser

The browser contract, setup, public policy, backend lifecycle, profile locks, CDP, tabs/actions, artifacts, evaluation recovery, and graceful close were implemented. Real debugging replaced a hanging `--dump-dom` probe with CDP readiness and fixed persistent-profile loss by sending `Browser.close` before process fallback. Real local evidence showed the pinned browser and profile persistence.

### T10: Cloudflared

Architecture-specific release metadata, official HTTPS acquisition, exact archive and executable verification, safe extraction, PATH verification, atomic install, and direct no-autoupdate launch were implemented. A real official download established that a 30-minute bound was necessary on the observed connection.

### T11: readiness

The runtime readiness subset introduced strict local/public endpoint validation, persistent NOT_READY state, exact public resource binding, private current state, and the status model without prematurely adding full orchestration.

### T12 and T12.1: Quick Tunnel and signal hardening

Quick Tunnel strict parsing, config conflict checks, one transient recreation, registration gating, OAuth invalidation, and non-production status were implemented. An intermittent negative-PGID `EPERM` was promoted to an explicit blocker subtask; identity revalidation and deadline-bounded retry were added before Named Tunnel work.

### T13: Named Tunnel

Stable hostname and tunnel-name validation, private certificate/current credential validation, direct ephemeral-origin argv, registration gating, secret-free audit, transient-only retries, per-attempt revalidation, fail-closed cleanup, prompt stop cancellation, no Quick fallback, and endpoint/password persistence semantics were implemented deterministically. Real Named Tunnel certification remained reserved for G5/T16.

### T13.1: terminal recovery

The concrete terminal handler missing from the earlier registration task was implemented as an explicit recovery amendment. Stress testing exposed a rapid natural-exit IPC race; the wrapper handshake and ProcessManager startup sequencing were corrected.

### T14: complete foreground runtime

The readiness module was expanded into the real lifecycle, production component assembly, runtime lock/state ownership, signal handling, browser-degraded mode, tunnel integration, fixed dashboard actions, exact startup order, reverse cleanup, deadline preservation, and CLI YOLO routing.

### T15: package and public documentation

README, operator, security, development, release-certification guides, license/notice, npm allowlist, executable symlink behavior, clean-prefix install, and package evidence were finalized without publication.

### T15.1: certification tooling and adversarial recovery

The packaged certification command was repaired and hardened. A critical false-certification design was removed: self-reported booleans and artifact hashes can no longer make external gates pass. Report paths, package checks, component pinning, residue scanning, and installed-bin symlink behavior were strengthened.

### T15.2: this external audit dossier

This task creates one repository-root Markdown dossier, adds an executable documentation contract, records exact inventories, embeds the governing documents, and updates same-commit governance. It changes no runtime behavior and does not widen the package.

### T15.3: adversarial security verification and hardening

Five externally supplied audits were verified claim by claim against source, the pinned SDK, tests, and controlled local experiments. T15.3 fixed the pre-schema MCP body bound, owner-password throttling, scrypt migration, absolute refresh-family lifetime, bounded/locale-pinned watchdog commands, wrapper probe overlap, macOS system aliases, special-file read blocking, capability-reducing audit exceptions, monotonic in-process deadlines, tombstone identity recheck, and explicit runtime-lock flags. It also added OSC/Quick-parser regressions and documented residual risks that an unrestricted tool cannot honestly eliminate. The complete classification is embedded from `docs/release-evidence/t15.3-adversarial-review.md`.

### T16 and G5–G7: remaining production certification

Local clean-clone, package, clean-HOME browser, profile-persistence, and fail-closed report exercises have been performed in prior work, but the canonical release state remains blocked. The remaining required evidence includes real stable Named Tunnel routing, an eligible ChatGPT workspace/account, real OAuth and refresh/reconnect, all seven real tool calls, all required shutdown paths with process tables, owner-password lifecycle observation, manual sleep/wake, connector persistence, committed sanitized evidence, human review, and a clean repository. G7 cannot pass until all of those conditions are met.

## Verification, evidence, and release status

### Fresh verification at the start of T15.2

The repository-mandated startup gate was run from the audit baseline parent commit before edits:

```text
npm ci
PASS — 106 packages installed, 107 audited, 0 vulnerabilities

npm run typecheck
PASS

npm test
PASS — 204 tests, 204 passed, 0 failed

npm run build
PASS

git status --short
PASS — no output before T15.2 edits
```

The executable dossier test was then added before the file. Its expected RED result was:

```text
external audit dossier is self-contained and represents every mapped tracked file
FAIL — ENOENT: EXTERNAL_AUDIT.md did not exist
```

T15.2's final GREEN remains historical. T15.3 subsequently raised the suite to 214/214, regenerated this dossier, produced the current 90-file tarball, and preserved all external/manual certification blockers.

### Deterministic evidence already recorded

- Exact dependency installation and zero npm vulnerabilities.
- Strict typecheck and build.
- Full test suite across all implementation modules: 214/214 at T15.3.
- Real local child, descendant, timeout, cancellation, escalation, and parent-death cleanup tests.
- Real local wrapper readiness race stress.
- Real local pinned Chromium installation and CDP proof.
- Real local dedicated browser-profile persistence across controlled restart.
- Real official Cloudflared download, hash, version, and wrapper-owned execution.
- Deterministic Quick and Named tunnel lifecycle tests.
- Real local MCP/OAuth transport and seven-schema calls through the pinned SDK.
- Clean-prefix package installation and installed bin execution.
- Public package allowlist and forbidden-path checks.
- Fail-closed certification behavior.
- Pre-SDK 9 MiB MCP body rejection, monotonic owner-password throttling, scrypt migration, absolute refresh-family expiry, nonblocking FIFO rejection, watchdog timeout/locale behavior, monotonic dashboard lifetime, and safety-action availability under audit degradation.
- Controlled 64 MiB output experiment with normal completion and deliberate `start_new_session=True` experiment confirming the documented process-group escape limitation.

### Evidence not yet sufficient for release certification

- Eligible current ChatGPT workspace/account with custom MCP or developer-mode support.
- Real public Named Tunnel DNS and routing to the exact current ephemeral origin.
- Real ChatGPT authorization using the persistent owner password.
- Real access-token refresh and connector reconnect.
- Representative real calls to every one of the seven tools.
- Process tables before, during, and after Ctrl+C, SIGTERM, terminal close, and forced parent death in the production tunnel/client configuration.
- Proof that public access stops after each shutdown path.
- Manual sleep/wake observation.
- Manual connector persistence observation.
- Human review of committed sanitized artifacts.

### Current release conclusion

The implementation has extensive deterministic and local evidence, but it is not legitimate to call it release-ready or production-certified yet. G5, G6, the external/manual portion of T16, and G7 remain blocked. `loom-certify` is expected to report a blocked state and exit 2 when deterministic checks pass but those gates remain unresolved. The package also lacks an out-of-band signing root: the independently recorded tarball SHA is evidence for this candidate, but the in-package verifier cannot certify its own integrity.

## External expert audit priorities

An external reviewer should independently validate at least the following areas rather than relying solely on test names or this synthesis:

1. Confirm every public path to unrestricted execution requires the exact YOLO launch and local terminal boundary.
2. Trace all child creation and verify no Cloudflared or Chromium path reaches a shell adapter.
3. Review process-group ownership under rapid exit, process replacement, parent death, signal races, `EPERM`, and absolute shutdown timeout.
4. Review all path operations for time-of-check/time-of-use gaps, hard-link assumptions, parent replacement, and macOS filesystem behavior.
5. Review atomic-write durability assumptions on APFS and failure handling around rename and parent fsync.
6. Review audit queue bounds, admission semantics, rotation serialization, redaction completeness, and degraded-state behavior.
7. Review owner-password lifecycle, scrypt parameters, state conflict handling, hash-at-rest decisions, and reset races.
8. Review OAuth transactions, redirect matching, PKCE, resource/audience binding, endpoint generation, token rotation, revocation, metadata paths, and client-bound sessions.
9. Compare MCP SDK usage against the exact pinned SDK version and current ChatGPT custom-connector expectations.
10. Review Zod schemas for action-specific ambiguity, unknown-field behavior, and size bounds before allocation.
11. Review final-symlink read stability and confirm writes/edits never inherit the read exception.
12. Review catalog root containment, namespace collisions, immutable generation swaps, scan cancellation, and tombstone recovery.
13. Review browser profile lock identity, Chromium singleton cleanup, CDP exposure, browser argument secrecy, artifact creation, timeout recovery, and graceful profile flush.
14. Review architecture-specific browser and Cloudflared hashes and reproduce acquisition on both arm64 and x64 where support is claimed.
15. Review Quick URL parsing under arbitrary chunking and hostile Cloudflared output.
16. Review Named credential schema assumptions against actual current Cloudflare credential output and account-certificate formats.
17. Verify Named retry classification does not retry authentication/configuration errors and cannot recreate after stop.
18. Review dashboard session entropy, expiry, bootstrap replay, Host/Origin parsing, CSRF, status redaction, and fixed action routing.
19. Verify runtime state cannot become ready before OAuth metadata, public resource, and tunnel readiness are all aligned.
20. Verify cleanup preserves locks on uncertainty and does not create an availability or unsafe-recovery trap.
21. Reproduce package contents from a clean clone and confirm no internal plan, test, release evidence, credentials, state, or this dossier enters the tarball.
22. Perform G5/G6/T16 manually with sanitized evidence and independently assess whether each artifact proves the claimed event.
23. Model the authorized LLM as potentially manipulated by prompt injection from browser pages, files, skills, memory, and terminal output; examine cross-tool escalation and persistence.
24. Review which tool content leaves the Mac for the authorized client/provider and whether the operator guidance accurately reflects retention and confidentiality consequences.
25. Review the persistent browser profile, memory store, downloads, screenshots, shell profiles, and scheduled-job surfaces that survive OAuth reset or runtime restart.
26. Evaluate localhost/private-network navigation as an SSRF/LAN pivot rather than treating URL-scheme validation as the complete browser boundary.
27. Exercise macOS TCC/Full Disk Access behavior and confirm failure messages and local-prompt requirements are operationally understandable.
28. Verify local-only containment assumptions and document the trusted remote-administration or physical-access path required when the owner is away.
29. Independently validate the tarball SHA and future detached signature using tooling outside the source tree and package being reviewed.
30. Confirm no cleanup claim extends to a command that deliberately creates a new session/process group, and assess whether that residual is acceptable for the intended users.

## Complete repository file-by-file ledger

The verbatim `REPO_MAP.md` snapshot embedded below is the authoritative file-by-file ledger. It records each path’s purpose, success check, current assessment, evidence, last meaningful change, and owning task or gate. The generated exact-tree inventory and source/test inventories follow the ledger and provide a second way to check coverage.

<!-- GENERATED_CONTENT_START -->

### Verbatim repository ledger

The following is the exact `REPO_MAP.md` content at dossier assembly time.

~~~~~markdown
# Loom Repository Map

Assessment key: `PASS` = present and validated for its current gate; `PARTIAL` = present but later work remains; `FAIL` = known broken; `PLANNED` = intentionally absent until its owning task.

This map is exhaustive for the tracked governance baseline. Validate it against `git ls-files | sort` before every gate/commit that changes tracked files.

## Tracked files

### `.gitignore`
- **Purpose:** Excludes dependencies, build output, packages, macOS metadata, coverage, and local skill-observation state.
- **Success check:** `git status --short` does not show ignored runtime/generated directories.
- **Current assessment:** PASS
- **Evidence:** Contains `node_modules/`, `dist/`, `*.tgz`, `.DS_Store`, `coverage/`, and `skill-observations/`.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0 / G0.

### `AGENTS.md`
- **Purpose:** Mandatory execution, TDD, governance, and completion contract for implementation agents.
- **Success check:** Requires canonical read/startup order, test-first work, explicit plan amendments before task regrouping, same-commit governance, and green typecheck/test/build/map gates before commits.
- **Current assessment:** PASS
- **Evidence:** T5 recovery hardened the execution contract after the adversarial review exposed task drift.
- **Last meaningful change:** T5 recovery governance hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0 and all later gates.

### `ALGORITHM.md`
- **Purpose:** Compact ordered implementation loop.
- **Success check:** Twenty lines or fewer, plan amendment required before regrouping/skipping, and commits require green typecheck/tests/build/map/governance.
- **Current assessment:** PASS
- **Evidence:** Fifteen numbered steps remain within the line limit and match AGENTS.md.
- **Last meaningful change:** T5 recovery governance hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0 and all later gates.

### `CHANGELOG.md`
- **Purpose:** Human-readable implementation and evidence history.
- **Success check:** Updated in every repository-changing commit with actual command, test, package, and certification-boundary evidence.
- **Current assessment:** PASS
- **Evidence:** Records T15.3 code-grounded adversarial triage, every verified fix/residual/false-positive class, the 214/214 full gate, transient-EPERM stress, and the 90-file hardened tarball SHA/install evidence.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** All tasks; current T15.3.

### `EXTERNAL_AUDIT.md`
- **Purpose:** One self-contained external expert audit dossier covering the complete product, architecture, security model, control flows, implementation chronology, evidence boundaries, every tracked path, generated source/test inventories, and verbatim governing documents.
- **Success check:** Executable documentation tests require the mandatory audit sections, exact seven tools, human-review/no-proof boundary, and representation of every path documented by this repository map; generated inventories and embedded source snapshots must match the current tracked state.
- **Current assessment:** PASS
- **Evidence:** Regenerated after T15.3 to include the hardened implementation, 74-file ledger, 214 static test declarations, adversarial evidence, residual-risk disclosures, and updated canonical documents; final dossier integrity and coverage gates pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15.2 and T15.3.

### `HANDOFF.md`
- **Purpose:** Exact resumable state, commands, failures, blockers, SHA, and next action.
- **Success check:** Contains every field required by plan Section 25 and an executable next command.
- **Current assessment:** PASS
- **Evidence:** Records T15.3 scope, verified findings, exact tests/package evidence, real residual blockers, resulting commit candidate, and next command.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** All tasks; current T15.3.
### `LICENSE`
- **Purpose:** MIT license for Loom source distribution.
- **Success check:** Valid MIT license text with copyright attribution.
- **Current assessment:** PASS
- **Evidence:** Present at repository root.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0 / T15.

### `README.md`
- **Purpose:** Public package overview, safety warning, supported commands, setup, tunnel/browser behavior, and documentation links.
- **Success check:** Matches the implemented CLI and trust boundary without claiming real ChatGPT or production certification.
- **Current assessment:** PASS
- **Evidence:** Public overview now warns that untrusted tool content can prompt-inject the authorized agent, MCP results leave the Mac, browser/memory state persists, localhost/private-network access is allowed, and containment is local-only.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `REPO_MAP.md`
- **Purpose:** Exhaustive tracked-file ledger with ownership, checks, assessment, and evidence.
- **Success check:** Extracted path headings exactly match `git ls-files | sort` after staging, with no undocumented tracked files.
- **Current assessment:** PASS
- **Evidence:** Documents all 74 tracked T15.3 files and exact changed responsibilities; staged-tree comparison is required to be empty before commit.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** All tasks; current T15.3.
### `SPEC.md`
- **Purpose:** Approved behavioral, security, dependency, command, packaging, and release contract.
- **Success check:** Matches the canonical plan and prevents deterministic tooling or self-reported manifests from substituting for real external certification.
- **Current assessment:** PASS
- **Evidence:** Locks the body limit, authorization throttling, scrypt migration, refresh-family lifetime, monotonic/bounded watchdog behavior, macOS alias/nonblocking read policy, safety-action audit exception, tombstone/OSC checks, and explicit residual risks.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0 and every behavior-changing task; current T15.3.
### `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- **Purpose:** Full self-contained ordered implementation plan and certification contract.
- **Success check:** Covers Sections 0–26, T0–T16, G0–G7, explicit recovery subtasks, governance gates, and external-evidence boundaries.
- **Current assessment:** PASS
- **Evidence:** Adds T15.3 for code-grounded adversarial verification, concrete hardening, residual-risk disclosure, deterministic regressions, dossier regeneration, and unchanged external certification blockers.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0; source of truth for all later tasks.
### `NOTICE`
- **Purpose:** Distribution notice for Loom and third-party software/trademarks.
- **Success check:** Ships in the public tarball and names the license plus major third-party components without claiming affiliation.
- **Current assessment:** PASS
- **Evidence:** Present in the 90-file package and clean-prefix installation.
- **Last meaningful change:** T15 release notice, 2026-07-08.
- **Owning task or gate:** T15 packaging and documentation.
### `docs/DEVELOPMENT.md`
- **Purpose:** Developer workflow, architecture, validation, security boundaries, and unsupported-claim guidance.
- **Success check:** Matches the implemented task/gate workflow and does not replace external evidence with local tests.
- **Current assessment:** PASS
- **Evidence:** Documents deliberate session escape, APFS/F_FULLFSYNC and local-filesystem durability limits, persistent browser state, code-grounded review discipline, and pre-schema request-boundary testing.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `docs/OPERATOR.md`
- **Purpose:** Supported installation, configuration, launch, dashboard, shutdown, recovery, and diagnostic guide for the single macOS owner.
- **Success check:** Lists only real commands and accurately states the full-access, TTY, owner-password, tunnel, browser, and cleanup boundaries.
- **Current assessment:** PASS
- **Evidence:** Adds TCC, minimal-environment/login-shell guidance, prompt-injection/provider disclosure, persistent profile and artifact handling, terminal-scrollback caution, local-only containment, and complete incident review beyond auth reset.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `docs/RELEASE_CERTIFICATION.md`
- **Purpose:** Public distinction between deterministic readiness, production eligibility, and real externally reviewed certification.
- **Success check:** Documents G5/G6/T16 evidence, forbidden claims, and that `loom-certify` cannot prove external events or independently certify.
- **Current assessment:** PASS
- **Evidence:** Requires exact tarball hash and independent artifact verification, states the absence of an out-of-band trust root, and forbids claims about prompt injection, deliberate process escape, forensic audit, or automatic persistent-state cleanup.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15, T15.1, T15.3, G5–G7, and T16.
### `docs/SECURITY.md`
- **Purpose:** Public security model for unrestricted tools, OAuth, process ownership, files, browser, tunnels, dashboard, state, audit, and incident response.
- **Success check:** Matches the approved trust boundary and explicitly identifies non-goals and same-user limitations.
- **Current assessment:** PASS
- **Evidence:** Expanded threat model covers authorized-agent prompt injection, provider disclosure, persistent browser/memory, sole-factor/throttling limits, deliberate session escape, TCC, LAN pivoting, inherited login-shell secrets, local-only containment, and non-forensic audit.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `docs/certification-evidence.example.json`
- **Purpose:** Sanitized strict example manifest for optional G5–G7 artifact-integrity validation.
- **Success check:** Uses current pinned arm64 Cloudflared/Chromium metadata, contains no secrets, omits optional Quick evidence, and cannot cause automatic certification.
- **Current assessment:** PASS
- **Evidence:** Parsed by certification tests; package includes the current example.
- **Last meaningful change:** T15.1 current pinned example and trust correction, 2026-07-08.
- **Owning task or gate:** T15.1 and T16.
### `docs/release-evidence/README.md`
- **Purpose:** Private-repository index and sanitization rules for deterministic and real external release evidence.
- **Success check:** Lists current T15 local evidence, required future G5/G6/clean-Mac artifacts, forbidden secrets, and human-review requirement.
- **Current assessment:** PASS
- **Evidence:** Indexes the T15.3 adversarial verification record while preserving all G5/G6/clean-Mac gates as not yet certified.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15–T16 and G5–G7.
### `docs/release-evidence/t15-local-package.md`
- **Purpose:** Sanitized deterministic record of the T15 candidate tarball and clean-prefix installation.
- **Success check:** Records environment, exact commands/results, package hash/size, installed binaries/assets, fail-closed launches, cleanup, and explicit external limitations.
- **Current assessment:** PASS
- **Evidence:** Records SHA-256 `3711d511bf530ec3d834b4a021d960cbb001af43c126c850069640bfd7f7a549`, 90 files, 204/204 tests, and no state creation.
- **Last meaningful change:** T15 local package evidence, 2026-07-08.
- **Owning task or gate:** T15 packaging and documentation.

### `docs/release-evidence/t15.3-adversarial-review.md`
- **Purpose:** Sanitized code-grounded classification of the five supplied adversarial audits, including verified fixes, verified residual risks, false positives, intentional scope tradeoffs, and controlled local experiments.
- **Success check:** Contains no secrets or simulated external evidence; every fixed claim names a regression, every residual risk is disclosed in public docs, and G5–G7 remain explicitly blocked.
- **Current assessment:** PASS
- **Evidence:** Records MCP/body/auth/scrypt/refresh/watchdog/path/read/cancel/tombstone/clock fixes, 64 MiB output and deliberate-session-escape experiments, false-positive evidence, and package/full-suite requirements.
- **Last meaningful change:** T15.3 adversarial verification evidence, 2026-07-08.
- **Owning task or gate:** T15.3 and T16.

### `package-lock.json`
- **Purpose:** Reproducible exact npm dependency graph.
- **Success check:** `npm ci` succeeds and direct dependencies match package.json exact pins.
- **Current assessment:** PASS
- **Evidence:** Generated by npm 11.12.1; install reported 106 packages and zero vulnerabilities.
- **Last meaningful change:** T0 dependency installation, 2026-07-07.
- **Owning task or gate:** T0 / G1.

### `package.json`
- **Purpose:** Package identity, Node floor, executable mappings, exact dependencies, scripts, and explicit public release allowlist.
- **Success check:** No dependency ranges; Node `>=22`; `loom` and `loom-certify` bins; public runtime/assets/docs/license/notice included; tests, plans, and release evidence excluded.
- **Current assessment:** PASS
- **Evidence:** Full suite passes 204/204; `npm pack --dry-run --json` reports 90 approved files; clean-prefix install executes both npm bin symlinks and fail-closed launch checks.
- **Last meaningful change:** T15/T15.1 public package allowlist and certification CLI, 2026-07-08.
- **Owning task or gate:** T0 / G1 and T15/T15.1.
### `src/audit.ts`
- **Purpose:** Private durable JSONL audit logging with bounded serialization, mutation fail-closed deadlines, rotation, retention, degradation state, and metadata redaction.
- **Success check:** Mutation start resolves only after fsync, saturation/deadline/write failure disables later mutations, reads remain non-throwing, files remain 0600 in a 0700 directory, rotation is parseable, and forbidden values never appear.
- **Current assessment:** PASS
- **Evidence:** `test/audit.test.ts` passes 8/8; full suite passes 47/47.
- **Last meaningful change:** T3 audit completion, 2026-07-08.
- **Owning task or gate:** T3; integrated by terminal, files, memory, browser, and runtime tasks.

### `src/atomic-file.ts`
- **Purpose:** Durable same-directory atomic replacement with per-canonical-path serialization and optimistic conflict detection.
- **Success check:** Enforces the write-size limit, rejects symlink paths, preserves existing mode, creates new files as 0600, fsyncs file and parent directory, cleans temporary files, and allows only one concurrent writer sharing an expected hash to succeed.
- **Current assessment:** PASS
- **Evidence:** `test/atomic-file.test.ts` passes 5/5; full suite passes 14/14.
- **Last meaningful change:** T1 atomic-file foundation, 2026-07-08.
- **Owning task or gate:** T1; reused by config, OAuth, audit state, memory, and file tools.

### `src/browser.ts`
- **Purpose:** Dependency-free browser backend contract, result types, and typed public/backend error hierarchy.
- **Success check:** Defines every approved browser action result and shutdown contract without loading Playwright or performing side effects.
- **Current assessment:** PASS
- **Evidence:** Imported by both public policy and backend modules; browser target and full 120-test suite typecheck and pass.
- **Last meaningful change:** T9 browser contract separation, 2026-07-08.
- **Owning task or gate:** T9 / G4.

### `src/browser/backend.ts`
- **Purpose:** Wrapper-owned persistent Chromium/CDP lifecycle, tabs/actions, browser lock recovery, bounded page operations, downloads, screenshots, permissions, geolocation, and graceful shutdown.
- **Success check:** Uses direct ProcessManager executable/argv launch, guarded Playwright import, dedicated profile, PID-reuse-safe lock recovery, twelve-tab bound, per-tab timeout recovery, private no-overwrite artifacts, CDP `Browser.close`, and bounded cancellation fallback.
- **Current assessment:** PASS
- **Evidence:** Deterministic browser tests cover lock identity, false positives, downloads, shutdown, snapshot/evaluate recovery, and dispatcher boundaries; real Chrome restored localStorage across two controlled restarts with no process or lock residue.
- **Last meaningful change:** T9 managed Chromium backend and profile-persistence repair, 2026-07-08.
- **Owning task or gate:** T9 / G4; composed by T14 runtime.

### `src/browser/setup.ts`
- **Purpose:** Explicit architecture-pinned Chromium acquisition, exact executable verification, wrapper-owned launch proof, private manifest, atomic promotion, and pinned metadata export.
- **Success check:** Retains install/rollback/security behavior and exposes only the architecture-specific pinned executable SHA required by certification validation.
- **Current assessment:** PASS
- **Evidence:** Browser tests remain green; T15.1 external evidence rejects non-pinned Chromium revision/hash; full suite passes 204/204.
- **Last meaningful change:** T15.1 pinned certification metadata export, 2026-07-08.
- **Owning task or gate:** T9 / G4, T15.1, and T16 certification.
### `src/certification-cli.ts`
- **Purpose:** Packaged command boundary for deterministic evidence collection, optional manifest/artifact validation, private report output, and blocked/fail exit semantics.
- **Success check:** Executes through npm bin symlinks, never auto-certifies external gates, reports deterministic failure as 1 and unresolved external gates as 2.
- **Current assessment:** PASS
- **Evidence:** Five CLI tests pass, including real package-bin symlink execution and supplied evidence remaining blocked.
- **Last meaningful change:** T15.1 fail-closed certification CLI and symlink repair, 2026-07-08.
- **Owning task or gate:** T15.1 and T16.
### `src/certification.ts`
- **Purpose:** Strict deterministic certification collector, external manifest schema, artifact verifier, package validator, residue scanner, report evaluator, and private writer.
- **Success check:** Binds evidence to exact SHA/current pins, rejects unsafe package/report/artifact paths, detects Loom residue, and keeps G5–G7 blocked pending human review.
- **Current assessment:** PASS
- **Evidence:** Fourteen certification tests plus five CLI/docs tests pass; full suite 204/204 and 90-file package gate pass.
- **Last meaningful change:** T15.1 certification recovery and adversarial hardening, 2026-07-08.
- **Owning task or gate:** T15.1, G5–G7, and T16.

### `src/child-wrapper.ts`
- **Purpose:** Detached process-group leader that receives launch data only over IPC, starts targets with ignored stdin, forwards separate output streams, flushes lifecycle IPC in order, and independently watches parent identity.
- **Success check:** Wrapper and target share one dedicated PGID; `ready` is delivered before a fast target `exit`/disconnect; startup errors flush before disconnect; duplicate finish paths are suppressed; missed heartbeat or parent-identity mismatch triggers whole-group TERM then KILL cleanup.
- **Current assessment:** PASS
- **Evidence:** Uses monotonic heartbeat age and serializes bounded parent-identity probes; confirmed mismatch cleans immediately while transient unobservability with healthy heartbeats no longer causes false orphan cleanup. Rapid exit, parent-death, EPERM, and full suites pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2, T13.1, and T15.3.

### `src/cli.ts`
- **Purpose:** Executable command boundary for version/help, explicit foreground YOLO launch, browser setup, configuration management, and owner-credential rotation.
- **Success check:** Plain launch refuses access; exact `launch --yolo` requires macOS 14+/Node 22+ and direct `/dev/tty`, prints the warning/new owner password only locally, invokes the production foreground runtime, and cleans a factory-created lock on launch failure; existing setup/reset safety remains intact.
- **Current assessment:** PASS
- **Evidence:** Thirteen CLI tests pass, including injected exact YOLO routing and a genuinely terminal-less YOLO attempt that creates no `~/.loom`, plus package-bin/PTTY/setup/reset/live-lock coverage.
- **Last meaningful change:** T14 real foreground YOLO launch and support/TTY boundary, 2026-07-08.
- **Owning task or gate:** T0 / G1, T1, T4, T9, and T14.

### `src/cloudflare.ts`
- **Purpose:** Pinned Cloudflared acquisition/verification plus Quick and Named Tunnel validation, direct launch, bounded readiness, retry, audit, status, and cleanup.
- **Success check:** Retains T10/T12 guarantees; named mode validates private stable certificate/current credentials and exact name/account/hostname, launches explicit ephemeral origin argv, exposes production status only after registration, revalidates every attempt, retries only transient failures five times with capped backoff, never falls back to Quick, fails closed on audit/auth/config/cleanup uncertainty, and aborts startup waits on stop without recreation.
- **Current assessment:** PASS
- **Evidence:** Cloudflared target passes 30/30. Thirteen named tests prove static validation, exact argv/status, endpoint/password persistence, retry classification/limits, auth/config fail-fast, audit secrecy/order, timeout cleanup, per-attempt revalidation, cleanup failure, benign config notices, option-like rejection, and prompt startup cancellation. T10 real official binary/network evidence remains valid; G5 real named certification remains pending.
- **Last meaningful change:** T13 Named Tunnel manager and validation, 2026-07-08.
- **Owning task or gate:** T10 acquisition, T12 Quick Tunnel, and T13 Named Tunnel; consumed by T14.

### `src/config.ts`
- **Purpose:** Secure Loom state initialization, strict versioned configuration, private atomic next-launch replacement, invalid-config preservation, runtime-lock persistence, and PID-reuse identity comparison.
- **Success check:** Creates/repairs private state, validates without mutation, atomically writes strict 0600 config without symlink traversal, canonicalizes named values, preserves invalid bytes on reset, and requires exact runtime identity.
- **Current assessment:** PASS
- **Evidence:** Eight config tests pass, including T14 `writeConfig` canonical/private replacement and unknown-key rejection; the 45-test T14 target and 181-test full suite are green.
- **Last meaningful change:** T14 audited dashboard next-launch config writer, 2026-07-08.
- **Owning task or gate:** T1, T13, and T14.

### `src/limits.ts`
- **Purpose:** Single source of truth for all fixed Loom v1 byte, time, count, retry, and shutdown limits.
- **Success check:** Every exported value exactly matches plan Section 8 and boundary tests import the production constants.
- **Current assessment:** PASS
- **Evidence:** Adds the 9 MiB MCP request limit, ten-attempt/60-second authorization window, and two-second watchdog command timeout; exact 40-constant ledger test passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1, T13.1, and T15.3.

### `src/process-manager.ts`
- **Purpose:** Launches wrapper-owned detached process groups, streams bounded output, sends heartbeats, validates ownership, manages startup/exit races, timeout/cancellation, and TERM-to-KILL shutdown deadlines.
- **Success check:** Real processes have no PTY/stdin; wrapper exit before readiness rejects immediately; exit events between readiness and managed construction are preserved; natural exit/cancellation clean descendants; transient `EPERM` is revalidated; persistent `EPERM` fails closed; forced manager death is recovered; and no test descendants remain.
- **Current assessment:** PASS
- **Evidence:** Owned-group TERM/KILL and EPERM retry deadlines now use monotonic time; process-manager and ten-run transient-EPERM stress pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2, T12.1, T13.1, T14, and T15.3.

### `src/runtime.ts`
- **Purpose:** T11 readiness plus T14 exclusive foreground lifecycle, production component assembly, lock/state ownership, status, signals, dashboard actions, and reverse cleanup.
- **Success check:** Builds all seven handlers; acquires an identity-bound exclusive lock before audit; starts MCP NOT_READY/dashboard/catalogs/browser/tunnel in order; publishes exact `/mcp` once; supports verified browser or missing/corrupt-manifest degraded mode and pinned Quick/Named tunnel without fallback; opens the authenticated local dashboard by default; handles explicit/dashboard/signal stops; enforces a real 15-second per-step deadline; terminates public listeners/process groups; and removes exact readiness state plus lock only after content/identity ownership and cleanup certainty.
- **Current assessment:** PASS
- **Evidence:** Runtime shutdown uses monotonic deadline arithmetic and lock creation explicitly uses O_CREAT|O_EXCL|O_NOFOLLOW; integrated lifecycle and lock tests pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T11, T14, and T15.3.

### `src/mcp.ts`
- **Purpose:** Loopback-only Streamable HTTP MCP and OAuth HTTP server with deterministic readiness, endpoint-bound bearer authentication, server-bound authorization transactions, token routes, and bounded client-bound sessions.
- **Success check:** Authorization GET stores the request server-side; POST accepts only transaction ID and owner password; replay/substitution fail; strict CSP/frame/no-store headers apply; SDK metadata strings are normalized without `any`; sessions and readiness remain bounded.
- **Current assessment:** PASS
- **Evidence:** Bounds MCP JSON before SDK parsing, preserves SDK localhost Host validation, limits OAuth metadata bodies, returns structured 413/parse errors, rate-limits owner authorization monotonically, and tracks session idleness monotonically. MCP target passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T5 and T15.3.

### `src/oauth.ts`
- **Purpose:** Persistent single-owner credentials and endpoint-bound OAuth clients, authorization transactions/codes, access/refresh tokens, revocation, metadata, and endpoint-generation state.
- **Success check:** Exact endpoint/generation bindings remain atomic; `revokeAllOAuth` increments generation and clears clients/codes/tokens while preserving the canonical endpoint and owner credential; owner reset remains the only password rotation path.
- **Current assessment:** PASS
- **Evidence:** New owner hashes use scrypt N=32768/r8/p3 with explicit memory, successful legacy verification upgrades atomically, and refresh rotation preserves one absolute 30-day family expiration. OAuth/MCP suites pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T4, T5, T14, and T15.3.

### `src/output.ts`
- **Purpose:** Ordered bounded terminal-output storage with sanitization, binary suppression, head/tail retention, cursor pagination, gap detection, and terminal state.
- **Success check:** Preserves stdout/stderr append order, strips ANSI/unsafe controls, never splits UTF-8, reports exact truncation cursors, and records completed/cancelled/timed-out outcomes.
- **Current assessment:** PASS
- **Evidence:** `test/output.test.ts` passes 6/6; full suite passes 29/29.
- **Last meaningful change:** T2 output foundation, 2026-07-08.
- **Owning task or gate:** T2 / G2; reused by terminal and Cloudflared process management.

### `src/paths.ts`
- **Purpose:** Parse absolute or `~/` user paths, reject malformed input, and prevent writes through existing symbolic-link components.
- **Success check:** Rejects empty, relative, alternate-home, NUL, malformed-Unicode, symlink-parent, symlink-final, and non-directory-intermediate paths while allowing a missing tail under real directories.
- **Current assessment:** PASS
- **Evidence:** Canonicalizes only macOS /tmp and /var compatibility aliases to /private paths while retaining strict rejection of all other mutation symlinks; path and full suites pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1 and T15.3.

### `test/audit.test.ts`
- **Purpose:** Real-filesystem proof for durable starts, 0700/0600 permissions, queue saturation, deadline failure, disk failure, serialized rotation, retention, read availability, finish duration, and redaction.
- **Success check:** All failure paths are explicit, no JSONL line is corrupted, and secret/content literals are absent from persisted bytes.
- **Current assessment:** PASS
- **Evidence:** Eight targeted tests pass, including fixed-time rotation/retention and a one-millisecond durable-start deadline.
- **Last meaningful change:** T3 audit RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T3.

### `test/atomic-file.test.ts`
- **Purpose:** Real-filesystem proof for atomic replacement, permissions, expected-hash conflicts, same-path serialization, cleanup, size limits, and symlink rejection.
- **Success check:** Exactly one of two concurrent expected-hash writers succeeds and no `.tmp` residue remains after success or rejection.
- **Current assessment:** PASS
- **Evidence:** Targeted suite reports 5 passed, 0 failed.
- **Last meaningful change:** T1 atomic-file RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T1.

### `test/browser.test.ts`
- **Purpose:** Deterministic and real-local boundary tests for pinned setup, wrapper-owned launch, install rollback, browser locks, artifacts, audit policy, validation, dispatch, graceful shutdown, and per-tab recovery.
- **Success check:** Proves exact hashes and symlink rejection, CWD-independent official-CDN installer arguments, CDP readiness cleanup, stale-lock identity rules, no-overwrite downloads, audit secrecy/fail-closed behavior, all actions, bounded snapshot/evaluate recovery, natural shutdown, and cancellation fallback.
- **Current assessment:** PASS
- **Evidence:** Proves audit degradation blocks capability-increasing browser work but not tab close/read-only actions; full browser target remains green.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T9 and T15.3.

### `test/certification-cli.test.ts`
- **Purpose:** CLI-level blocked/fail semantics, strict evidence flow, help side-effect, and npm package-bin symlink regressions.
- **Success check:** Proves supplied self-reported evidence remains blocked and the installed-style symlink invokes the CLI.
- **Current assessment:** PASS
- **Evidence:** Five tests pass as part of the 19-test certification/documentation target.
- **Last meaningful change:** T15.1 certification CLI RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T15.1 and T16.
### `test/certification.test.ts`
- **Purpose:** Unit/integration tests for deterministic collection, external schema/pins, artifact/report path safety, package contents, residue detection, and fail-closed evaluation.
- **Success check:** Proves no self-certification, optional Quick evidence, exact managed pins, symlink rejection before mutation, complete public package requirements, and managed process detection.
- **Current assessment:** PASS
- **Evidence:** Fourteen tests pass; required RED cases reproduced each repaired defect; full suite passes 204/204.
- **Last meaningful change:** T15.1 certification recovery and adversarial RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T15.1, G5–G7, and T16.

### `test/cli.test.ts`
- **Purpose:** Real-process/PTY and injected-routing tests for package/bootstrap, setup/reset, plain-launch refusal, and explicit foreground YOLO launch.
- **Success check:** Proves exact `launch --yolo` routes once, a sessionless launch fails before state creation, plain launch remains refused, and all prior symlink/setup/config/auth reset protections remain.
- **Current assessment:** PASS
- **Evidence:** Target passes 14/14 and participates in the 49/49 T14 target and 185/185 full suite.
- **Last meaningful change:** T14 YOLO launch routing and local-terminal refusal, 2026-07-08.
- **Owning task or gate:** T0 / G1, T1, T4, T9, and T14.

### `test/cloudflare.test.ts`
- **Purpose:** Deterministic acquisition/verification plus Quick and Named Tunnel parser, trust, lifecycle, retry, audit, OAuth, status, and cleanup tests.
- **Success check:** Retains T10/T12 checks and proves named certificate/credential validation, exact direct argv, registration gating, hidden pre-ready status, bounded transient-only retries, no fallback, per-attempt revalidation, cleanup fail-closed behavior, prompt stop cancellation, audit secrecy/order, stable endpoint generation, and owner-password persistence.
- **Current assessment:** PASS
- **Evidence:** Adds a bounded 256 KiB hostile Quick Tunnel parser case while retaining all acquisition, Quick, Named, retry, OAuth, and cleanup coverage.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T10, T12, T13, and T15.3.

### `test/config.test.ts`
- **Purpose:** Real-filesystem tests for state permissions, strict config validation, non-mutating checks, invalid-config preservation, runtime-lock storage, full identity matching, and named-tunnel config canonicalization.
- **Success check:** Exercises private creation/repair, symlink rejection, schema failures, named stable-hostname/name boundaries, timestamped backup bytes, strict lock parsing, and every PID-reuse defense field.
- **Current assessment:** PASS
- **Evidence:** Targeted suite passes 8/8, adding strict private atomic `writeConfig`; combined T14 target passes 49/49 and full suite passes 185/185.
- **Last meaningful change:** T14 next-launch config replacement test, 2026-07-08.
- **Owning task or gate:** T1, T13, and T14.

### `test/limits.test.ts`
- **Purpose:** Locks every centralized Loom v1 limit to the approved specification.
- **Success check:** Exact value comparison passes without duplicating runtime logic.
- **Current assessment:** PASS
- **Evidence:** Locks all 40 current limits including request, authorization, and watchdog bounds.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1, T13.1, and T15.3.

### `public/dashboard.css`
- **Purpose:** Minimal responsive styling for the authenticated loopback dashboard without inline CSS.
- **Success check:** Loads only inside an authenticated dashboard session and remains compatible with the strict self-only CSP.
- **Current assessment:** PASS
- **Evidence:** Targeted dashboard HTTP tests pass 2/2; full tracked suite passes 99/99.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `public/dashboard.html`
- **Purpose:** Static dashboard shell containing only redacted status surfaces, allowlisted controls, and the injected per-session CSRF meta value.
- **Success check:** Contains no inline executable content or secrets; requires an authenticated session; uses text-only rendering through dashboard.js.
- **Current assessment:** PASS
- **Evidence:** Bootstrap/session/CSRF/redaction tests pass through real HTTP.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `public/dashboard.js`
- **Purpose:** Same-origin dashboard client for redacted status and the fixed action allowlist.
- **Success check:** Sends credentials and X-Loom-CSRF, renders with textContent, never evaluates returned HTML, and exposes no generic command/action endpoint.
- **Current assessment:** PASS
- **Evidence:** Targeted dashboard action tests pass and unknown actions return 404.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `src/dashboard.ts`
- **Purpose:** Loopback-only dashboard HTTP server with one-time bootstrap, bounded sessions, exact Host/Origin validation, CSRF, strict headers, recursive redaction, and allowlisted actions.
- **Success check:** Nonces are single-use/expiring; cookies are HttpOnly SameSite=Strict; all pages/APIs require a session; mutations require exact Origin and CSRF; hostile Host and unknown actions fail.
- **Current assessment:** PASS
- **Evidence:** Production nonce/session lifetimes now default to monotonic time; wall-clock-jump regression and all dashboard security tests pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T8 and T15.3.

### `src/tools/browser.ts`
- **Purpose:** Public `loom_browser` validation, audit policy, bounded result shaping, image return, typed error preservation, and dispatcher composition.
- **Success check:** Accepts only approved actions/schemes/origins/permissions/bounds, audits every browser mutation before backend work without secret content, keeps reads available after audit degradation, and never statically loads Playwright.
- **Current assessment:** PASS
- **Evidence:** Capability-increasing browser mutations remain audit-fail-closed while tab close is best-effort audited and remains available for containment during audit degradation.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T9 and T15.3.

### `src/tools/files.ts`
- **Purpose:** Concrete bounded text/image/binary read, audited atomic write, exact audited edit, and dispatcher composition for the three public file tools.
- **Success check:** Reads safely follow only a stable final symlink to a regular-file target, reject symlinked parents, detect image MIME by magic bytes, bound output, and hash the complete stable snapshot; writes/edits retain strict symlink rejection, audit-before-mutation, conflict detection, and atomic replacement.
- **Current assessment:** PASS
- **Evidence:** Stable read targets are opened O_NONBLOCK|O_NOFOLLOW before regular-file verification, preventing FIFO/device replacement from hanging the server; file suite passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T6 and T15.3.

### `src/tools/memory.ts`
- **Purpose:** Loom-owned stable-ID memory store with deterministic search, audited save/delete, crash-recovered tombstones, bounded rescans, and dispatcher composition.
- **Success check:** Save/delete are serialized and audited; stale valid tombstones are durably removed under audit; unsafe tombstones remain with diagnostics; malformed/oversized entries do not corrupt published snapshots; aggregate limits fail atomically.
- **Current assessment:** PASS
- **Evidence:** Tombstone cleanup repeats symlink/type and full identity verification immediately before removal and retains a diagnostic on replacement; memory suite passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T7 and T15.3.

### `src/tools/skills.ts`
- **Purpose:** Bounded deterministic multi-root SKILL.md discovery, metadata extraction, search/read, diagnostics, and dispatcher composition.
- **Success check:** Symlinks are skipped, limits preserve prior snapshots, unterminated frontmatter is skipped with `malformed_frontmatter_skipped`, and skipped malformed bytes do not count as indexed bytes.
- **Current assessment:** PASS
- **Evidence:** `test/skills.test.ts` passes 10/10; full tracked suite passes 97/97.
- **Last meaningful change:** T7 skills catalog and malformed-frontmatter handling, 2026-07-08.
- **Owning task or gate:** T7.

### `src/tools/terminal.ts`
- **Purpose:** Concrete unrestricted but noninteractive terminal service and dispatcher using the sole static `/bin/sh -lc` ProcessManager adapter.
- **Success check:** Validates centralized command/environment/cwd/timeout/job/poll bounds; canonicalizes safe cwd symlinks; audits start/cancel before mutation without sensitive bytes; returns stable job IDs and cursor lifecycle metadata with output only in MCP content; never evicts running jobs; awaits audit completion before finished-job eviction; and cancels every retained running process group on shutdown.
- **Current assessment:** PASS
- **Evidence:** Terminal start remains audit-fail-closed while cancel is best-effort audited and remains available for containment; terminal/process suites pass with zero residue.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T13.1, T14, and T15.3.

### `src/tools/register.ts`
- **Purpose:** Registers exactly seven public Loom MCP tools with strict Zod v4 action/path/size/URL schemas and an injected dispatcher.
- **Success check:** The public list contains only the seven approved tools; terminal schema bounds import centralized constants; every safe action dispatches; dangerous browser schemes, malformed paths, and oversized inputs fail before handlers.
- **Current assessment:** PASS
- **Evidence:** A real SDK client lists/calls all seven branches; T13.1 centralizes terminal command/environment/job/poll/wait/timeout bounds and its dispatcher delegates every non-terminal tool.
- **Last meaningful change:** T13.1 terminal schema centralization and concrete dispatcher, 2026-07-08.
- **Owning task or gate:** T5 registration and T13.1 terminal implementation; consumed by T14.

### `src/watchdog.ts`
- **Purpose:** macOS process-table observation using `ps` plus canonical executable resolution using `lsof`, observable identity matching, and PGID membership scans.
- **Success check:** Returns PID/PPID/PGID/start time/canonical executable, treats missing PIDs as absent, and rejects any PID/start/executable mismatch.
- **Current assessment:** PASS
- **Evidence:** All ps/lsof probes use fixed PATH/LANG/LC_ALL, bounded buffers, and a two-second SIGKILL timeout through one helper; live watchdog and timeout tests pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2, T12.1, and T15.3.

### `test/dashboard.test.ts`
- **Purpose:** Real HTTP tests for one-time bootstrap, cookies, strict headers, session/CSRF/Origin/Host boundaries, recursive redaction, and action allowlisting.
- **Success check:** Replayed nonces, missing sessions, wrong Origin/CSRF/Host, leaked secrets, and unknown actions are all rejected deterministically.
- **Current assessment:** PASS
- **Evidence:** Adds a wall-clock-jump regression proving production dashboard bootstrap lifetime is monotonic; dashboard target passes 3/3.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T8 and T15.3.

### `test/docs.test.ts`
- **Purpose:** Executable contract for real CLI commands, security/operating documentation, certification limitations, package metadata, and the repository-only external audit dossier.
- **Success check:** Rejects stale commands/placeholders, requires the human-review/no-proof boundary, verifies the exact public package allowlist/bins, and requires the dossier’s mandatory sections, exact seven tools, gate boundary, and representation of every mapped tracked path.
- **Current assessment:** PASS
- **Evidence:** Adds executable requirements for prompt injection, persistent browser state, TCC, LAN/provider disclosure, local-only containment, non-forensic audit, process escape, minimal environment, F_FULLFSYNC limits, and artifact trust.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15, T15.1, T15.2, and T15.3.

### `test/files.test.ts`
- **Purpose:** Real-filesystem proof for stable/ranged reads, image magic bytes, explicit binary base64, stable final-symlink reads, parent/mutation symlink rejection, audited writes/edits, conflicts, concurrency, and dispatcher composition.
- **Success check:** Final-link reads return target content without weakening writes or edits; parent symlinks fail; content never enters audit records; one concurrent expected-hash writer wins; no temporary residue remains.
- **Current assessment:** PASS
- **Evidence:** Adds a real FIFO final-symlink regression with delayed writer and proves prompt regular-file rejection without blocking; file target passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T6 and T15.3.

### `test/memory.test.ts`
- **Purpose:** Real-filesystem tests for persistent stable IDs, ranking, audit fail-closed behavior, delete conflicts, concurrency, limits, symlink safety, tombstone recovery, diagnostics, and dispatcher composition.
- **Success check:** Valid stale tombstones are removed, unsafe tombstones remain diagnosed, aggregate limits are tested with individually valid files, and failed rescans preserve the prior immutable snapshot.
- **Current assessment:** PASS
- **Evidence:** Adds an adversarial tombstone replacement during audit admission and proves the replacement is preserved with a cleanup diagnostic.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T7 and T15.3.

### `test/runtime.test.ts`
- **Purpose:** T11 readiness plus T14 integrated real-local runtime, lock, signal, deadline, factory, degraded-browser, listener, process-group, and cleanup tests.
- **Success check:** Uses real audit, ProcessManager/terminal, MCP, dashboard, catalogs, dispatcher chain and runtime files; proves one readiness publication, public 401 transition, normal/startup-failure/signal/direct-stop cleanup, stop during tunnel startup without recreation, listener termination, deadline-preserved ownership, live/replaced lock refusal, exact current-state replacement refusal, default assembly/password persistence, browser degradation, and factory lock cleanup.
- **Current assessment:** PASS
- **Evidence:** Target passes 18/18; five consecutive runs pass 90/90 with no Loom-owned process or listener residue; combined T14 target passes 49/49 and full suite passes 185/185.
- **Last meaningful change:** T14 full runtime integration and stress cycle, 2026-07-08.
- **Owning task or gate:** T11 and T14.

### `test/skills.test.ts`
- **Purpose:** Tests deterministic discovery/ranking, stable IDs, duplicate names, symlink/depth/size/entry/total/time limits, missing roots, malformed frontmatter, and dispatcher composition.
- **Success check:** Unterminated frontmatter never becomes a skill and emits exactly one deterministic diagnostic while valid peers remain indexed.
- **Current assessment:** PASS
- **Evidence:** Ten targeted tests pass; full tracked suite passes 97/97.
- **Last meaningful change:** T7 malformed-frontmatter RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T7.

### `test/mcp.test.ts`
- **Purpose:** End-to-end loopback HTTP and pinned-SDK tests for readiness, metadata, bearer challenges, server-bound OAuth authorization, revocation, seven tools, session ownership/capacity/expiry, endpoint lifecycle, and clean shutdown.
- **Success check:** The authorization page contains only a transaction ID, has CSP and frame denial, ignores attacker-supplied POST parameters, rejects replay, and all existing transport/session behaviors remain green.
- **Current assessment:** PASS
- **Evidence:** Adds structured pre-SDK 413 and monotonic owner-password throttling regressions while retaining full OAuth/session/seven-tool behavior.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T5 and T15.3.

### `test/oauth.test.ts`
- **Purpose:** State-level security tests for owner credentials, endpoint-bound OAuth, rotation/replay/expiry, reset, metadata, and owner-preserving revoke-all behavior.
- **Success check:** Existing tokens fail after revoke-all, endpoint/password remain unchanged, fresh registration succeeds, and all prior exact binding/secret-at-rest checks remain.
- **Current assessment:** PASS
- **Evidence:** Proves N=32768/r8/p3 creation, successful legacy-hash migration, and absolute refresh-family expiration in addition to all endpoint/token/reset behavior.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T4 and T15.3.

### `test/output.test.ts`
- **Purpose:** Boundary tests for terminal stream ordering, sanitization, deterministic binary markers, exact truncation, cursor pagination, UTF-8 boundaries, and lifecycle states.
- **Success check:** Stale cursors report gaps and pagination preserves source order without duplication or loss.
- **Current assessment:** PASS
- **Evidence:** Adds OSC 52 clipboard-control input and proves only safe text remains while retaining binary/truncation/cursor/lifecycle coverage.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2 and T15.3.

### `test/process-manager.test.ts`
- **Purpose:** Real-process proof for no PTY/stdin, dedicated groups, complete descendant cleanup, rapid natural-exit wrapper handshakes, hard-kill escalation, parent-death watchdog recovery, timeouts, and transient/persistent negative-PGID `EPERM` behavior.
- **Success check:** Every success test ends with an empty owned PGID; twenty rapid zero-work targets complete after the ready handshake; transient `EPERM` retries after ownership validation; persistent `EPERM` rejects at the deadline; and no wrapper/target/grandchild process remains.
- **Current assessment:** PASS
- **Evidence:** Ten process-manager tests pass, including twenty rapid natural exits and deterministic transient/persistent `EPERM`; the combined T13.1 target passes 19/19, full suite passes 167/167, and delayed residue scan is empty.
- **Last meaningful change:** T13.1 rapid natural-exit handshake regression, 2026-07-08.
- **Owning task or gate:** T2 / G2, T12.1, and T13.1.

### `test/paths.test.ts`
- **Purpose:** Real-filesystem tests for user-path parsing and symbolic-link rejection.
- **Success check:** Covers accepted absolute/home paths, hostile path strings, malformed surrogate pairs, missing tails, and real directory/file symlinks.
- **Current assessment:** PASS
- **Evidence:** Proves exact macOS /tmp and /var compatibility canonicalization without matching similarly prefixed paths, plus existing hostile path/symlink policy.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1 and T15.3.

### `test/terminal.test.ts`
- **Purpose:** Real-process and policy tests for the terminal service, static shell adapter, audit boundary, polling, cancellation, timeout, retention, shutdown, validation, and dispatcher.
- **Success check:** Proves no PTY/stdin dependency; exact shell behavior; canonical symlink cwd and explicit environment; command/environment/cwd/output audit secrecy; poll availability during audit degradation; complete grandchild cleanup; completed-only eviction; all-running capacity rejection; and zero delayed residue.
- **Current assessment:** PASS
- **Evidence:** Proves start stays blocked while poll and cancel remain usable after audit storage failure, with all timeout/descendant/retention/shutdown coverage green.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T13.1 and T15.3.

### `test/watchdog.test.ts`
- **Purpose:** Live macOS tests for canonical executable identity, PID-reuse defenses, process-group scans, and absent PID handling.
- **Success check:** Identity changes in PID, start time, or executable all fail matching.
- **Current assessment:** PASS
- **Evidence:** Proves fixed C locale and hard timeout for watchdog subprocesses plus existing live identity/group behavior.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2 and T15.3.

### `tsconfig.json`
- **Purpose:** Strict NodeNext TypeScript compilation for source and tests.
- **Success check:** `npm run typecheck` and `npm run build` pass with Node types loaded explicitly.
- **Current assessment:** PASS
- **Evidence:** Added `types: ["node"]`; clean-install typecheck and build pass.
- **Last meaningful change:** T0 test-infrastructure correction, 2026-07-08.
- **Owning task or gate:** T0 / G1.
~~~~~

## Exact tracked-tree and repository statistics

- Audit baseline parent commit: `82412ef4753ba2bff4ea8e47d7cc52a13a0460ce`
- Branch: `planning/loom-v1-cavekit`
- Files represented in this dossier assembly: `74`
- TypeScript production modules: `26`
- TypeScript test modules: `22`
- Total repository bytes represented, excluding generated dossier self-bytes: `1107966`
- Total repository lines represented, excluding generated dossier self-lines: `27761`

The dossier’s own final SHA-256 cannot be embedded inside itself without creating a recursive change. All other rows record the bytes present at assembly time.

| Path | Bytes | Lines | SHA-256 |
|---|---:|---:|---|
| `.gitignore` | 66 | 6 | `844fc62152e4f94e2438711eedd8f2c37b1e99999adbc408451a9b3bc521e055` |
| `AGENTS.md` | 2010 | 33 | `fac305e7f7ab4f2e4521f5fcd5b75152bfbe880ca49dba2c8a9896aa49dd052d` |
| `ALGORITHM.md` | 887 | 17 | `a51c91e490dbdd2e56b345a59bfa8b7dae571172a9d170ee47188361b212e4fb` |
| `CHANGELOG.md` | 61748 | 850 | `bb4ab3fca62303ae929cdd985e9961835f513ce6fc3fef9cb80be03df6c3a4e2` |
| `EXTERNAL_AUDIT.md` | generated | generated | self-referential; compute after generation |
| `HANDOFF.md` | 9704 | 202 | `03b190ca755cbd2b066e63125d3fdf8e9f6b0401dff1bb7bc50b1c22870a703d` |
| `LICENSE` | 1071 | 21 | `2d69eab09385ed19112c2338c5e1ab27d5f4dbff3a04569df38201e03c2cd26a` |
| `NOTICE` | 1103 | 19 | `406e2befe8ef0d8493f4309922e7303b2ef030074b91a300e551aa3b9f37666d` |
| `README.md` | 8766 | 211 | `48d9cedb8f6bb831f45f35cdba15796dcb258b251338b5f89fa1be5495a977bc` |
| `REPO_MAP.md` | 53242 | 583 | `d175526b35de87e4a106d20f75de897b0a52601df44ae24b8d94aeb6a14e33ae` |
| `SPEC.md` | 15230 | 78 | `73d63297a4fd69b17a4d0169f458947eb01bfc9ffa3f2f1b787ce6f4dd367a52` |
| `docs/DEVELOPMENT.md` | 7427 | 201 | `7f5326ade05681754572f79a27ad17b1ed5257c3c3e0071dc5d2955ecb0759ff` |
| `docs/OPERATOR.md` | 9911 | 251 | `f86eafb19a47d6a6782a9c5867dc0fa46c566789f12b8c57357b07b3c4c5ad89` |
| `docs/RELEASE_CERTIFICATION.md` | 7029 | 132 | `b4f5de628cb1fa33772cfc33d88fceac26d51de22e998f59161bcc2922dc0da0` |
| `docs/SECURITY.md` | 15132 | 203 | `a2b1657980676b2fc41166b37ebeefb3caa9be65781c81aca38a03d8aaba3a3b` |
| `docs/certification-evidence.example.json` | 2751 | 90 | `43145e54b1013e7556304f92cf64676a2b81f546472ed2b7981ec9421c20e32e` |
| `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt` | 51389 | 656 | `b3397f473cce0f6f20a25ecd5dbb12ca9b61a9393695dc8cccc58ea3a98288b2` |
| `docs/release-evidence/README.md` | 3240 | 67 | `798b4d743a977de48adb8502328291ddf77a32164e25d84d2753d19f9f24ec82` |
| `docs/release-evidence/t15-local-package.md` | 2561 | 90 | `267f01b8955256749368afc89c72db66017473fbf94493b3cb548f3a829df271` |
| `docs/release-evidence/t15.3-adversarial-review.md` | 18840 | 279 | `3bb5e05a5de5c336df2d77e272e853cb37b6181810540beff4779ae4db3e2d80` |
| `package-lock.json` | 46834 | 1319 | `722002261fc0f37a5ccc7458744d0b1489eaab84c99741d40aabc7a2248732f8` |
| `package.json` | 1222 | 48 | `696449fde77e8fc4558647b687e268ba682078ca215322adfcbe431f2b5a5fdc` |
| `public/dashboard.css` | 1892 | 123 | `fc14809c0d31b32bbbd50792f49f7c4b185cfa17f662083f3aed5b80c24dfd48` |
| `public/dashboard.html` | 1887 | 51 | `692b143879438ebcffcf53551116a0e37bcca176fe54eca0c5c8e4842c41f174` |
| `public/dashboard.js` | 4006 | 119 | `dedee7daf7a09e1b4d032ba53bd11c36da6166fe4c774973a7637209508e9653` |
| `src/atomic-file.ts` | 5840 | 203 | `e280fd08d0e7974ffe807f0b535add18f0164fe42f0406a46af4f9fe8ca9a2c4` |
| `src/audit.ts` | 15745 | 525 | `db2aaf92ce270229a47c7ae22493ca6f94c4a5915c21b8b9006b21b994e04001` |
| `src/browser.ts` | 2900 | 113 | `2ef31ff6fc029a430d8ef2d46d6da116d3491f3a8ebf1a6407ea2482f3fc0aa5` |
| `src/browser/backend.ts` | 36988 | 817 | `dcea217e19205c4a299b6fbc31db34d59d00d8f6edeb343e2720be12bf49ac27` |
| `src/browser/setup.ts` | 17436 | 373 | `9eb0b00f03d8ae991402fdd51698b332072ef5c0da65405d3315e83db4772fdf` |
| `src/certification-cli.ts` | 5965 | 171 | `6b0b7c434c7b9be99a2c7aa7b49832a8a0e133cdc01fdbb198a93bf1957ff5c9` |
| `src/certification.ts` | 28068 | 779 | `7287fc344615fd6322db54d6d5e3da662ddf4aa0860fb8f31756a0e28422e659` |
| `src/child-wrapper.ts` | 6158 | 226 | `fb42217787d9c29713f278d26b86618ab46910acffedb823638b3b8be6033c68` |
| `src/cli.ts` | 11427 | 355 | `a8065e4ce5c17d5ed147ea2cbbc08f96933013d3fc7e22ae6ef6250f1abdd589` |
| `src/cloudflare.ts` | 57008 | 1568 | `49c7c2c9d2fd4549b9d5531f565f2433ceb80c30d192d498e8be0473c1ef0cd9` |
| `src/config.ts` | 12900 | 404 | `75746f33450e7df50fc72d7c93460ebbd10ab762a463c6c1303a7dca75fdc883` |
| `src/dashboard.ts` | 13328 | 395 | `6413fa5b48fed011c6cbf7a7ad4a753729608947559b6a2ecfa9c24154503a87` |
| `src/limits.ts` | 2005 | 40 | `c251dfd215e1c8125e5677ef66d0f3a5ed4718652af7827b1008b2dd6d7a000d` |
| `src/mcp.ts` | 28751 | 835 | `e42d4c0f101fe3f2936c8cc56af5a2b1764c88f86848d2481e205b5e531b89ff` |
| `src/oauth.ts` | 33082 | 969 | `467714c5c05f387e547cae92cea5c746cfa2b0d44305f740196035271955999a` |
| `src/output.ts` | 8421 | 295 | `11496289901e953f9a12b79397a41f39a3745b95b44eda17945fb4e5bb6ecc50` |
| `src/paths.ts` | 2980 | 97 | `2e89347c5dd9c37e716ca5c409129a7efea93ae155b43a5ecf168e270445c1db` |
| `src/process-manager.ts` | 18424 | 592 | `f80084b53fd6bf5931989e7793a519ca370e1c6ebee9aa935cda1c63546c4492` |
| `src/runtime.ts` | 44715 | 1233 | `63060735d81dfbe1141bfbc65f09fa3b76d88b471fc63d0ddf62b1f6301bdaa6` |
| `src/tools/browser.ts` | 19910 | 615 | `daddb23dae79a7299cb813d6e0fca066ceb5ef442f71cb61fec7f88cd0153748` |
| `src/tools/files.ts` | 15857 | 491 | `efbfcb244d887941bc0560fed59876a42438abd6840920dcb58ea1aff3c0852f` |
| `src/tools/memory.ts` | 32202 | 999 | `30c7212cabe30ee9f3040717772cea853f623a5e1b892db8d35fb12068d42d45` |
| `src/tools/register.ts` | 7388 | 258 | `2a353930f32abb22f507a2bcac93dade45fa2821508ca8d43a663aff7e31d40c` |
| `src/tools/skills.ts` | 26542 | 852 | `787a45e8f210e66aa97ee56d8c414936b0cdd7a0052afe193fed7a2a20617aeb` |
| `src/tools/terminal.ts` | 15773 | 468 | `6fdb2e93165674807398f8efa59f51e6b904480f2d9f9341b19c5360f9cccbdd` |
| `src/watchdog.ts` | 5237 | 178 | `0455e9edca094f6e30c4da8960cd49e9c4e97aa38d9ba2cfb4f0d56a0532c3c9` |
| `test/atomic-file.test.ts` | 3386 | 89 | `2f1ab4aac4c436cbc2af97bb75dc832234b3bd6c9b5699df985a21f645cb05a3` |
| `test/audit.test.ts` | 7058 | 209 | `059ed81eea25c35a3b69745ca32c2835398f6d49789babd3c26129c2b69620e7` |
| `test/browser.test.ts` | 32997 | 887 | `4769a9f5719ca0a6d8ebc2e625417ac25921f56e77eb821e2ccbad48553105e1` |
| `test/certification-cli.test.ts` | 7410 | 212 | `0c7845a817b94b6dca54c882dd717456107573d04897073199be6178512cb84f` |
| `test/certification.test.ts` | 20068 | 502 | `79a00daff8bbb6215a997ca237dd05bd3dd2685fb7d32f4f1a9713bfd4c7287b` |
| `test/cli.test.ts` | 13653 | 385 | `52d5f708f696b13afbe17a362da8c2cf18bc16e1fe699d93da854cd2ebab5d73` |
| `test/cloudflare.test.ts` | 56804 | 1596 | `15657e0da080598c6a56a3313837744f4272c388bc19313dcd8eba17500b336a` |
| `test/config.test.ts` | 8008 | 249 | `7c874f781b78f9d7fa49c4f4147ffa97fa0447417a653062011dbc32790c4d3d` |
| `test/dashboard.test.ts` | 6382 | 175 | `a50feada0763014dd0c1fcd849327ca0f5ce86f1cbb2503b7c466fe96d519c95` |
| `test/docs.test.ts` | 7028 | 190 | `720686e252c65f5e8d460a3419113624b23fe3585243f8ccdac120a1a8e28df0` |
| `test/files.test.ts` | 13940 | 387 | `82d0a14ee5d5c24e234b0c7c4984438f24a72965ac1e511d8269577a3c93cc57` |
| `test/limits.test.ts` | 1835 | 49 | `c9f5fe917f000a4d370cebcca685d32d56c5a5b375261f1ddac25489bf8cb533` |
| `test/mcp.test.ts` | 21438 | 586 | `ef211625c713e46205e6da2d3627f271f3cfd9c7e40cbd5392ad3745dfcc20e1` |
| `test/memory.test.ts` | 14625 | 363 | `d517d1329de193de50ab808d47ca080939033272501939165fc0c6bfa061573a` |
| `test/oauth.test.ts` | 16506 | 422 | `fcefa6cb4c5820cdc251342a60b11a29bd683d1e10746c82594227a630e2718d` |
| `test/output.test.ts` | 3477 | 107 | `13a35e47c027f245642bb4febe41a5e21f23765e023b853e67ac270f357eb15a` |
| `test/paths.test.ts` | 2398 | 58 | `6086a03292d306f7371bc5f68a9907770de7030f5c5b560561027904b84c985c` |
| `test/process-manager.test.ts` | 11840 | 354 | `94f243e8ed1750481416e62994153ee8d64c9ee41631846aefdef6c65f74a21a` |
| `test/runtime.test.ts` | 28997 | 742 | `201d8c767ccfd4a39c668d0bfe5b14dfbfffb7bfd9b971ddbc6f6a6bca13ab30` |
| `test/skills.test.ts` | 11703 | 327 | `53a22d36bc572ee099eb2ba89f3759739d9969aa24cd99316abae77dc76bae1e` |
| `test/terminal.test.ts` | 12402 | 288 | `2552dea595918fec9101638528dbca7d1e6e8bafd76ed579995a09e9cd63c612` |
| `test/watchdog.test.ts` | 2500 | 64 | `3f6278064352d624375b185db39eee9da1609b4b4ee17c63998c786e019fbdac` |
| `tsconfig.json` | 513 | 20 | `5777b2839bf300397f84e5e85fc12743a362b47b64f43659964b1ef1137e9897` |

### Exact represented path list

```text
.gitignore
AGENTS.md
ALGORITHM.md
CHANGELOG.md
EXTERNAL_AUDIT.md
HANDOFF.md
LICENSE
NOTICE
README.md
REPO_MAP.md
SPEC.md
docs/DEVELOPMENT.md
docs/OPERATOR.md
docs/RELEASE_CERTIFICATION.md
docs/SECURITY.md
docs/certification-evidence.example.json
docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt
docs/release-evidence/README.md
docs/release-evidence/t15-local-package.md
docs/release-evidence/t15.3-adversarial-review.md
package-lock.json
package.json
public/dashboard.css
public/dashboard.html
public/dashboard.js
src/atomic-file.ts
src/audit.ts
src/browser.ts
src/browser/backend.ts
src/browser/setup.ts
src/certification-cli.ts
src/certification.ts
src/child-wrapper.ts
src/cli.ts
src/cloudflare.ts
src/config.ts
src/dashboard.ts
src/limits.ts
src/mcp.ts
src/oauth.ts
src/output.ts
src/paths.ts
src/process-manager.ts
src/runtime.ts
src/tools/browser.ts
src/tools/files.ts
src/tools/memory.ts
src/tools/register.ts
src/tools/skills.ts
src/tools/terminal.ts
src/watchdog.ts
test/atomic-file.test.ts
test/audit.test.ts
test/browser.test.ts
test/certification-cli.test.ts
test/certification.test.ts
test/cli.test.ts
test/cloudflare.test.ts
test/config.test.ts
test/dashboard.test.ts
test/docs.test.ts
test/files.test.ts
test/limits.test.ts
test/mcp.test.ts
test/memory.test.ts
test/oauth.test.ts
test/output.test.ts
test/paths.test.ts
test/process-manager.test.ts
test/runtime.test.ts
test/skills.test.ts
test/terminal.test.ts
test/watchdog.test.ts
tsconfig.json
```

## Generated source and export inventory

This inventory is generated directly from `src/**/*.ts`. It is an orientation index, not a substitute for reading the implementations. “External imports” lists non-relative, non-Node specifiers used by each module.

### `src/atomic-file.ts`

- Lines: `203`
- SHA-256: `e280fd08d0e7974ffe807f0b535add18f0164fe42f0406a46af4f9fe8ca9a2c4`
- Exported symbols: `AtomicFileConflictError`, `AtomicFileError`, `AtomicWriteOptions`, `AtomicWriteResult`, `atomicWriteFile`
- External imports: none

### `src/audit.ts`

- Lines: `525`
- SHA-256: `db2aaf92ce270229a47c7ae22493ca6f94c4a5915c21b8b9006b21b994e04001`
- Exported symbols: `AuditFinishStatus`, `AuditLogger`, `AuditLoggerOptions`, `AuditReceipt`, `AuditUnavailableError`
- External imports: none

### `src/browser.ts`

- Lines: `113`
- SHA-256: `2ef31ff6fc029a430d8ef2d46d6da116d3491f3a8ebf1a6407ea2482f3fc0aa5`
- Exported symbols: `BrowserBackend`, `BrowserEvaluationResult`, `BrowserEvaluationTimeoutError`, `BrowserExecutableError`, `BrowserNotReadyError`, `BrowserScreenshotResult`, `BrowserSnapshotResult`, `BrowserStatusResult`, `BrowserTab`, `BrowserTabNotFoundError`, `BrowserToolError`
- External imports: none

### `src/browser/backend.ts`

- Lines: `817`
- SHA-256: `dcea217e19205c4a299b6fbc31db34d59d00d8f6edeb343e2720be12bf49ac27`
- Exported symbols: `BrowserLockIdentity`, `ManagedChromiumBackend`, `ManagedChromiumBackendOptions`, `RecoverBrowserProfileLocksOptions`, `closeManagedChromium`, `recoverBrowserProfileLocks`, `runBoundedEvaluation`, `runBoundedPageOperation`, `writeBrowserLock`, `writeExclusiveReadable`
- External imports: `playwright-core`

### `src/browser/setup.ts`

- Lines: `373`
- SHA-256: `9eb0b00f03d8ae991402fdd51698b332072ef5c0da65405d3315e83db4772fdf`
- Exported symbols: `ChromiumInstallManifest`, `InstallPinnedChromiumOptions`, `PINNED_CHROMIUM_REVISION`, `PINNED_CHROMIUM_VERSION`, `PINNED_PLAYWRIGHT_VERSION`, `VerifiedChromiumExecutable`, `hashChromiumExecutable`, `installPinnedChromium`, `pinnedChromiumExecutableSha256For`, `readChromiumInstallManifest`, `verifyChromiumExecutable`, `verifyChromiumLaunch`
- External imports: none

### `src/certification-cli.ts`

- Lines: `171`
- SHA-256: `6b0b7c434c7b9be99a2c7aa7b49832a8a0e133cdc01fdbb198a93bf1957ff5c9`
- Exported symbols: `CERTIFICATION_CLI_USAGE`, `CertificationCliDependencies`, `CertificationCliError`, `runCertificationCli`
- External imports: none

### `src/certification.ts`

- Lines: `779`
- SHA-256: `7287fc344615fd6322db54d6d5e3da662ddf4aa0860fb8f31756a0e28422e659`
- Exported symbols: `CERTIFICATION_VERSION`, `CertificationCommandResult`, `CertificationCommandRunner`, `CertificationEvidenceError`, `CertificationGateResult`, `CertificationReport`, `CollectDeterministicCertificationOptions`, `DeterministicCertificationEvidence`, `EXPECTED_LOOM_TOOLS`, `ExternalCertificationEvidence`, `collectDeterministicCertificationEvidence`, `evaluateCertification`, `parseNpmPackDryRun`, `runCertificationCommand`, `validateExternalCertificationEvidence`, `verifyExternalCertificationArtifacts`, `writeCertificationReport`
- External imports: `zod`

### `src/child-wrapper.ts`

- Lines: `226`
- SHA-256: `fb42217787d9c29713f278d26b86618ab46910acffedb823638b3b8be6033c68`
- Exported symbols: none; executable or internal-only module
- External imports: none

### `src/cli.ts`

- Lines: `355`
- SHA-256: `a8065e4ce5c17d5ed147ea2cbbc08f96933013d3fc7e22ae6ef6250f1abdd589`
- Exported symbols: `CLI_USAGE`, `CliCommandDependencies`, `LaunchYoloDependencies`, `launchYolo`, `runCliCommand`, `setupBrowser`
- External imports: none

### `src/cloudflare.ts`

- Lines: `1568`
- SHA-256: `49c7c2c9d2fd4549b9d5531f565f2433ceb80c30d192d498e8be0473c1ef0cd9`
- Exported symbols: `CLOUDFLARED_DOWNLOAD_TIMEOUT_MS`, `CLOUDFLARED_VERSION`, `CloudflaredError`, `CloudflaredExecutableError`, `CloudflaredInstallError`, `CloudflaredLaunchError`, `CloudflaredRelease`, `DiscoverCloudflaredOnPathInput`, `InstallCloudflaredReleaseOptions`, `NamedTunnelAuthError`, `NamedTunnelConfigError`, `NamedTunnelManager`, `NamedTunnelManagerOptions`, `NamedTunnelReadyResult`, `NamedTunnelStartupError`, `NamedTunnelStatus`, `QuickTunnelConfigError`, `QuickTunnelManager`, `QuickTunnelManagerOptions`, `QuickTunnelProcess`, `QuickTunnelReadyResult`, `QuickTunnelStartupError`, `QuickTunnelStatus`, `QuickTunnelUnsafeUrlError`, `StartCloudflaredOptions`, `ValidateNamedTunnelConfigurationInput`, `ValidatedNamedTunnelConfiguration`, `VerifiedCloudflaredExecutable`, `VerifyCloudflaredExecutableInput`, `assertQuickTunnelConfigCompatible`, `cloudflaredReleaseFor`, `discoverCloudflaredOnPath`, `hashCloudflaredExecutable`, `installCloudflaredRelease`, `quickTunnelOriginFromOutput`, `startCloudflared`, `validateNamedTunnelConfiguration`, `verifyCloudflaredExecutable`
- External imports: none

### `src/config.ts`

- Lines: `404`
- SHA-256: `75746f33450e7df50fc72d7c93460ebbd10ab762a463c6c1303a7dca75fdc883`
- Exported symbols: `ConfigError`, `DEFAULT_CONFIG`, `LoomConfig`, `NamedTunnelConfig`, `QuickTunnelConfig`, `ResetConfigResult`, `RuntimeIdentity`, `checkConfig`, `initializeState`, `readRuntimeLock`, `resetConfig`, `runtimeIdentityMatches`, `writeConfig`, `writeRuntimeLock`
- External imports: `zod`

### `src/dashboard.ts`

- Lines: `395`
- SHA-256: `6413fa5b48fed011c6cbf7a7ad4a753729608947559b6a2ecfa9c24154503a87`
- Exported symbols: `DashboardActions`, `DashboardError`, `LoomDashboardServer`, `LoomDashboardServerOptions`
- External imports: `express`

### `src/limits.ts`

- Lines: `40`
- SHA-256: `c251dfd215e1c8125e5677ef66d0f3a5ed4718652af7827b1008b2dd6d7a000d`
- Exported symbols: `AUDIT_RETENTION_DAYS`, `AUDIT_START_DEADLINE_MS`, `AUTHORIZATION_ATTEMPT_LIMIT`, `AUTHORIZATION_ATTEMPT_WINDOW_MS`, `DASHBOARD_BOOTSTRAP_NONCE_TTL_MS`, `DEFAULT_TERMINAL_POLL_BYTES`, `MAX_AUDIT_FILE_BYTES`, `MAX_BROWSER_SNAPSHOT_BYTES`, `MAX_BROWSER_TABS`, `MAX_CATALOG_DEPTH`, `MAX_EDIT_WINDOW_BYTES`, `MAX_FILES_PER_ROOT`, `MAX_FILE_BYTES_PER_ROOT`, `MAX_MCP_REQUEST_BYTES`, `MAX_SCAN_SECONDS`, `MAX_SCREENSHOT_BYTES`, `MAX_TERMINAL_COMMAND_BYTES`, `MAX_TERMINAL_ENVIRONMENT_ENTRIES`, `MAX_TERMINAL_ENVIRONMENT_KEY_BYTES`, `MAX_TERMINAL_ENVIRONMENT_VALUE_BYTES`, `MAX_TERMINAL_JOB_ID_BYTES`, `MAX_TERMINAL_POLL_BYTES`, `MAX_TERMINAL_RETAINED_JOBS`, `MAX_TERMINAL_TIMEOUT_MS`, `MAX_TERMINAL_TOTAL_ENVIRONMENT_BYTES`, `MAX_TERMINAL_WAIT_MS`, `MAX_TOTAL_INDEXED_BYTES`, `MAX_WRITE_BYTES`, `NAMED_TUNNEL_BACKOFF_BASE_MS`, `NAMED_TUNNEL_BACKOFF_MAX_MS`, `NAMED_TUNNEL_MAX_RETRIES`, `NAMED_TUNNEL_READY_DEADLINE_MS`, `QUICK_TUNNEL_URL_DEADLINE_MS`, `SHUTDOWN_ABSOLUTE_DEADLINE_MS`, `SHUTDOWN_SOFT_GRACE_MS`, `TERMINAL_POLL_INTERVAL_MS`, `WATCHDOG_COMMAND_TIMEOUT_MS`, `WATCHDOG_HEARTBEAT_INTERVAL_MS`, `WATCHDOG_MISSED_HEARTBEAT_LIMIT`, `WATCHDOG_PROCESS_SCAN_FALLBACK_MS`
- External imports: none

### `src/mcp.ts`

- Lines: `835`
- SHA-256: `e42d4c0f101fe3f2936c8cc56af5a2b1764c88f86848d2481e205b5e531b89ff`
- Exported symbols: `LoomMcpHttpServer`, `LoomMcpHttpServerOptions`, `McpHttpError`
- External imports: `@modelcontextprotocol/sdk`, `express`

### `src/oauth.ts`

- Lines: `969`
- SHA-256: `467714c5c05f387e547cae92cea5c746cfa2b0d44305f740196035271955999a`
- Exported symbols: `AccessTokenPrincipal`, `AuthStore`, `AuthStoreOptions`, `ConsumeAuthorizationTransactionInput`, `ConsumedAuthorizationTransaction`, `CreateAuthorizationTransactionInput`, `CreatedAuthorizationTransaction`, `EndpointBindingResult`, `ExchangeAuthorizationCodeInput`, `IssueAuthorizationCodeInput`, `IssuedAuthorizationCode`, `OAuthError`, `OAuthTokenResponse`, `OpenAuthStoreResult`, `RefreshAccessTokenInput`, `RegisterClientInput`, `RegisteredClient`, `ResetOwnerCredentialResult`, `RevokeClientTokenInput`, `ValidateAccessTokenOptions`
- External imports: `zod`

### `src/output.ts`

- Lines: `295`
- SHA-256: `11496289901e953f9a12b79397a41f39a3745b95b44eda17945fb4e5bb6ecc50`
- Exported symbols: `BoundedOutput`, `OutputRead`, `OutputSegment`, `OutputSnapshot`, `OutputSource`, `OutputState`
- External imports: none

### `src/paths.ts`

- Lines: `97`
- SHA-256: `2e89347c5dd9c37e716ca5c409129a7efea93ae155b43a5ecf168e270445c1db`
- Exported symbols: `PathPolicyError`, `assertNoSymlinkComponents`, `resolveUserPath`
- External imports: none

### `src/process-manager.ts`

- Lines: `592`
- SHA-256: `f80084b53fd6bf5931989e7793a519ca370e1c6ebee9aa935cda1c63546c4492`
- Exported symbols: `ManagedProcess`, `ManagedProcessMetadata`, `ManagedProcessResult`, `ProcessManager`, `ProcessManagerError`, `ProcessManagerOptions`, `StartProcessOptions`
- External imports: none

### `src/runtime.ts`

- Lines: `1233`
- SHA-256: `63060735d81dfbe1141bfbc65f09fa3b76d88b471fc63d0ddf62b1f6301bdaa6`
- Exported symbols: `CreateDefaultRuntimeOptions`, `CreatedDefaultRuntime`, `FULL_ACCESS_WARNING`, `ForegroundLoomRuntime`, `ForegroundLoomRuntimeOptions`, `ForegroundRuntimeStatus`, `RuntimeBrowserLifecycle`, `RuntimeCurrentState`, `RuntimeEndpointError`, `RuntimeError`, `RuntimeLock`, `RuntimeLockOptions`, `RuntimeMcpReadinessServer`, `RuntimeReadiness`, `RuntimeReadinessOptions`, `RuntimeShutdownDeadlineError`, `RuntimeSignalSource`, `RuntimeStateError`, `RuntimeStoppedError`, `RuntimeTunnelLifecycle`, `RuntimeTunnelMode`, `canonicalPublicEndpoint`, `createDefaultForegroundRuntime`, `formatForegroundRuntimeStatus`, `formatRuntimeStatusBlock`, `runRuntimeForeground`, `validateLocalMcpEndpoint`
- External imports: `zod`

### `src/tools/browser.ts`

- Lines: `615`
- SHA-256: `daddb23dae79a7299cb813d6e0fca066ceb5ef442f71cb61fec7f88cd0153748`
- Exported symbols: `BrowserEvaluationTimeoutError`, `BrowserExecutableError`, `BrowserNotReadyError`, `BrowserTabNotFoundError`, `BrowserToolError`, `BrowserToolService`, `BrowserToolServiceOptions`, `createBrowserToolDispatcher`
- External imports: `@modelcontextprotocol/sdk`

### `src/tools/files.ts`

- Lines: `491`
- SHA-256: `efbfcb244d887941bc0560fed59876a42438abd6840920dcb58ea1aff3c0852f`
- Exported symbols: `EditFileInput`, `FileEditConflictError`, `FileToolError`, `FileToolService`, `FileToolServiceOptions`, `ReadFileInput`, `WriteFileInput`, `createFileToolDispatcher`
- External imports: `@modelcontextprotocol/sdk`

### `src/tools/memory.ts`

- Lines: `999`
- SHA-256: `30c7212cabe30ee9f3040717772cea853f623a5e1b892db8d35fb12068d42d45`
- Exported symbols: `DeleteMemoryInput`, `MemoryConflictError`, `MemoryDiagnostic`, `MemorySnapshot`, `MemoryStoreConfigError`, `MemoryStoreLimitError`, `MemoryStoreLimits`, `MemoryStoreService`, `MemoryStoreServiceOptions`, `MemorySummary`, `ReadMemoryInput`, `SaveMemoryInput`, `SearchMemoryInput`, `createMemoryToolDispatcher`
- External imports: `@modelcontextprotocol/sdk`

### `src/tools/register.ts`

- Lines: `258`
- SHA-256: `2a353930f32abb22f507a2bcac93dade45fa2821508ca8d43a663aff7e31d40c`
- Exported symbols: `LOOM_TOOL_NAMES`, `LoomToolDispatcher`, `LoomToolName`, `registerLoomTools`
- External imports: `@modelcontextprotocol/sdk`, `zod`

### `src/tools/skills.ts`

- Lines: `852`
- SHA-256: `787a45e8f210e66aa97ee56d8c414936b0cdd7a0052afe193fed7a2a20617aeb`
- Exported symbols: `ReadSkillInput`, `SearchSkillsInput`, `SkillCatalogConfigError`, `SkillCatalogLimitError`, `SkillCatalogLimits`, `SkillCatalogService`, `SkillCatalogServiceOptions`, `SkillCatalogSnapshot`, `SkillDiagnostic`, `SkillRoot`, `SkillSummary`, `createSkillToolDispatcher`
- External imports: `@modelcontextprotocol/sdk`

### `src/tools/terminal.ts`

- Lines: `468`
- SHA-256: `6fdb2e93165674807398f8efa59f51e6b904480f2d9f9341b19c5360f9cccbdd`
- Exported symbols: `TerminalCancelInput`, `TerminalCapacityError`, `TerminalJobNotFoundError`, `TerminalPollInput`, `TerminalStartInput`, `TerminalToolError`, `TerminalToolService`, `TerminalToolServiceOptions`, `createTerminalToolDispatcher`
- External imports: `@modelcontextprotocol/sdk`

### `src/watchdog.ts`

- Lines: `178`
- SHA-256: `0455e9edca094f6e30c4da8960cd49e9c4e97aa38d9ba2cfb4f0d56a0532c3c9`
- Exported symbols: `ProcessObservation`, `ProcessTableEntry`, `WatchdogCommandOptions`, `WatchdogError`, `inspectProcess`, `listProcessGroupMembers`, `observableIdentityMatches`, `runWatchdogCommand`
- External imports: none

## Generated executable test inventory

### `test/atomic-file.test.ts` — 5 tests

1. atomicWriteFile creates a private file and leaves no temporary residue
2. atomicWriteFile preserves an existing regular file mode
3. atomicWriteFile rejects an expected hash conflict without changing the file
4. concurrent writes to one path serialize so one expected-hash writer wins
5. atomicWriteFile rejects symbolic-link targets and oversized content

### `test/audit.test.ts` — 8 tests

1. audit startup repairs the current owner directory to mode 0700
2. mutation start is durable before resolving and finish records status/duration
3. saturated mutation-start queue fails closed and marks audit degraded
4. mutation start fails closed when durable acceptance exceeds its deadline
5. write failure rejects mutations while read audit remains non-throwing
6. serialized rotation produces complete parseable JSONL records
7. startup retention removes only audit files older than the fixed window
8. audit metadata redacts commands, secrets, content, environment, and token-like values

### `test/browser.test.ts` — 19 tests

1. Chromium executable verification requires a stable nonsymlink executable and exact SHA-256
2. Chromium launch verification uses a wrapper-owned CDP endpoint and cleans the process tree
3. pinned Chromium setup resolves the local Playwright CLI independently of cwd
4. pinned Chromium setup installs through the local Playwright CLI, verifies launch, and atomically writes the manifest
5. pinned Chromium setup restores the previous installation when promoted verification fails
6. browser lock recovery refuses live or mismatched identities and removes only verified stale profile locks
7. exclusive browser download persistence never overwrites and cleans failed partial files
8. mutating browser actions are durably audited before backend calls without leaking URL queries, selectors, typed text, or expressions
9. audit failure blocks capability-increasing browser mutations but preserves tab close and read-only actions
10. read results keep page/evaluation/screenshot content out of structured metadata and audit bytes
11. browser input validation rejects unsafe URLs/origins, malformed tabs, unsupported permissions, and excessive bounds before backend calls
12. backend not-ready and missing-tab errors remain typed at the tool boundary
13. browser dispatcher handles every browser action and delegates the other six tools
14. managed Chromium shutdown requests CDP close and waits for natural process exit
15. managed Chromium shutdown disconnects and cancels when graceful exit exceeds its deadline
16. bounded page operations recover a tab when an internal snapshot evaluation hangs
17. bounded evaluation closes only the timed-out page and verifies surviving browser health
18. bounded evaluation restarts the browser only when timed-out page cleanup fails
19. bounded evaluation restarts the browser when surviving browser health fails

### `test/certification-cli.test.ts` — 5 tests

1. certification CLI writes a blocked report and returns 2 without external evidence
2. certification CLI validates external evidence but remains blocked pending human review
3. certification CLI returns 1 for deterministic failure and rejects unsafe arguments
4. certification CLI executes when invoked through a package-bin symlink
5. certification CLI help has no side effects

### `test/certification.test.ts` — 11 tests

1. deterministic success without external evidence remains blocked and never certified
2. deterministic failure makes the report fail instead of blocked
3. self-reported external evidence remains blocked pending human review
4. external evidence rejects SHA mismatch, missing tools, extra secret fields, and unstable endpoints
5. G5 evidence does not require a Quick Tunnel smoke test
6. external artifact verification hashes stable private regular files and rejects mismatch or symlink
7. certification report writes private canonical JSON and rejects symlink targets
8. deterministic collector runs every repository gate and stores summaries without command output
9. deterministic collector records failures and residue without throwing away later evidence
10. package manifest exposes the certification command and an explicit release allowlist
11. npm pack dry-run parser requires release files and rejects private or development-only content

### `test/cli.test.ts` — 14 tests

1. package metadata pins the supported runtime and dependencies
2. --version prints the package version
3. CLI executes when invoked through a package-bin symlink
4. --help exposes the explicit YOLO launch command and support floor
5. browser setup initializes the dedicated install directory and invokes the pinned installer
6. launchYolo writes the local warning and first owner password before foreground execution
7. launchYolo stops an acquired runtime when the local terminal cannot close
8. explicit YOLO launch routes to the injected foreground launcher exactly once
9. YOLO launch refuses to create runtime state without a local terminal
10. plain launch refuses to start unrestricted access
11. config check validates the default state without modifying invalid configuration
12. config reset requires and accepts local terminal confirmation
13. auth reset refuses while a live Loom runtime lock matches the process table
14. auth reset uses local terminal confirmation, prints the new password there, and preserves non-auth state

### `test/cloudflare.test.ts` — 30 tests

1. pinned Cloudflared release metadata is architecture-specific and exact
2. Cloudflared verification canonicalizes a symlink and requires exact hash and version
3. PATH discovery verifies the first Cloudflared match and reports its canonical path and version
4. Cloudflared installer follows bounded HTTPS redirects and atomically promotes a verified executable
5. Cloudflared installer rejects a symlinked parent before creating installation state
6. Cloudflared installer extracts the pinned single-file archive with the system tar boundary
7. Cloudflared installer enforces a bounded configurable download deadline without residue
8. Cloudflared installer rejects insecure or corrupt downloads without replacing the prior binary
9. Cloudflared launch re-verifies the executable and injects fixed direct argv flags
10. Quick Tunnel parser accepts only strict trycloudflare origins and config conflicts fail closed
11. Named Tunnel validates a stable hostname and matching private Cloudflare authentication files
12. Named Tunnel manager launches exact ephemeral-origin argv and publishes stable production status
13. Named Tunnel stable endpoints preserve OAuth generation and owner password across restart
14. Named Tunnel retries only transient failures with exponential backoff
15. Named Tunnel stops after five transient retries and caps exponential backoff
16. Named Tunnel authentication and configuration failures stop immediately without fallback
17. Named Tunnel validates files before audit and audit failure blocks launch
18. Named Tunnel readiness timeout cleans every attempt and never falls back to Quick Tunnel
19. Named Tunnel stop during startup cancels the active attempt without retry
20. Named Tunnel revalidates authentication files before every retry
21. Named Tunnel cleanup failure blocks retry and remains fail closed
22. Named Tunnel ignores benign missing persistent-config notices
23. Named Tunnel static validation rejects option-like names and malformed credentials
24. Quick Tunnel manager parses split output, waits for registration, audits safely, and reports non-production status
25. Quick Tunnel permits exactly one transient recreation and cleans both attempts
26. Quick Tunnel rejects malformed candidate URLs without recreation
27. Quick Tunnel enforces the 15-second deadline on each of at most two attempts
28. Quick Tunnel URL changes invalidate endpoint OAuth state without rotating the owner password
29. Quick Tunnel recreates once after a transient process-start failure
30. Quick Tunnel audit failure blocks process launch

### `test/config.test.ts` — 8 tests

1. initializeState creates the private Loom directory tree and default config
2. initializeState repairs owner-controlled modes and rejects a symlink state root
3. checkConfig validates strictly without modifying files
4. checkConfig rejects unknown keys, relative roots, and incomplete named tunnels
5. resetConfig preserves invalid bytes with a timestamp and writes private defaults
6. runtime lock records are private, strict, and round-trip every identity field
7. runtime lock identity requires every PID-reuse defense field to match
8. writeConfig validates strictly, canonicalizes named hostname, and replaces privately

### `test/dashboard.test.ts` — 3 tests

1. dashboard bootstrap lifetime is unaffected by wall-clock jumps
2. dashboard bootstrap is loopback-only, single-use, strict-headered, session-bound, and CSRF protected
3. dashboard rejects incorrect Host and exposes only allowlisted actions

### `test/docs.test.ts` — 5 tests

1. CLI usage and operator documentation contain exactly the real public commands
2. documentation covers the locked security and operating contract without placeholders
3. external audit dossier is self-contained and represents every mapped tracked file
4. security and operator documents disclose adversarial content and residual unrestricted-agent risks
5. npm package metadata includes runtime assets, documentation, license, and notice

### `test/files.test.ts` — 12 tests

1. loom_read returns UTF-8 text, a stable full-file hash, and exact byte-range metadata
2. loom_read detects PNG, JPEG, GIF, and WebP by magic bytes rather than extension
3. loom_read rejects unsupported binary by default, allows explicit base64, and enforces size limits
4. file tools reject relative paths at their public error boundary
5. final symlinks to FIFOs fail promptly without blocking the file-read worker
6. file reads follow a stable final symlink while mutations and parent symlinks remain rejected
7. loom_write is audited before mutation, atomic, private, and supports optimistic conflicts
8. audit failure prevents write and edit mutations from touching the file
9. loom_edit requires exact unambiguous matches unless replaceAll is explicit
10. concurrent edits sharing one expected hash serialize so exactly one succeeds
11. loom_edit detects stale expected hashes and enforces byte limits
12. file dispatcher routes read/write/edit and delegates every other Loom tool unchanged

### `test/limits.test.ts` — 1 tests

1. central limits match the approved Loom v1 contract

### `test/mcp.test.ts` — 9 tests

1. MCP remains deterministically NOT_READY before public endpoint binding
2. MCP JSON parsing rejects oversized bodies before SDK or tool-schema handling
3. bound server publishes exact metadata and an unauthenticated MCP challenge
4. owner-password authorization attempts are globally bounded by a monotonic window
5. standard HTTP OAuth registration, authorization, exchange, refresh, and revocation work
6. a real SDK client sees exactly seven Loom tools and can call the injected dispatcher
7. same endpoint preserves sessions while an endpoint change closes sessions and invalidates tokens
8. session IDs are validated, client-bound, bounded, and reported with structured errors
9. inactive sessions are closed and removed within the configured bound

### `test/memory.test.ts` — 13 tests

1. save creates a private stable-ID Markdown memory, publishes it, and never audits title/content
2. search ranking is deterministic and favors title over content-only matches
3. rescan in a new service preserves IDs and content across process-style reopen
4. audit failure blocks save and delete before visible memory state changes
5. delete removes the visible file atomically, updates the snapshot, and leaves no tombstone
6. delete detects external modification and preserves both file and prior snapshot
7. concurrent saves serialize without lost updates or ID collisions
8. unsafe symlink and hard resource failures abort rescan without publishing partial state
9. file and aggregate byte limits are enforced without publishing partial rescans
10. a symlinked memory root is rejected before any catalog generation is published
11. tombstone recovery refuses to remove a path replaced after verification
12. invalid memory files are diagnosed and stale tombstones are safely recovered
13. memory dispatcher handles every memory action and delegates other Loom tools

### `test/oauth.test.ts` — 11 tests

1. owner password is created once, scrypt-verified, private, and persistent across reopen
2. successful owner authorization upgrades a legacy scrypt hash in place
3. authorization code exchange issues endpoint-bound access and refresh tokens
4. refresh-token rotation preserves one absolute family expiration
5. codes are single-use and reject wrong verifier, redirect, resource, and client secret
6. refresh rotates both tokens, prevents replay, and cannot expand scopes or change resource
7. expiry and revocation reject codes, access tokens, and refresh tokens
8. endpoint change invalidates clients and tokens without rotating owner password
9. owner reset changes only the credential, revokes OAuth state, and preserves endpoint binding
10. metadata is exact for the bound MCP resource and secrets are hashed at rest
11. revokeAllOAuth preserves owner credential and endpoint while invalidating OAuth state

### `test/output.test.ts` — 6 tests

1. bounded output preserves stdout/stderr order and sanitizes terminal controls
2. binary output is replaced by a deterministic marker
3. truncation retains exact head and tail and reports cursor gaps
4. cursor pagination splits segments without losing source order
5. UTF-8 truncation never splits a code point
6. terminal output records completed, cancelled, and timed-out states

### `test/paths.test.ts` — 4 tests

1. resolveUserPath accepts only absolute paths or ~/ paths
2. resolveUserPath rejects malformed Unicode surrogate sequences
3. assertNoSymlinkComponents allows a missing tail under real directories
4. assertNoSymlinkComponents rejects symlink parents and final symlinks

### `test/process-manager.test.ts` — 10 tests

1. managed processes have no PTY or usable stdin and capture both output streams
2. wrapper and target are placed in one dedicated process group
3. cancellation terminates the complete process group including grandchildren
4. rapid natural exits never lose the wrapper ready handshake
5. normal target exit still cleans background descendants in its group
6. cancellation escalates to SIGKILL when the target ignores SIGTERM
7. watchdog removes the full process group after the manager is SIGKILLed
8. timeouts mark the job timed-out and leave no process-group members
9. transient EPERM during owned-group SIGKILL is revalidated and retried
10. persistent EPERM during owned-group SIGKILL fails closed at the shutdown deadline

### `test/runtime.test.ts` — 18 tests

1. runtime readiness validates exact loopback and public MCP endpoints
2. runtime readiness persists NOT_READY then binds canonical public resource and writes private ready state
3. invalid public binding is rejected before MCP binding or runtime-state replacement
4. real MCP route transitions from NOT_READY to endpoint-bound OAuth through runtime readiness
5. runtime readiness validates the runtime-state target before public MCP binding
6. runtime readiness rejects a symlinked current state before public MCP binding
7. foreground runtime starts real local services, publishes once, and cleans in reverse order
8. runtime startup failure cleans every started component and never publishes public readiness
9. foreground signal runner handles SIGTERM-style stop and removes runtime ownership
10. signal during tunnel startup prevents public readiness and process recreation
11. direct stop during tunnel startup rejects the start promise with RuntimeStoppedError
12. shutdown deadline is real and preserves runtime ownership when cleanup is uncertain
13. runtime lock rejects a live owner and refuses to remove a replaced lock
14. runtime preserves ownership when current state is replaced after readiness
15. default runtime factory assembles the production graph without network when explicit lifecycles are supplied
16. default runtime degrades browser tools when the pinned browser manifest is absent
17. default runtime degrades a corrupt pinned-browser manifest without disabling non-browser tools
18. default runtime factory releases its lock when component construction fails

### `test/skills.test.ts` — 10 tests

1. skill discovery is deterministic, namespaced, duplicate-aware, and stable across rescans
2. list, search, and read use stable IDs with deterministic ranking
3. nested symlinks are never followed and are reported without discarding safe skills
4. a symbolic-link root aborts rescan and preserves the prior catalog generation
5. unterminated frontmatter is skipped with a deterministic malformed diagnostic
6. oversized and over-depth SKILL.md files are skipped with deterministic diagnostics
7. entry-limit failure aborts the scan and keeps the prior immutable snapshot
8. total indexed-byte failure and scan timeout abort without publishing partial results
9. missing roots are diagnosed, while duplicate namespaces and paths are rejected explicitly
10. skill dispatcher handles loom_skills and delegates the other six public tools

### `test/terminal.test.ts` — 8 tests

1. terminal executes through a noninteractive shell with canonical symlink cwd and explicit environment
2. terminal audit is durable before launch and never stores command, environment, cwd, or output
3. audit failure blocks terminal start but preserves cancellation and polling as safety operations
4. terminal timeout reaches timed-out state and cancellation removes the complete descendant group
5. terminal retention never evicts a running job and evicts the oldest finished job
6. terminal service shutdown cancels every running job and leaves no owned process groups
7. terminal validates commands, paths, environment, bounds, and job IDs before mutation
8. terminal dispatcher handles all terminal actions and delegates every other Loom tool

### `test/watchdog.test.ts` — 4 tests

1. watchdog subprocesses are locale-pinned and terminate at their explicit deadline
2. inspectProcess returns macOS PID, group, start time, and canonical executable identity
3. observable identity requires PID, start time, and executable path
4. process group scans include the current process and missing PIDs return null

**Static test declarations detected:** `214`

The authoritative execution count is the Node test runner result recorded in the verification sections. Static extraction is included to make the behavioral surface inspectable in one file.

## Embedded canonical documents

These snapshots are verbatim. Each heading records the source path, byte count, line count, and SHA-256 at assembly time. They include the approved plan, product and governance contract, public operating/security/release documents, implementation chronology, evidence records, dependency manifests, and legal/package metadata.

### Embedded source: `SPEC.md`

- Bytes: `15230`
- Lines: `78`
- SHA-256: `73d63297a4fd69b17a4d0169f458947eb01bfc9ffa3f2f1b787ce6f4dd367a52`

~~~~~markdown
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
- `loom_terminal` is implemented only through one static typed `ProcessManager.start({ executable: '/bin/sh', args: ['-lc', command], ... })` adapter. Reflection, alternate method-name guessing, command-string wrappers for Loom-owned binaries, PTY, and stdin are forbidden. Commands use stable `job_<uuid>` IDs, bounded cursor polling and wait, bounded retained history that evicts only fully completed jobs, audited idempotent cancellation, timeout propagation, rapid natural-exit wrapper handshakes, and runtime shutdown cancellation. Command text, environment names/values, cwd, and output never enter audit records; output appears only in MCP content while structured metadata carries lifecycle/cursor fields. Audit failure blocks start/cancel but not polling an existing job.
- Owner password is a persistent installation credential. It changes only through `loom auth reset`; tunnel URL changes, restarts, token rotation, browser resets, and upgrades never rotate it.
- Quick Tunnel is setup/testing only and is never production certified. Named Cloudflare Tunnel with stable HTTPS hostname is required for production certification.
- Quick Tunnel refuses existing or unsafe `~/.cloudflared/config.yaml`/`.yml`, tunnels only a bare HTTP loopback origin, parses only a strict `https://<label>.trycloudflare.com` origin from bounded output, requires a registered connection within 15 seconds, and permits exactly one transient recreation. Unsafe URLs fail without retry. Every result is explicitly non-production, and URL changes invalidate endpoint-bound OAuth state without rotating the persistent owner password.
- Named Tunnel requires a non-option-like configured name and canonical stable DNS hostname outside `trycloudflare.com`. Before audit or launch, Loom validates a private stable current-user origin certificate and exact current credential schema (`AccountTag`, `TunnelSecret`, `TunnelID`, `TunnelName`), including account and configured-name matching. Every attempt revalidates both files, launches an explicit ephemeral loopback origin with direct argv, and withholds the public endpoint and production eligibility until registration is observed within 15 seconds. Auth/config/audit/cleanup uncertainty fails immediately; only transient startup/readiness failures retry, at most five times with exponential backoff capped at 60 seconds. Stop aborts pending waits and prevents recreation. Stable-hostname restarts preserve endpoint generation and owner password; hostname changes invalidate endpoint-bound OAuth state without rotating the password.
- File paths and terminal `cwd` accept only absolute paths or `~/...`; bare relative paths are rejected. Reads may follow a final symbolic link only after resolving and verifying a stable regular-file target. Terminal `cwd` canonicalizes through `realpath` and may traverse safe symbolic links.
- Writes and edits reject any existing symbolic-link component and use per-path serialization, conflict detection, required audit start records, and same-directory atomic replacement.
- `loom_read` recognizes PNG, JPEG, GIF, and WebP by magic bytes and returns MCP image content within the fixed limit.
- Loom installs the pinned Playwright Chromium build only through explicit `loom setup browser` into `~/.loom/browser/`. Setup resolves the bundled Playwright CLI independently of the caller’s working directory, forces the official Playwright CDN, verifies the exact architecture-specific executable hash, proves a real wrapper-owned loopback CDP launch, and atomically rolls back a failed replacement.
- Loom uses a dedicated persistent browser profile at `~/.loom/browser-profile/` and never attaches to the normal Chrome profile. Browser shutdown sends CDP `Browser.close` and waits for natural managed-process exit so profile data is flushed, with bounded process-group cancellation only as fallback.
- State lives under `~/.loom/`, created with restrictive permissions and atomic writes.
- Audit is private best-effort local activity logging, not tamper-proof against the same macOS user. Audit failure closes mutating operations while reads remain available.
- All terminal, Cloudflared, and Chromium process trees launch through the child wrapper and watchdog protocol with heartbeat, process-table fallback, PID/start-time/executable identity checks, five-second graceful termination, and a fifteen-second absolute shutdown deadline. The wrapper must durably flush `ready` before any target `exit`/IPC disconnect, and the parent must reject a wrapper that exits before readiness rather than waiting for the startup timeout. A transient negative-PGID signal `EPERM` triggers fresh wrapper-identity and group-membership validation before retry within that existing deadline; persistent `EPERM` fails closed, while `ESRCH` remains already-gone. Loom-owned binaries use direct verified executable paths and explicit argument arrays; only the intentionally unrestricted terminal tool invokes `/bin/sh -lc` through a static typed adapter.
- MCP and dashboard bind to loopback ephemeral ports. `/mcp` remains fail-closed until the public HTTPS URL is resolved and endpoint-bound OAuth metadata is ready.
- OAuth supports rotating refresh tokens bound to the exact canonical public `/mcp` resource URI. The authorization page uses a short-lived, single-use server-side transaction so the password POST cannot substitute client, redirect, resource, scope, state, endpoint generation, or PKCE parameters.
- Cloudflared is pinned to version `2026.7.0` for macOS arm64 and x64. Acquisition uses official credential-free HTTPS release URLs, manual bounded redirects, exact archive byte counts and SHA-256 values, a bounded 30-minute transfer deadline, private staged extraction, exact executable SHA-256/version verification, and atomic promotion with failure cleanup.
- Cloudflared runs with `--no-autoupdate`; metrics bind only to `127.0.0.1:0`; named tunnels use `--origincert`, `run --url <bare-loopback-origin>`, `--credentials-file`, and the configured tunnel name through explicit direct argv, never persistent ingress as the origin source and never Quick fallback. Normal PATH symlinks are canonicalized and the resolved binary is verified by ownership, executable mode, version, hash, and stable identity. Every launch re-verifies the executable and uses direct ProcessManager argv rather than shell construction.
- Runtime readiness is introduced before full orchestration: the loopback MCP listener remains deterministically NOT_READY until an exact canonical HTTPS public origin is validated and bound as `<origin>/mcp`. The readiness layer writes only strict secret-free `runtime/current.json` state through a private atomic 0600 replacement after validating the private runtime directory and target path.
- The readiness status model includes local/public MCP URLs, tunnel mode, connector readiness, production eligibility, and the full-access warning. T11 does not start tunnels, browsers, catalogs, signals, or cleanup orchestration; T14 expands the same runtime module for lifecycle control.
- `loom launch --yolo` now runs the real foreground runtime. After support/config validation it acquires an exclusive identity-bound runtime lock, initializes audit/process ownership, starts MCP in NOT_READY state, dashboard, catalogs, verified browser or explicit unavailable mode, and the selected verified tunnel; only then does it bind the canonical public `/mcp`, atomically publish runtime state, print one secret-free status block, request opening of the single-use authenticated local dashboard bootstrap URL through direct `/usr/bin/open` (nonfatal if the local open fails), and wait in the foreground.
- Runtime stop is idempotent and handles explicit stop, dashboard stop, SIGINT, and SIGTERM. It rejects new terminal jobs, cancels complete terminal groups, closes browser then tunnel, terminates MCP public access and dashboard listeners, drains ProcessManager and audit within the 15-second absolute deadline, and removes ownership only after cleanup is certain. `runtime/current.json` is removed only when its private file identity and exact serialized readiness snapshot still match the state Loom wrote; `loom.lock` is removed only when its persisted identity still matches the acquiring launch. Deadline, replacement, or ownership uncertainty preserves the affected state and lock fail-closed.
- The production assembly composes all seven concrete tool handlers, uses a verified pinned Chromium manifest or browser-degraded mode, resolves only the pinned Cloudflared release, never falls back from Named to Quick, and exposes strict audited dashboard actions for catalog rescan, browser restart, local audit reveal, next-launch config replacement, OAuth revocation, and runtime stop.
- YOLO launch requires a direct local `/dev/tty`, macOS 14+/Node 22+, displays the full-access warning and any newly generated owner password only on that terminal, and never creates runtime state when the local-terminal requirement fails. Plain `loom launch` remains fail-closed.
- Skill files with an unterminated frontmatter block are skipped with a malformed diagnostic. Interrupted Loom-owned memory-delete tombstones are safely cleaned during initialization or rescan.
- Browser public-tool policy is separated from the Playwright backend. All internal page evaluations, including snapshots, are deadline-bounded with per-tab recovery before whole-browser restart. Downloads and collision-safe, human-sortable screenshots persist under `~/.loom/downloads/` using private no-overwrite creation.
- The packaged `loom-certify` command collects deterministic checks for the exact clean commit and may validate optional external evidence manifests by strict schema, release SHA, pinned managed-component metadata, and private artifact hashes. Those checks prove only manifest structure and artifact integrity. Self-reported external fields never make G5–G7 pass; real Cloudflare, ChatGPT, OAuth, tool-call, cleanup, clean-host, sleep/wake, and connector-persistence evidence remains blocked until human review.
- MCP JSON requests are bounded before parsing, with a 9 MiB server limit that accommodates the 8 MiB write contract plus protocol overhead. Oversized requests return a structured 413 response before SDK or tool-schema handling.
- Owner-password authorization POSTs are globally limited in-process to ten attempts per monotonic 60-second window. New owner verifiers use scrypt N=32768, r=8, p=3; a successfully verified legacy N=16384, r=8, p=1 credential is transparently upgraded. Refresh-token rotation preserves one absolute 30-day family expiration and cannot renew access indefinitely.
- Watchdog `ps` and `lsof` probes run with a fixed C locale, bounded output, and a two-second hard timeout. Wrapper identity probes are serialized; transient inspection failure is distinct from confirmed parent mismatch, and a healthy monotonic heartbeat prevents false orphan cleanup. Runtime, ProcessManager, MCP session, dashboard, and wrapper heartbeat safety deadlines use monotonic clocks; persisted OAuth expirations and human-readable timestamps remain wall-clock values.
- On macOS only, exact root-owned compatibility aliases `/tmp` and `/var` are canonicalized to `/private/tmp` and `/private/var` before mutation symlink checks. Other mutation symlinks remain forbidden. Reads open the canonical target nonblocking before regular-file verification, so a FIFO/device replacement cannot hang the server.
- Audit failure continues to block capability-increasing mutations. Terminal cancellation and browser-tab closure remain available without durable audit admission because they reduce active capability; their audit records are best effort when audit is degraded.
- Tombstone recovery rechecks the exact verified file identity immediately before removal. Terminal output stripping is required to remove OSC sequences including OSC 52 clipboard controls.
- Loom authenticates an unrestricted remote client but does not make its model or the content it reads trustworthy. Prompt injection from files, pages, skills, memory, and terminal output; persistent browser cookies and Loom memory; result disclosure to the authorized client/provider; inherited login-shell secrets; localhost/private-network pivoting; macOS TCC; local-only incident containment; privacy-oriented non-forensic audit; deliberate process-session escape; local-filesystem crash-durability limits; operator-managed artifact retention; terminal scrollback exposure; and the lack of an out-of-band package-signing root are explicit residual risks, not certified mitigations.

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
- `loom-certify --output <report.json> [--external <evidence.json>]`

## Release contract

Release-ready status requires every automated gate, clean packed install, real named-tunnel test, real ChatGPT OAuth and tool calls, verified process cleanup, verified stable endpoint and owner-password persistence, human-reviewed committed evidence, and a clean repository. `loom-certify` cannot replace that human review or independently grant production certification. Quick Tunnel testing alone cannot satisfy production certification. No push or npm publication occurs without explicit user instruction.
~~~~~

### Embedded source: `AGENTS.md`

- Bytes: `2010`
- Lines: `33`
- SHA-256: `fac305e7f7ab4f2e4521f5fcd5b75152bfbe880ca49dba2c8a9896aa49dd052d`

~~~~~markdown
# Loom Agent Contract

Read in order before work: `SPEC.md`, `AGENTS.md`, `REPO_MAP.md`, `CHANGELOG.md`, `HANDOFF.md`, `ALGORITHM.md`, then `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`.

Run the exact startup command in `HANDOFF.md` before editing.

## Execution

- Use `superpowers:executing-plans` task by task.
- Keep Ponytail active: smallest correct implementation, standard library first, no speculative abstractions.
- Use test-first development for behavior changes. Record the expected RED failure before implementation and the GREEN result afterward.
- Implement tasks in the approved plan order. Regrouping, skipping, or reassigning task scope requires an explicit amendment to the canonical plan before proceeding. Do not skip gates or claim untested external integrations.
- Do not push, publish, deploy, or modify Spindle/DevSpace without explicit user instruction.

## Governance

Before code changes, `REPO_MAP.md` must be exhaustive against `git ls-files | sort` and Gate G0 must pass.

Every commit that changes repository files must update in the same commit:

- `REPO_MAP.md`
- `CHANGELOG.md`
- `HANDOFF.md`

Also update `SPEC.md` when behavior, scope, architecture, security policy, tool contracts, or release criteria change. Update this file when execution rules change. Keep `ALGORITHM.md` at 20 lines or fewer.

Each tracked-file entry in `REPO_MAP.md` must include path, purpose, success check, assessment, evidence, last meaningful change, and owning task or gate.

## Completion

A task is complete only when intended files exist, targeted tests pass, full tests, typecheck, and build pass, the repository map matches the exact tracked tree, evidence is recorded, the handoff contains the resulting SHA and exact next command, and the repository is clean unless a real blocker is documented.

Never claim ChatGPT, named-tunnel, process-cleanup, browser-persistence, clean-machine packaging, or production readiness without the exact required real-world evidence.
~~~~~

### Embedded source: `ALGORITHM.md`

- Bytes: `887`
- Lines: `17`
- SHA-256: `a51c91e490dbdd2e56b345a59bfa8b7dae571172a9d170ee47188361b212e4fb`

~~~~~markdown
# Loom Planning Algorithm

1. Read the governance files and approved implementation plan.
2. Run the exact startup command from `HANDOFF.md`.
3. Verify `REPO_MAP.md` is exhaustive against `git ls-files`.
4. Select the first incomplete task in order; amend the plan before regrouping or skipping.
5. Restate its acceptance checks in the handoff.
6. Write the smallest failing test for one required behavior.
7. Run it and record the expected failure.
8. Implement the minimum correct production code.
9. Run the targeted test until green.
10. Repeat for remaining task behaviors.
11. Run typecheck, full tests, and build.
12. Update map, changelog, handoff, and spec when required.
13. Commit only with green typecheck, tests, build, map, and governance.
14. Record SHA, evidence, blockers, and exact next command.
15. Stop only for a real unresolved blocker or completed approved scope.
~~~~~

### Embedded source: `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`

- Bytes: `51389`
- Lines: `656`
- SHA-256: `b3397f473cce0f6f20a25ecd5dbb12ca9b61a9393695dc8cccc58ea3a98288b2`

~~~~~text
LOOM V1 — CAVEKIT IMPLEMENTATION PLAN

Status: APPROVED IMPLEMENTATION BASELINE, amended after independent release-blocker review
Target repository: /Users/aashu/loom
Target branch: planning/loom-v1-cavekit
Target platform: macOS 14 or newer, Apple Silicon and Intel where dependencies support both
Runtime: Node.js 22 or newer
Primary executable: loom
Primary unrestricted command: loom launch --yolo

This document is the complete handoff for a new implementation agent. It replaces earlier Loom v1 drafts. Follow it in order. Do not modify Spindle or DevSpace. Do not push, publish, deploy, or claim production readiness without explicit user instruction and the evidence required below.

0. PRODUCT CONTRACT

Loom is a foreground-only, single-owner remote MCP server for a computer owned and controlled by the person launching it. Unrestricted terminal and filesystem capability is disabled unless the owner explicitly starts `loom launch --yolo` in a visible local terminal. The process must print an unmistakable warning that this grants authenticated remote clients the same practical access as the current macOS user, including environment secrets and personal files.

The visible foreground process is the security boundary. Closing its terminal, pressing Ctrl+C, or terminating the main process must stop public access and clean all Loom-owned children. Loom must not install launchd jobs, login items, hidden daemons, persistent supervisors, browser extensions, cloud control planes, or auto-start behavior.

Loom exposes exactly seven MCP tools:

- loom_terminal
- loom_read
- loom_write
- loom_edit
- loom_skills
- loom_memory
- loom_browser

Normal `loom launch` must not silently enable unrestricted tools. It must exit with a concise message directing the owner to the explicit `loom launch --yolo` command. There is no second spelling or hidden environment-variable bypass for YOLO mode.

1. CAVEKIT OPERATING CONTRACT

1.1 Required repository files

- SPEC.md
- AGENTS.md
- REPO_MAP.md
- CHANGELOG.md
- HANDOFF.md
- ALGORITHM.md
- docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt

1.2 Mandatory read order

Read the seven files above in the listed order. Then run the exact startup command recorded in HANDOFF.md before editing.

1.3 Repository-map gate

Before production code changes, run `git ls-files | sort`. REPO_MAP.md must document every tracked file with:

- Path
- Purpose
- Success check
- Current assessment: PASS, PARTIAL, FAIL, or PLANNED
- Evidence
- Last meaningful change
- Owning task or gate

1.4 Same-commit governance rule

Every commit changing repository files must update REPO_MAP.md, CHANGELOG.md, and HANDOFF.md in the same commit. Update SPEC.md when behavior, architecture, scope, security policy, tool contract, or release criteria change. Update AGENTS.md when execution rules change. Keep ALGORITHM.md at 20 lines or fewer.

1.5 Test-first execution

For every behavior change:

1. Record the current task and acceptance check in HANDOFF.md.
2. Write the smallest failing test.
3. Run the exact test and record the expected RED failure.
4. Implement the minimum production code.
5. Run the targeted test to GREEN.
6. Run typecheck, full tests, and build.
7. Update governance files.
8. Verify the working tree and repository map describe exactly the files owned by the task. Regrouping, skipping, or reassigning task scope requires an explicit plan amendment before proceeding.
9. Commit one coherent task or subtask only while typecheck, full tests, build, map validation, and governance checks are green.
10. Record the SHA and exact next command.

1.6 Evidence discipline

Never claim external behavior from mocks. Real ChatGPT, OAuth, named-tunnel, browser-persistence, sleep/wake, package-install, and process-cleanup claims require the exact real-world evidence described in T16. Tests may prove deterministic local behavior only.

2. LOCKED PRODUCT DECISIONS

- Foreground-only runtime.
- `loom launch --yolo` is the only command that enables unrestricted remote access.
- No approvals, command classification, path allowlist, PTY, usable stdin, workspaces, database, vector database, plugin runtime, generic event bus, monorepo, dependency-injection container, or one-implementation interfaces.
- Terminal commands are unrestricted but noninteractive. No PTY. stdin is ignored or `/dev/null`.
- Owner password is a persistent installation credential. It changes only through `loom auth reset`.
- Restarts, Quick Tunnel URL changes, named-tunnel hostname changes, OAuth refresh, browser reset, config reset, and package upgrades must not rotate the owner password.
- Quick Tunnel is setup/testing only and can never satisfy production certification.
- Named Cloudflare Tunnel with a stable HTTPS hostname is required for production certification.
- File paths and terminal cwd accept only absolute paths or `~/...`. Bare relative paths are rejected.
- Writes and edits reject every existing symlink component, serialize per canonical path, detect conflicts, write an audit-start record before mutation, and replace atomically in the same directory.
- loom_read detects PNG, JPEG, GIF, and WebP by magic bytes and returns MCP image content within the fixed limit.
- Browser uses a dedicated persistent profile at `~/.loom/browser-profile/`; it never attaches to the normal Chrome profile.
- Audit is private best-effort local logging, not tamper-proof against the same macOS user. Audit failure closes mutations while reads remain available.
- All terminal, Cloudflared, and Chromium process trees are wrapper-owned and watchdog-covered.

3. NON-GOALS

No Windows release claim, Linux claim, hidden service, mobile client, browser extension, normal-Chrome attachment, incognito support, command replay, undo, multi-user auth, cloud storage, remote update system, custom MCP UI, or automatic owner-password recovery.

4. DEPENDENCIES AND SUPPORT FLOOR

Pin exact versions in package.json and package-lock.json:

- @modelcontextprotocol/sdk 1.29.0
- express 5.2.1
- zod 4.4.3
- playwright-core 1.61.1

Pin development dependencies exactly. Do not use version ranges. Record the exact MCP SDK version in SPEC.md and REPO_MAP.md.

Supported production floor is macOS 14.0 or newer and Node.js 22 or newer. Earlier macOS versions are unsupported unless later proven and explicitly added to SPEC.md.

Playwright browser setup is explicit. `npm install` must not download Chromium. `loom setup browser` must resolve and invoke the locally installed Playwright Core CLI independently of the caller’s working directory, force the official Playwright CDN rather than honoring caller download-host overrides, install its pinned Chromium revision, record the expected revision and resolved executable path, verify the exact architecture-specific executable SHA-256, and prove a real wrapper-owned loopback CDP launch. Installation promotion is atomic and restores the prior installation if promoted verification fails. Runtime must refuse browser startup when the executable does not match the recorded supported revision, while leaving non-browser tools available.

5. TARGET REPOSITORY LAYOUT

public/
  dashboard.html
  dashboard.css
  dashboard.js
src/
  audit.ts
  atomic-file.ts
  browser.ts
  browser/
    backend.ts
    setup.ts
  catalog.ts
  child-wrapper.ts
  cli.ts
  cloudflare.ts
  config.ts
  dashboard.ts
  limits.ts
  mcp.ts
  oauth.ts
  output.ts
  paths.ts
  process-manager.ts
  runtime.ts
  watchdog.ts
  tools/
    browser.ts
    files.ts
    knowledge.ts
    register.ts
    terminal.ts
test/
  audit.test.ts
  atomic-file.test.ts
  browser.test.ts
  catalog.test.ts
  cli.test.ts
  cloudflare.test.ts
  config.test.ts
  dashboard.test.ts
  files.test.ts
  mcp.test.ts
  oauth.test.ts
  output.test.ts
  paths.test.ts
  process-manager.test.ts
  runtime.test.ts
  terminal.test.ts
  watchdog.test.ts
docs/
  plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt
  release-evidence/

Do not create speculative modules. A planned path may remain absent until its owning task starts.

6. RUNTIME STATE AND PERMISSIONS

State root: `~/.loom/`

- auth.json
- config.json
- audit/
- browser/
- browser-profile/
- cloudflared/
- downloads/
- downloads/screenshots/
- memory/
- runtime/browser.lock
- runtime/current.json
- runtime/loom.lock

Create directories with mode 0700. auth.json, config.json, audit files, and runtime files use 0600. Reject insecure existing ownership or permissions when they cannot be repaired safely. All state writes use same-directory temporary files, fsync where correctness requires it, atomic rename, and restrictive creation modes.

7. CLI CONTRACT

Required commands:

- loom launch
- loom launch --yolo
- loom setup browser
- loom auth reset
- loom config check
- loom config reset
- loom --version
- loom --help

`loom launch` exits nonzero without starting listeners and prints the exact explicit opt-in command.

`loom launch --yolo` validates local interactive ownership through `/dev/tty`, prints the full-computer-access warning, starts foreground runtime, and remains visible until shutdown. It must not accept YOLO through config or environment variables.

`loom setup browser` installs only the pinned Playwright Chromium revision on explicit invocation and verifies launch. No browser download during npm install.

`loom auth reset` refuses while Loom is running, requires confirmation from `/dev/tty`, revokes OAuth clients, codes, access tokens, refresh tokens, and pending transactions, generates a new high-entropy owner password, hashes it using Node crypto.scrypt with a fresh salt, stores it atomically, and prints the new password only to `/dev/tty`. It preserves tunnel, memory, browser, and catalog configuration.

`loom config check` validates without modifying state. `loom config reset` requires local confirmation, timestamps and preserves invalid prior config, then writes valid defaults atomically.

8. CENTRAL LIMITS

Define once in src/limits.ts and test boundary values:

- MAX_WRITE_BYTES = 8 MiB
- MAX_EDIT_WINDOW_BYTES = 256 KiB
- MAX_TERMINAL_COMMAND_BYTES = 65,536
- MAX_TERMINAL_ENVIRONMENT_ENTRIES = 256
- MAX_TERMINAL_ENVIRONMENT_KEY_BYTES = 256
- MAX_TERMINAL_ENVIRONMENT_VALUE_BYTES = 65,536
- MAX_TERMINAL_TOTAL_ENVIRONMENT_BYTES = 1 MiB
- MAX_TERMINAL_TIMEOUT_MS = 86,400,000
- MAX_TERMINAL_POLL_BYTES = 1 MiB
- DEFAULT_TERMINAL_POLL_BYTES = 64 KiB
- MAX_TERMINAL_WAIT_MS = 60,000
- MAX_TERMINAL_RETAINED_JOBS = 128
- MAX_TERMINAL_JOB_ID_BYTES = 128
- TERMINAL_POLL_INTERVAL_MS = 25
- MAX_FILES_PER_ROOT = 10,000
- MAX_FILE_BYTES_PER_ROOT = 1 MiB
- MAX_TOTAL_INDEXED_BYTES = 64 MiB
- MAX_CATALOG_DEPTH = 12
- MAX_SCAN_SECONDS = 10
- MAX_BROWSER_TABS = 12
- MAX_BROWSER_SNAPSHOT_BYTES = 128 KiB
- MAX_SCREENSHOT_BYTES = 2 MiB
- MAX_AUDIT_FILE_BYTES = 50 MiB
- AUDIT_RETENTION_DAYS = 30
- AUDIT_START_DEADLINE_MS = 2,000
- QUICK_TUNNEL_URL_DEADLINE_MS = 15,000
- NAMED_TUNNEL_READY_DEADLINE_MS = 15,000
- NAMED_TUNNEL_MAX_RETRIES = 5
- NAMED_TUNNEL_BACKOFF_BASE_MS = 1,000
- NAMED_TUNNEL_BACKOFF_MAX_MS = 60,000
- WATCHDOG_HEARTBEAT_INTERVAL_MS = 1,000
- WATCHDOG_MISSED_HEARTBEAT_LIMIT = 3
- WATCHDOG_PROCESS_SCAN_FALLBACK_MS = 2,000
- SHUTDOWN_SOFT_GRACE_MS = 5,000
- SHUTDOWN_ABSOLUTE_DEADLINE_MS = 15,000
- DASHBOARD_BOOTSTRAP_NONCE_TTL_MS = 5,000

9. PATH AND ATOMIC-FILE CONTRACT

Expand only `~/...`; reject `~other`, bare relative paths, NUL bytes, malformed Unicode, and empty paths. Canonicalize before authorization and locking.

Reads may follow a final symbolic link only after resolving it to a stable regular-file target and rechecking the opened target identity before returning bytes. Writes and edits must walk each existing path component with lstat and reject any symlink component. Parent creation is optional and bounded. Recheck identity immediately before replacement to reduce race exposure.

Terminal cwd accepts only absolute or `~/...` input, then canonicalizes through `realpath` and requires the resolved target to be a directory. A safe cwd is not rejected merely because its input path traversed a symbolic link. Loom-owned executable discovery may likewise accept a PATH symlink only after resolving and verifying the canonical target, ownership, version, hash, and stable identity.

Use a per-canonical-path async mutex. Write to a random same-directory temporary file with restrictive mode, fsync when required, preserve existing regular-file mode, check expected SHA-256 when supplied, then rename atomically. Clean temporary files on failure.

Memory save/delete resolves a stable Loom-owned ID to a canonical path strictly inside `~/.loom/memory/`; user-supplied paths are never accepted.

10. OUTPUT MODEL

Terminal output is noninteractive. stdout and stderr are piped separately into one ordered bounded stream. Strip ANSI and unsafe control sequences. Detect binary output and suppress it with a deterministic marker.

Track total bytes, retained head/tail, truncation, first available cursor, next cursor, running/completed/cancelled/timed-out state, exit code, signal, and sanitized output. Cursor reads return `requestedCursor`, `availableFrom`, `nextCursor`, and `gap` so truncation cannot silently corrupt polling.

A synchronous tool call may wait at most 60 seconds. Longer commands return a job ID and cursor and continue only while the foreground Loom runtime remains alive.

11. CHILD WRAPPER, WATCHDOG, AND PROCESS GROUPS

Every terminal, Cloudflared, and Chromium tree starts through a Loom child wrapper in its own process group. Record PID, PGID, launch ID, canonical executable path, process start time, and canonical Loom state path.

Loom-owned binaries such as Cloudflared and Chromium must be started directly through ProcessManager using a verified executable path and an explicit `string[]` argument vector. Shell command construction, quoting, parsing, or routing those binaries through the public terminal adapter is forbidden. The unrestricted terminal tool may intentionally invoke `/bin/sh -lc <command>` through one static, strongly typed adapter to ProcessManager; reflection, `Function.toString()`, alternate method-name guessing, and result-shape guessing are forbidden.

The wrapper must flush its `ready` IPC message before any fast target `exit` message and before disconnecting IPC; startup errors must also flush before disconnect. The parent must observe wrapper exit during startup and reject immediately instead of waiting for the startup timeout, while preserving exit events that arrive between readiness and managed-object construction.

The parent sends a heartbeat every second. After three missed heartbeats, the watchdog verifies parent identity through PID plus start time plus canonical executable path. It also scans the process table every two seconds as fallback. Never rely on pipe closure or `kill(pid, 0)` alone.

On shutdown, send SIGTERM to the negative PGID, wait at most five seconds, then SIGKILL the negative PGID. Drain pipes, record final state, and deregister the group. Every shutdown path has an absolute 15-second deadline after which remaining owned groups are killed. PID reuse checks must fail closed when identity is uncertain.

Chromium launched by Playwright must still be wrapper-owned. Use the browser executable with a wrapper-controlled transport or launch arrangement that preserves Playwright control while placing the browser process tree in the owned process group. A browser process that bypasses watchdog ownership is a release blocker.

12. RUNTIME LOCKS AND PID REUSE

`runtime/loom.lock` and `runtime/browser.lock` store PID, start time, canonical executable path, launch ID, and canonical state/profile path. A lock is live only when all identity fields match. Stale locks may be removed only after process-table verification.

For the dedicated browser profile, remove stale Chromium `SingletonLock`, `SingletonCookie`, and `SingletonSocket` only after confirming no live Loom or Chromium process uses the canonical profile path. Never remove them while ownership is uncertain.

13. MCP TRANSPORT AND SESSION MODEL

Bind MCP and dashboard listeners only to `127.0.0.1` on ephemeral ports. Do not expose an unauthenticated public MCP route at any point.

Before endpoint-bound OAuth is ready, `/mcp` must fail closed with deterministic NOT_READY behavior. After the public HTTPS endpoint is resolved, configure one canonical protected resource URI equal to the exact public MCP URL ending in `/mcp`, enable OAuth metadata, then mark the route ready.

Implement the MCP SDK's supported Streamable HTTP transport and explicit session lifecycle. Validate session identifiers, bound inactive sessions, clean sessions on shutdown, and return structured protocol errors rather than generic Express pages.

Unauthenticated protected-resource responses must provide the correct `WWW-Authenticate` challenge pointing to protected-resource metadata. Publish path-correct protected-resource metadata and authorization-server metadata. The resource value and audience checks must use the exact canonical `/mcp` URL.

14. AUDIT SYSTEM

Write private JSONL logs to `~/.loom/audit/YYYY-MM-DD.jsonl`. Serialize rotation at 50 MiB inside the same critical section. Delete files older than 30 days at startup.

Use a bounded async queue with no silent drops. A mutating operation is rejected if its audit-start record cannot be durably accepted within two seconds or the queue is saturated. Mark runtime `audit degraded`. Read-only operations remain available.

Audit-start records precede terminal start, write, edit, memory save/delete, browser mutations, permission changes, and downloads. Finish records include status and duration. Never log owner password, OAuth secrets, authorization headers, environment values, command output, file content, typed browser values, cookies, storage, page text, or screenshot bytes.

15. OAUTH MODEL

Single-owner OAuth is local-password-gated and endpoint-bound. Cloudflare never receives or validates the owner password; it is only the reverse proxy.

Persist OAuth client registrations, authorization transactions, authorization codes, access tokens, refresh tokens, scopes, expiry, resource URI, and endpoint generation in private atomic state. Hash opaque secrets at rest where practical. The authorization GET route creates a cryptographically random, short-lived server-side transaction bound to client, redirect URI, scope, resource, endpoint generation, PKCE challenge, and client state. The password POST submits only the transaction ID, owner password, and decision; it atomically consumes the stored transaction and must reject expiry, replay, endpoint change, or parameter substitution. Authorization codes are single use and short lived. Refresh tokens are supported, rotated on use, revocable, and bound to the same client, scope, owner installation, endpoint generation, and canonical `/mcp` resource.

Tunnel URL changes invalidate endpoint-bound OAuth clients/codes/tokens because their resource/redirect assumptions may no longer be valid. They must not rotate the owner password.

Startup is fail closed. Public routing is not considered ready until OAuth metadata and token validation are bound to the resolved public endpoint. Tests must cover discovery, challenge headers, authorization-code exchange, refresh, rotation, expiry, revocation, wrong audience, wrong resource, endpoint change, replay, and owner-password persistence.

Real ChatGPT certification requires an eligible ChatGPT workspace/account and developer-mode/custom-connector support. This external prerequisite must be recorded in T16; local tests cannot prove it.

16. TOOL CONTRACTS

16.1 loom_terminal

Actions: start, poll, cancel. Input includes command, optional absolute-or-home cwd, optional environment overrides, timeout, cursor, and max wait within central limits. No PTY and no usable stdin. Commands run as the current macOS user through the wrapper/watchdog process group.

16.2 loom_read

Input: path and optional byte range/text controls. Reject unsupported file types and over-limit files. Detect PNG, JPEG, GIF, and WebP by magic bytes, not extension, and return MCP ImageContent with correct MIME type when within limit. Text decoding is deterministic and reports truncation.

16.3 loom_write

Input: `{ path, content, createParents?, expectedSha256? }`. Maximum 8 MiB. Require audit start, canonical path mutex, symlink rejection, expected-hash conflict detection, atomic replacement, and mode preservation.

16.4 loom_edit

Input: `{ path, oldText, newText, replaceAll?, expectedSha256? }`. Reject empty oldText. Maximum editable window 256 KiB. Exact matching only. By default require exactly one match; replaceAll must be explicit. Require audit, mutex, conflict detection, and atomic replacement.

16.5 loom_skills

Actions: list, search, read, rescan. Read-only. Catalog configured roots asynchronously with bounded concurrency and return source path plus safe metadata.

16.6 loom_memory

Actions: list, search, read, save, delete, rescan. save/delete operate only on Loom-owned stable IDs under `~/.loom/memory/`. Imported external memory is read-only unless copied into Loom-owned storage through an explicit local setup flow added by a later approved change.

16.7 loom_browser

Actions: status, tabs, open, navigate, snapshot, click, type, evaluate, screenshot, close, grant_permissions, clear_permissions, set_geolocation.

Allowed navigation schemes: https, http, and about:blank. Reject file, javascript, direct data, and unsupported custom schemes. Localhost/private IP navigation remains allowed because Loom is an explicitly owner-controlled developer tool. Browser output and screenshots obey central limits. Downloads go to `~/.loom/downloads/`; screenshots go to `~/.loom/downloads/screenshots/`.

17. CATALOG MODEL

Use `fs/promises`, bounded concurrency, and no synchronous recursive scans in request handling. Do not follow directory symlinks. Skip file symlinks.

Limits per root: 10,000 files, 1 MiB per file, 64 MiB indexed bytes, depth 12, and 10-second scan budget. Build a candidate catalog separately, keep the current catalog available during rescan, and atomically swap only after completion. Record skipped, malformed, timed-out, and over-limit counts. A SKILL.md opening YAML delimiter without a closing delimiter is malformed and must be skipped with a deterministic diagnostic; it must not be partially interpreted as both metadata and body text.

At memory initialization or rescan, recognize only exact Loom-owned tombstone names. After verifying containment, regular-file type, current-user ownership, restrictive permissions, and no symlink, remove stale tombstones left by an interrupted committed delete. Cleanup failures remain visible as diagnostics and must not be silently ignored.

18. BROWSER MODEL

Load playwright-core through guarded dynamic import so a missing or broken browser subsystem does not disable terminal, file, skills, or memory tools.

Use the dedicated profile and recorded pinned Chromium revision. Enforce 12-tab maximum, deterministic tab IDs, bounded snapshots, safe selector handling, navigation-scheme validation, explicit permission state, and profile-lock recovery from Section 12. Keep public schema validation, audit policy, result shaping, and MCP dispatch in `src/tools/browser.ts`; keep Playwright loading, CDP lifecycle, process ownership, tab state, downloads, screenshots, and profile recovery in the browser backend modules.

Every internal page evaluation, including snapshot extraction and the public evaluate action, has a fixed deadline. On timeout, mark only that tab unhealthy, attempt bounded `page.close({ runBeforeUnload: false })`, and verify that another tab remains usable. Restart the whole browser only when page-level cleanup fails or CDP health is lost. Tests must prove that a hung evaluation does not unnecessarily destroy unrelated tabs.

Downloads and screenshots are persisted under their approved directories using private no-overwrite creation. Screenshot names are human-sortable and collision-safe by combining UTC timestamp, deterministic tab identifier, a monotonic counter, and random suffix. Screenshot bytes are also returned through MCP when within the central limit.

Because Playwright `connectOverCDP()` disconnects rather than terminating the remote browser, normal browser shutdown must send CDP `Browser.close`, wait within the soft shutdown grace for the wrapper-owned process to exit naturally and flush the dedicated profile, then use process-group cancellation only as fallback. Shutdown does not return until the managed group and browser lock are cleaned.

Never put secrets in command-line flags. Do not attach to the user's normal Chrome profile. Browser restart must preserve the dedicated profile. Browser clear/reset actions must be explicit and locally confirmed when destructive.

19. CLOUDFLARED MODEL

Manage Cloudflared version `2026.7.0` with architecture-specific official release URLs, archive sizes, archive SHA-256 values, and extracted executable SHA-256 values for macOS arm64 and x64. Download only over credential-free HTTPS with manual redirects capped at five and a bounded 30-minute total transfer deadline. Stream into a private exclusive staging file, enforce the exact pinned byte count and SHA-256, validate a single-file `cloudflared` archive, verify the extracted executable's ownership, mode, stable identity, SHA-256, and exact version through ProcessManager, then atomically promote it. Every failure leaves the previous binary unchanged and removes staging residue.

When a PATH binary is used, inspect only the first `cloudflared` match, canonicalize normal symlinks, verify the resolved current-user regular executable by stable identity, hash, and exact version, and report the requested path, canonical path, and version. Do not skip an unknown first match or silently accept an unknown version.

Always run Cloudflared with direct verified executable-plus-argument ProcessManager launch, `tunnel --no-autoupdate --metrics 127.0.0.1:0`, and caller tunnel arguments appended only after rejecting reserved flag overrides. Shell construction and public-terminal routing are forbidden.

19.1 Quick Tunnel

Quick Tunnel is temporary setup/testing only. Refuse Quick mode before audit/process launch when `~/.cloudflared/config.yaml` or `.yml` exists or the config path is unsafe. Tunnel only the exact bare HTTP loopback MCP origin through the verified direct Cloudflared launch boundary. Accumulate at most 256 KiB of sanitized bounded output, parse only a whitespace/end-delimited `https://<valid-single-label>.trycloudflare.com` origin, and require a registered tunnel connection within the fixed 15-second deadline. A malformed/unsafe candidate fails closed without retry. A process-start failure, early transient exit, or readiness timeout permits exactly one fully cleaned recreation and no more. Quick results/status always expose exact `<origin>/mcp` with `Production: no`. A URL change passes through runtime/OAuth endpoint binding, invalidates endpoint-bound OAuth state, and preserves the owner password. Audit records start/finish only and never contain Cloudflared output or the public URL.

Do not claim stale-subdomain takeover resistance or connector persistence from automated tests. Those remain real-world limitations of Quick Tunnel and are why it is never certified for production.

19.2 Named Tunnel

Named tunnel is the production path. Require a configured nonempty, non-option-like tunnel name and a canonical stable public DNS hostname; reject `trycloudflare.com` and its subdomains. The configuration check lowercases the hostname without modifying the source file and rejects surrounding whitespace, control characters, and names longer than 128 characters.

Before audit or process launch, read the configured credentials JSON and the origin certificate (default `~/.cloudflared/cert.pem`) through stable current-user private regular-file handles with no symbolic-link components. Reject group/other access, executable or special mode bits, oversized/empty files, identity changes, malformed PEM/JSON/base64, unexpected credential fields, invalid UUID/secret length, account mismatch between certificate and credentials, or a credential `TunnelName` that does not exactly match configuration. Current credentials must contain exactly `AccountTag`, `TunnelSecret`, `TunnelID`, and `TunnelName`.

Use the verified direct Cloudflared boundary with explicit arguments equivalent to:

`cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:0 --origincert <cert.pem> run --url http://127.0.0.1:<mcp-port> --credentials-file <credentials.json> <tunnel-name>`

The public connector URL is `https://<hostname>/mcp`, but status and production eligibility remain unavailable until bounded output reports a registered tunnel connection within 15 seconds. Do not rely on a persistent ingress mapping that may target a stale ephemeral port; a benign missing-config notice is not an error. Never fall back to Quick Tunnel.

Static validation, audit-start failure, authentication failure, Cloudflared configuration failure, uncertain cleanup, and stop-during-startup all fail closed. Revalidate both authentication files before every process attempt. Retry only transient spawn/edge/readiness failures at most five times, with one-second exponential backoff capped at 60 seconds and complete cleanup between attempts. Stop aborts readiness/backoff waits immediately and cannot permit process recreation. Audit records contain only secret-free mode/retry metadata and never the hostname, endpoint, file paths, certificate fields, credentials, or Cloudflared output.

Binding the same stable hostname after restart preserves endpoint generation and the persistent owner password. A configured hostname change rebinds the canonical `/mcp` resource and invalidates endpoint-bound OAuth state without rotating the owner password.

20. DASHBOARD

Serve static `public/dashboard.html`, `.css`, and `.js` only on loopback. Generate a 256-bit random bootstrap nonce with 5-second TTL and single use. Exchange it for an HttpOnly, SameSite=Strict session cookie. Require the session cookie for every endpoint and a per-session CSRF value in `X-Loom-CSRF` for mutations.

Validate exact Host and Origin, allow no permissive CORS, escape all rendered values, and send strict CSP, no-store, no-sniff, frame-deny, and `Referrer-Policy: no-referrer` headers.

Dashboard actions: rescan catalog, restart browser, reveal audit folder locally, edit tunnel/extra-root configuration for the next launch, revoke all OAuth, and optionally stop Loom. Never show owner password, commands, browser typed values, environment values, OAuth tokens, authorization headers, or file content.

21. TERMINAL DISPLAY

Print the main status block exactly once after runtime is ready, then append one-line activity records. Do not redraw a live TUI.

The status block includes MCP, browser, skills, memory, tunnel type, connector readiness, audit health, full local MCP URL, full public MCP URL ending `/mcp`, dashboard URL, production certification eligibility, and a bright warning:

`FULL COMPUTER ACCESS ENABLED — sharing the owner password or authorizing an untrusted client is equivalent to giving away this macOS account.`

Quick Tunnel must show `Production: no`. Pressing Ctrl+C must stop Loom.

22. RUNTIME ORCHESTRATION

Startup order:

1. Parse CLI and require explicit --yolo.
2. Validate macOS/Node support and config.
3. Acquire runtime lock.
4. Initialize state permissions and audit.
5. Start watchdog.
6. Start loopback MCP listener in NOT_READY state.
7. Start loopback dashboard.
8. Start bounded catalog.
9. Start browser when installed and valid; otherwise mark unavailable.
10. Start selected tunnel.
11. Resolve and validate public HTTPS URL.
12. Bind canonical `/mcp` resource and enable endpoint-bound OAuth.
13. Mark MCP route ready.
14. Write runtime state atomically.
15. Print status once.
16. Open dashboard locally.
17. Remain foreground.

Shutdown order:

1. Mark stopping.
2. Stop health checks and reject new mutations.
3. Cancel terminal jobs.
4. Close Playwright control and browser tree.
5. Clean verified stale browser leftovers.
6. Terminate Cloudflared group.
7. Close MCP sessions/listener.
8. Close dashboard.
9. Flush audit within deadline.
10. Remove runtime locks/state.
11. Confirm watchdog cleanup and no owned descendants.
12. Exit within absolute shutdown deadline.

23. IMPLEMENTATION TASKS AND GATES

G0 — Governance baseline

Required: all seven Cavekit files exist; REPO_MAP matches `git ls-files`; no undocumented tracked file; HANDOFF contains exact startup command; repository clean after commit.

T0 — Fresh repository and package bootstrap

- Initialize `/Users/aashu/loom` on `planning/loom-v1-cavekit`.
- Create governance files and this plan.
- Pin exact dependencies and scripts.
- Generate package-lock.json.
- Add only the minimum CLI/package bootstrap needed for typecheck, test, and build.
- Add a bootstrap test proving package metadata, macOS floor declaration, and explicit `launch --yolo` command surface.
- Run map validation, typecheck, tests, build, and commit.

G1 — Reproducible bootstrap

A clean `npm ci`, typecheck, tests, and build pass on supported macOS with no browser download or network-required test.

T1 — State, config, permissions, paths, atomic files

Implement limits, path parsing, state-root creation, secure permissions, atomic JSON/text writes, config check/reset, symlink rejection, per-path mutex, expected SHA-256 conflicts, and runtime-lock identity. Tests cover hostile paths, permission repair/refusal, atomic cleanup, races, and PID reuse fields.

T2 — Child wrapper, process manager, watchdog, bounded output

Implement wrapper-owned process groups, heartbeat plus process-table fallback, identity validation, terminal output ring/cursors, cancellation, soft/hard shutdown deadlines, and no stdin/PTY. Tests use real local child processes and prove group cleanup without claiming sleep/wake behavior.

G2 — Local process safety

All deterministic process tests pass; no test leaves descendants; identity checks reject PID-only matches; terminal output cursor math is proven at truncation boundaries.

T3 — Audit system

Implement private JSONL, queue, deadline, mutation fail-closed behavior, rotation, retention, redaction, and start/finish records. Tests cover saturation, failed writes, serialized rotation, and redaction.

T4 — OAuth and endpoint-bound state

Implement persistent owner credential, auth reset, client/code/access/refresh-token state, metadata, discovery challenge, exact resource/audience validation, replay prevention, refresh rotation, revocation, endpoint-generation invalidation, and password persistence.

T5 — MCP transport and seven-tool registration

Implement fail-closed NOT_READY startup, Streamable HTTP session lifecycle, structured protocol errors, authentication middleware, exact seven-tool registration, Zod schemas, and limits.

G3 — Authenticated local MCP

A real local client completes OAuth and calls safe test paths through every tool schema. Unauthenticated, wrong-resource, stale-endpoint, revoked, replayed, and expired credentials fail correctly. The public tunnel has not yet been claimed.

T6 — File tools

Implement read/text/image behavior, final-symlink-to-stable-regular-file resolution, write, edit, exact matching, conflict detection, mutating-path symlink rejection, audit integration, byte limits, and atomic replacement. Use real temporary files and magic-byte image fixtures.

T7 — Skills and memory catalogs

Implement bounded async discovery, atomic catalog swaps, deterministic malformed-frontmatter diagnostics, read-only external skills/memory, Loom-owned stable memory IDs, crash-recovered delete tombstones, safe save/delete, search, and rescan.

T8 — Dashboard

Implement static dashboard, nonce/session/CSRF, exact Host/Origin checks, strict headers, redaction, and approved actions.

T9 — Browser subsystem

Implement explicit browser setup, pinned revision verification, guarded dynamic import, separated public tool and backend modules, wrapper-owned Chromium with direct executable/argument spawning, persistent profile, lock recovery, bounded per-tab evaluation recovery, tabs/actions/navigation validation/downloads/collision-safe persisted screenshots/permissions/geolocation, and bounded output.

G4 — Local complete runtime

All seven tools, dashboard, browser-degraded mode, and browser-enabled mode pass locally. Browser persistence is proven across controlled restarts using the dedicated profile. No normal Chrome profile is touched.

T10 — Cloudflared acquisition and validation

Implement pinned architecture-aware official-HTTPS download with bounded redirects and a bounded 30-minute deadline, exact archive byte/hash verification, safe single-file extraction, exact executable hash/version verification, atomic install and cleanup, permissions, safe canonicalization of normal PATH symlinks, fail-closed first-match PATH reporting, and direct executable-plus-argument `tunnel --no-autoupdate --metrics 127.0.0.1:0` wrapper launch with reserved-option rejection.

T11 — Tunnel-independent runtime readiness

Introduce the initial readiness-only subset of `src/runtime.ts` and `test/runtime.test.ts`: validate loopback ephemeral local endpoints, preserve deterministic NOT_READY behavior until public binding, canonicalize an exact HTTPS public origin plus `/mcp` resource, generate the one-time ready status block data, and write private atomic `runtime/current.json`. This task must not start tunnels, browsers, catalogs, signal handlers, or cleanup orchestration. T14 expands the same module and test file into the full startup/shutdown lifecycle.

T12 — Quick Tunnel

Implement pre-launch config conflict detection, strict bounded split-output parsing and registration within 15 seconds, unsafe-URL fail-closed behavior, exactly one cleaned transient recreation, endpoint invalidation through runtime/OAuth binding, owner-password persistence, audit secrecy/fail-closed behavior, and visible non-production status. Deterministic tests are the gate; one real Quick smoke test remains optional and cannot certify production behavior.

T12.1 — Transient process-group signal hardening

Before T13, add deterministic coverage for a transient negative-PGID `SIGKILL` `EPERM` while the managed target ignores `SIGTERM`. Revalidate the recorded wrapper identity and current group membership before every retry, retry only within the existing absolute shutdown deadline, preserve `ESRCH` as already-gone, fail closed on persistent `EPERM`, and prove cancellation still resolves as cancelled with zero group members. Commit this blocker fix with full governance and green repository gates before named-tunnel work resumes.

T13 — Named Tunnel

Implement canonical stable-hostname config; stable private origin-certificate and current credential validation with exact account/name matching; explicit ephemeral origin argv; registration-gated production status; audit secrecy/fail-closed ordering; no Quick fallback; transient-only retries with five-retry/60-second caps, per-attempt revalidation, and cleanup; prompt stop-during-startup cancellation; and stable endpoint/OAuth-generation plus owner-password persistence behavior.

T13.1 — Terminal tool implementation recovery

Before T14, implement the missing `loom_terminal` handler that T5 registered but no later task supplied. Use exactly one static typed `ProcessManager.start()` adapter with `executable: '/bin/sh'` and `args: ['-lc', command]`; reflection, `Function.toString()`, alternate method names/result shapes, PTY, and usable stdin are forbidden. Canonicalize absolute-or-home cwd through `realpath` and accept safe cwd symlinks. Validate explicit environment overrides and all centralized terminal byte/count/time limits. Return stable `job_<uuid>` IDs; expose bounded cursor/gap polling and at most 60 seconds of wait; keep command output only in MCP content and lifecycle/cursor data only in structured metadata. Audit start and cancel before launch/signaling without command, cwd, environment, or output bytes; audit failure blocks those mutations while poll remains available. Propagate timeout/cancel state, remove complete owned process groups, retain at most 128 jobs, never evict a running job, await completion/audit before eviction, and cancel all retained running jobs during runtime shutdown. Add the terminal dispatcher to the fallback chain and prove real output, environment/cwd, audit fail-closed/secrecy, timeout, descendant cancellation, retention, dispatcher routing, repeated stress, rapid natural-exit wrapper handshakes, and zero residue. Commit this recovery separately with full governance before runtime orchestration.

T14 — Full runtime orchestration and signal cleanup

Expand the T11 readiness module into the real foreground runtime and production assembly. Validate support/config before acquiring an exclusive identity-bound lock; create audit and ProcessManager only after lock ownership; compose all seven concrete dispatchers; start MCP NOT_READY, dashboard, catalogs, verified browser or explicit unavailable mode, and the selected verified Quick/Named tunnel; bind/publish the exact public `/mcp` only after tunnel readiness; print one secret-free status block; by default request opening of the single-use authenticated local dashboard bootstrap URL through direct `/usr/bin/open`, while treating local-open failure as nonfatal and allowing an explicit no-op/capture seam in tests; and remain foreground. The production factory may expose only narrow explicit browser/tunnel/skill-root test overrides, not a generic dependency-injection container. Dashboard actions must call strict audited config/OAuth/browser/catalog/runtime APIs. `loom launch --yolo` requires local `/dev/tty`, macOS 14+/Node 22+, prints the warning and first owner password only there, and runs the signal-aware foreground runtime; plain launch remains refused. Shutdown is idempotent for explicit stop, dashboard stop, SIGINT, and SIGTERM; it rejects new terminal jobs, cancels terminal groups, closes browser, tunnel, MCP and dashboard, drains ProcessManager and audit under the 15-second absolute deadline, verifies `runtime/current.json` still has the exact private identity and serialized readiness snapshot Loom wrote before deleting it, verifies the persisted lock identity before deleting `loom.lock`, and preserves replaced/uncertain ownership fail-closed. Tests must use real audit, ProcessManager/terminal, MCP, dashboard, catalogs, runtime lock/state and dispatcher chain with controlled browser/tunnel lifecycles, proving normal stop, startup failure, stop during startup, signal stop, public-listener termination, browser-degraded mode, lock ownership/replacement, deadline-preserved ownership, factory cleanup, CLI routing/TTY refusal, and repeated zero-residue stress.

G5 — Real named-tunnel and ChatGPT prerequisite gate

Record that an eligible ChatGPT workspace/account with custom MCP/developer-mode support is available. Establish a real named tunnel to the exact ephemeral origin. Verify public OAuth discovery and canonical `/mcp` routing before connector setup.

G6 — Real end-to-end cleanup gate

Through real ChatGPT, authorize using the persistent owner password and call representative terminal, read, write/edit, skills/memory, and browser operations. Verify refresh and reconnect behavior. Capture process tables before launch, while running, and after Ctrl+C, SIGTERM, terminal close, and forced parent death. Public access must stop and no owned descendant may remain.

T15 — Packaging and documentation

Finalize README, install/setup guide, security warning, Cloudflare named-tunnel guide, browser setup, config/auth reset behavior, troubleshooting, license/notices, npm file list, shebang/executable behavior, and clean packed install. Do not publish.

T15.1 — Fail-closed certification evidence tooling

Add a packaged `loom-certify` command that collects deterministic local gates for the exact clean commit, validates the strict shape and release SHA of optional external evidence manifests, verifies pinned managed-component metadata, hashes private regular-file artifacts without following symbolic links, and writes a private canonical report. Self-reported fields or artifact hashes must never be treated as proof that Cloudflare, ChatGPT, OAuth, tool-call, cleanup, clean-host, sleep/wake, or connector-persistence events occurred. G5–G7 therefore remain blocked until a human reviews the real sanitized evidence; the automated command may fail or report blocked but cannot independently grant production certification. Quick Tunnel evidence is optional and non-certifying. Package and symlink invocation, required release assets, process-residue coverage, and report-path safety require deterministic tests.

T15.2 — External expert audit dossier

Create one self-contained repository-root Markdown file for external expert audit. It must describe the complete product contract, trust boundary, architecture, startup and shutdown control flow, security invariants, state layout, process supervision, OAuth/MCP protocol, every public tool, browser and Cloudflare lifecycle, dashboard, certification model, dependency/package surface, implementation chronology, test/evidence status, and unresolved real-world gates. It must include the exact tracked-tree inventory, a source/export and test inventory generated from the current repository, a file-by-file ledger covering every tracked path, and verbatim snapshots of the canonical implementation plan plus the relevant design, scope, operations, security, release, evidence, and governance documents. The dossier is repository-only and must not widen the npm package allowlist or change runtime behavior. Add an executable documentation check that fails when the dossier is missing, omits mandatory audit sections, fails to identify the exact seven tools, omits the human-review certification boundary, or fails to represent a tracked path documented by REPO_MAP.md. Run the standard repository gates, map validation, dossier coverage validation, package dry run, and secret-pattern scan before committing.

T15.3 — Adversarial security verification and hardening

Treat the externally supplied audit claims as hypotheses and verify each against the actual implementation before changing code. Record false positives and intentional scope decisions separately from verified defects. For verified release blockers: cap MCP JSON bodies before SDK parsing and return structured 413 errors; throttle public owner-password authorization attempts with monotonic in-process accounting; raise new owner-password scrypt work factors to the current documented minimum while transparently upgrading a successfully verified legacy hash; keep an absolute refresh-token family lifetime across rotation; bound and locale-pin every watchdog `ps`/`lsof` subprocess; make reads of FIFO/device replacements nonblocking before regular-file verification; canonicalize only the root-owned macOS `/tmp` and `/var` compatibility aliases before mutation symlink checks; preserve terminal cancellation as a safety operation when audit storage is degraded while keeping terminal start fail-closed; use monotonic time for in-process watchdog, shutdown, session, and dashboard deadlines; recheck tombstone identity immediately before removal; and prove OSC/clipboard terminal controls are stripped. Do not weaken unrestricted-tool warnings, endpoint-bound OAuth, executable verification, or cleanup ownership.

Update the security, operator, development, README, specification, and audit dossier to state the residual risks that cannot honestly be removed inside Loom v1: indirect prompt injection from browser/file/skill/memory content; persistence of browser cookies and Loom memory across restart/auth reset; unrestricted data return to the authorized remote MCP client/provider; inherited and login-shell secrets; localhost/private-network pivoting; macOS TCC and Full Disk Access behavior; local-only incident containment; privacy-oriented rather than forensic/tamper-evident audit; deliberate process/session escape by unrestricted commands; local-filesystem-only crash-durability assumptions; indefinite user-managed download/screenshot retention; terminal scrollback exposure of the owner password; and the lack of an out-of-band signing root for the packaged certification tool. These disclosures must not be phrased as implemented mitigations. Keep Quick Tunnel non-production and G5–G7 blocked. Add deterministic RED/GREEN tests for each code change, update every affected tracked-file ledger entry, regenerate the complete audit dossier, rerun package/secret/residue/map gates, and do not publish.

T16 — Production certification on a clean supported Mac

- Clean clone or clean temporary directory.
- npm ci with no browser download.
- typecheck, tests, build.
- npm pack and install tarball in a clean prefix.
- loom --version and --help.
- loom setup browser and pinned-revision verification.
- real named tunnel with stable HTTPS hostname.
- real ChatGPT OAuth, access-token refresh, reconnect, and representative seven-tool calls.
- owner password unchanged across restart and tunnel lifecycle, then changed only by `loom auth reset`.
- browser profile persists across restart.
- process tables prove cleanup for all required signal paths.
- sleep/wake is manually exercised and recorded; automated tests alone may not claim it.
- connector persistence is manually observed and recorded; tests may not claim it.
- all evidence committed under docs/release-evidence/.
- repository clean.

G7 — Release-ready

All prior gates pass with committed evidence, zero unresolved release blockers, a clean packed install, and clean repository. No push or npm publication without explicit user instruction.

24. VALIDATION COMMANDS

Standard:

- npm run typecheck
- npm test
- npm run build
- git status --short

Map validation must compare `git ls-files | sort` with the path list extracted from REPO_MAP.md and report no difference.

Package validation:

- npm pack
- install tarball into a clean temporary prefix
- run the installed `loom --version` and `loom --help`

Process evidence command:

`ps -axo pid,ppid,pgid,sid,command | grep -E 'loom|cloudflared|browser-profile' | grep -v grep`

Record it before launch, while running, and after every required shutdown path.

25. HANDOFF FORMAT

HANDOFF.md always records:

- date and local time
- checkout path
- branch
- HEAD SHA
- clean or dirty state
- current task
- last completed gate
- exact commands run
- test results
- known failures
- real blockers
- files changed
- pushed/published status
- exact next command
- next expected result

26. START INSTRUCTION

Begin with T0. Do not begin feature coding until the governance files are tracked, REPO_MAP is exhaustive, and G0 passes. Continue in task order. Stop only for a real unresolved blocker or completed approved scope. Never substitute a mock, parser unit test, or local-only test for the real external evidence reserved for T16.
~~~~~

### Embedded source: `README.md`

- Bytes: `8766`
- Lines: `211`
- SHA-256: `48d9cedb8f6bb831f45f35cdba15796dcb258b251338b5f89fa1be5495a977bc`

~~~~~markdown
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

## Unrestricted-agent risk

Loom authenticates the remote client; it does not make that client, its model, or the content it reads trustworthy. A browser page, local file, skill, or saved memory can contain prompt injection that persuades an authorized agent to call another Loom tool. Browser snapshots, file contents, terminal output, screenshots, skills, and memory returned through MCP may leave this Mac and be processed or retained by the authorized remote client or LLM provider.

The dedicated persistent browser profile keeps cookies and logged-in sessions across Loom restarts. Loom memory also persists, and `loom auth reset` does not clear either one. HTTP navigation to localhost and the private network is allowed, so an authorized or manipulated client can reach services that trust local network position. Use a dedicated macOS account when possible, start Loom from a minimal environment, avoid logging sensitive accounts into its browser profile, and treat every tool result as untrusted content.

Containment is local-only: the dashboard and foreground stop control bind to this Mac. There is no separate remote kill service. See the operator and security guides before enabling YOLO mode.

## Security and operations

- [Operator guide](docs/OPERATOR.md)
- [Security model](docs/SECURITY.md)
- [Development and governance](docs/DEVELOPMENT.md)
- [Release certification](docs/RELEASE_CERTIFICATION.md)
- [Release evidence index](docs/release-evidence/README.md)

## License and notices

Loom source is licensed under the MIT License. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Chromium and Cloudflared are separately distributed third-party components and retain their own licenses and trademarks.
~~~~~

### Embedded source: `docs/DEVELOPMENT.md`

- Bytes: `7427`
- Lines: `201`
- SHA-256: `7f5326ade05681754572f79a27ad17b1ed5257c3c3e0071dc5d2955ecb0759ff`

~~~~~markdown
# Loom Development Guide

This repository uses the Cavekit governance and evidence discipline recorded in the root files.

## Required reading order

Before changing code, read:

1. `SPEC.md`
2. `AGENTS.md`
3. `REPO_MAP.md`
4. `CHANGELOG.md`
5. `HANDOFF.md`
6. `ALGORITHM.md`
7. `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`

Then run the exact startup command in `HANDOFF.md`.

## Supported development environment

- macOS 14 or newer
- Node.js 22 or newer
- npm with the committed lockfile

Install exactly:

```bash
npm ci
```

## Core commands

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Useful targeted examples:

```bash
npm run build && node --test dist/test/runtime.test.js
npm run build && node --test dist/test/process-manager.test.js dist/test/watchdog.test.js
npm run build && node --test dist/test/terminal.test.js
npm run build && node --test dist/test/cloudflare.test.js
npm run build && node --test dist/test/browser.test.js
```

`npm test` always performs a clean TypeScript build before running compiled tests.

## Test-first rule

For each behavior change:

1. Record the task and acceptance check in `HANDOFF.md`.
2. Write the smallest failing test.
3. Run it and retain the expected RED evidence.
4. Implement the minimum production change.
5. Run the targeted test to GREEN.
6. Run typecheck, full tests, and build.
7. Update `REPO_MAP.md`, `CHANGELOG.md`, and `HANDOFF.md` in the same commit.
8. Update `SPEC.md` and the canonical plan when behavior, architecture, security, or scope changes.
9. Validate the staged repository map against `git ls-files`.
10. Commit one coherent task.

## Same-commit governance

Every repository-changing commit must update:

- `REPO_MAP.md`
- `CHANGELOG.md`
- `HANDOFF.md`

Behavior or security changes also update `SPEC.md`. Task regrouping or path-ownership changes update the canonical plan before code is changed.

The staged map check is:

```bash
actual=$(mktemp)
mapped=$(mktemp)
git ls-files | sort > "$actual"
grep '^### `' REPO_MAP.md | sed -E 's/^### `([^`]*)`$/\1/' | sort > "$mapped"
comm -3 "$actual" "$mapped"
rm -f "$actual" "$mapped"
```

The output must be empty.

## Architectural constraints

Do not add:

- hidden daemons or launchd
- automatic startup
- a generic dependency-injection container
- a plugin runtime or event bus
- workspaces or command approval
- PTY or usable stdin
- path allowlists
- shell strings for browser or Cloudflared
- reflection or method-shape guessing
- automatic Named-to-Quick fallback

The terminal tool alone uses the static `/bin/sh -lc` adapter. Browser and Cloudflared use verified executable paths and explicit argument arrays through `ProcessManager`.

## Process tests

Real-process tests must leave no wrapper, target, grandchild, browser, or Cloudflared residue. Use the existing process-table helpers and inspect the exact owned PGID. Never widen cleanup to unrelated processes.

After process-heavy tests, verify:

```bash
ps -axo pid,ppid,pgid,user,command \
  | grep -E 'child-wrapper|loom-process-|loom-terminal-|loom-runtime-' \
  | grep -v grep || true
```

A machine may run unrelated Cloudflared infrastructure. Residue checks must identify Loom ownership rather than killing every process named `cloudflared`.

Process-group cleanup covers ordinary descendants. Because `loom_terminal` is unrestricted, a target can deliberately call `setsid()` or create a new session and escape the owned PGID. T15.3 reproduced that behavior with a controlled child and cleaned it manually. Do not broaden the implementation claim to deliberate daemon escape unless the product scope changes to an actual sandbox or OS-level containment mechanism.

## State and secret handling

Never place these in test output, fixtures committed to Git, audit metadata, screenshots, or documentation examples:

- real owner passwords
- OAuth access or refresh tokens
- Cloudflare API tokens or tunnel secrets
- real authorization headers
- browser typed secrets
- private file content

Use temporary directories and synthetic values. Tests that intentionally contain marker strings must assert those strings are absent from audit and structured metadata.

## Filesystem durability assumptions

Atomic replacement and parent-directory sync are designed and tested on the supported local macOS filesystem. Standard `fsync()` does not by itself establish complete power-loss durability on every Apple storage stack; Apple documents `F_FULLFSYNC` as the stronger request when hardware-cache flush is required. Loom v1 does not call `F_FULLFSYNC`, does not certify state roots on NFS/SMB/network mounts, and must not describe same-directory rename plus `fsync` as proof against sudden power loss. Tests cover process-level failure and atomic visibility, not storage-controller guarantees.

## Browser development

`npm install` must not download Chromium. Use:

```bash
loom setup browser
```

Browser tests use deterministic fake backends for public-tool policy and targeted real wrapper/CDP checks for executable verification and shutdown. Optional external smoke tests are not release gates unless the certification plan explicitly promotes them. The browser profile is intentionally persistent; test fixtures and reviews must consider cookies and local storage as cross-run state rather than assuming a fresh security context.

## Cloudflare development

Pinned release metadata lives in `src/cloudflare.ts`. Changing a version or hash requires:

- official release URL verification
- exact archive byte count
- archive SHA-256
- extracted executable SHA-256
- architecture coverage
- real version probe
- real install evidence
- specification, map, changelog, and handoff updates

Never replace fail-closed verification with "latest" discovery.

## Packaging

The package includes only:

- compiled `dist/`
- dashboard assets in `public/`
- documentation in `docs/`
- `README.md`
- `LICENSE`
- `NOTICE`

`prepack` performs a clean build. Inspect every package with:

```bash
npm pack --dry-run
```

Then install the tarball into a clean temporary prefix and test the installed `loom` command. Do not publish or push without explicit user instruction.

## Adversarial-review discipline

Treat external findings as hypotheses. Verify the actual code and pinned dependency before changing behavior. Record each finding as verified/fixed, verified/residual, false positive, or intentional scope. T15.3 examples include an actual unbounded SDK JSON-parser boundary and deliberate process-session escape, alongside disproven claims about CDP binding, OAuth entropy, job-ID randomness, config-backup mode, OSC 52 stripping, and Cloudflared launch re-verification.

Security tests must cover the layer before schema validation, not just Zod handlers. Request-size limits belong before JSON parsing. Time-sensitive in-process safety deadlines use monotonic clocks; persisted OAuth expirations and human-readable timestamps remain wall-clock values by design.

## Evidence discipline

Deterministic tests prove local behavior only. They do not prove:

- real Cloudflare DNS routing
- real Named Tunnel account state
- ChatGPT custom MCP availability
- real ChatGPT OAuth/reconnect/tool behavior
- sleep/wake connector persistence
- a clean supported-Mac installation

Those claims require the corresponding real evidence in `docs/RELEASE_CERTIFICATION.md` and `docs/release-evidence/`.
~~~~~

### Embedded source: `docs/OPERATOR.md`

- Bytes: `9911`
- Lines: `251`
- SHA-256: `f86eafb19a47d6a6782a9c5867dc0fa46c566789f12b8c57357b07b3c4c5ad89`

~~~~~markdown
# Loom Operator Guide

This guide describes the supported foreground workflow for a single macOS owner.

> **FULL COMPUTER ACCESS ENABLED — sharing the owner password or authorizing an untrusted client is equivalent to giving away this macOS account.**

## Requirements

- macOS 14 or newer
- Node.js 22 or newer
- A direct local terminal with `/dev/tty`
- Cloudflare credentials for Named Tunnel production use
- Browser setup only when `loom_browser` is required

macOS TCC still applies. Desktop, Documents, Downloads, network volumes, Full Disk Access, Accessibility, Automation, Camera, and Microphone can require local approval and may fail with `Operation not permitted`. Loom cannot bypass or reliably answer those prompts remotely.

## Preflight for an unrestricted launch

- Prefer a dedicated macOS account with no personal browser profile or exported cloud credentials.
- Launch from a minimal environment rather than a development shell containing sensitive environment variables. `/bin/sh -lc` inherits Loom's environment and can source login-shell profile files.
- Review `~/.profile`, `~/.bash_profile`, and other shell startup files for secrets or commands that should not run on every terminal invocation.
- Close screen sharing and terminal recording. The owner password can remain in terminal scrollback after first launch or reset.
- Treat browser pages, files, skills, memory, and terminal output as untrusted content that can carry prompt injection to the authorized agent.
- Decide whether the authorized remote client or LLM provider is permitted to receive file contents, command output, page text, and screenshots.

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

The browser can be omitted. Loom will mark browser tools unavailable while the terminal, file, skill, memory, and MCP services remain usable. When enabled, the dedicated persistent browser profile retains cookies, local storage, and login state across Loom restarts and can expose those sessions to a later authorized client.

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

The command requires a direct local terminal. Loom prints the warning locally. On first installation it prints the owner password once. Store it securely and never paste it into chat, source control, screenshots, logs, or tickets. Terminal scrollback, session recording, shell history tooling, and screen sharing can retain the display even though Loom does not write the password to its audit log.

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

Shutdown rejects new terminal jobs, cancels retained terminal groups, closes the managed browser, stops Cloudflared, closes MCP and dashboard listeners, drains ProcessManager and audit, and removes ownership files only after cleanup certainty. A deliberate unrestricted command can call `setsid()` or otherwise detach into a new session and escape Loom's process group; ordinary descendant cleanup does not guarantee removal of such an intentionally escaped daemon.

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

This requires local confirmation, rotates the owner password, increments OAuth generation, and revokes registered clients, pending authorizations, codes, access tokens, and refresh tokens. Auth reset does not delete browser state, memory, skills, audit history, downloads, screenshots, shell profiles, scheduled jobs, or general configuration. It is credential revocation, not complete incident remediation.

Tunnel URL or hostname changes never rotate the owner password.

## Incident containment while remote

The dashboard and foreground stop controls are local-only. Loom has no separate remote kill switch. If an authorized client behaves maliciously while you are away, containment requires physical access or another trusted remote-administration path to the Mac. Do not rely on the compromised agent to revoke itself.

After stopping Loom:

1. Verify public access and Loom-owned processes are gone.
2. Rotate the owner password and revoke Cloudflare credentials when relevant.
3. Inspect `~/.loom/memory/`, configured skill roots, shell profile files, launch agents, cron/scheduled jobs, and files modified by the client.
4. Decide whether to remove or archive `~/.loom/browser-profile/` and `~/.loom/downloads/`; browser cookies, downloads, and screenshots persist until the operator removes them.
5. Treat audit as a coarse activity record, not forensic proof. Commands, output, page text, file content, and typed values are deliberately omitted, and an authorized shell client can modify local logs.

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

Audit is private operational logging, not a tamper-proof or forensic security boundary against the same macOS user or an authorized remote shell client. Downloads, screenshots, memory, and browser-profile data have no automatic retention policy; the operator must review and remove them when appropriate.
~~~~~

### Embedded source: `docs/SECURITY.md`

- Bytes: `15132`
- Lines: `203`
- SHA-256: `a2b1657980676b2fc41166b37ebeefb3caa9be65781c81aca38a03d8aaba3a3b`

~~~~~markdown
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

Launch requires a direct local `/dev/tty`, macOS 14 or newer, and Node.js 22 or newer. Loom prints the full-access warning locally. A newly generated owner password is displayed only on that local terminal.

There is no launchd job, login item, auto-start, or detached long-lived Loom daemon.

## Owner password

The owner password is a persistent installation credential stored only as a scrypt-derived verifier. New verifiers use scrypt N=32768, r=8, p=3; a successful authorization transparently upgrades an older N=16384, r=8, p=1 verifier. It is created once and changes only through:

```bash
loom auth reset
```

The reset command requires direct local confirmation. It rotates the owner credential and revokes OAuth state. Restarts, Quick Tunnel changes, Named Tunnel changes, browser reset, configuration reset, refresh-token rotation, and package upgrades do not rotate it.

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

The owner password is shown on the local terminal. Terminal scrollback, shell recording, screen sharing, and screenshots can retain it. Clear or protect those surfaces after first launch or reset.

## Incident response

1. Stop Loom with `Ctrl+C` or terminate the foreground process.
2. Verify no Loom-owned wrapper, terminal, browser, or Cloudflared process remains.
3. Inspect `runtime/current.json`, `runtime/loom.lock`, and private audit files.
4. Rotate the owner password with `loom auth reset` if authorization may have been exposed.
5. Do not treat reset as full remediation: it does not clear memory, skills, browser cookies/profile state, downloads, screenshots, shell profiles, scheduled jobs, or files written by the client. Review or remove those separately while Loom is stopped.
6. Revoke or replace Cloudflare credentials if tunnel credentials may have been exposed.
7. Preserve state and logs before manual cleanup when ownership files were intentionally retained fail-closed, while recognizing that the local audit cannot prove which commands or content were used.
~~~~~

### Embedded source: `docs/RELEASE_CERTIFICATION.md`

- Bytes: `7029`
- Lines: `132`
- SHA-256: `b4f5de628cb1fa33772cfc33d88fceac26d51de22e998f59161bcc2922dc0da0`

~~~~~markdown
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
15. record the exact tarball SHA-256 and bind every external artifact to that hash as well as the Git commit
16. independently inspect the installed tarball bytes rather than trusting the packaged `loom-certify` implementation alone

The repository and tarball do not contain an out-of-band root of trust. A compromised source tree could alter both Loom and `loom-certify`. Production certification therefore requires an independently recorded artifact hash and, when distribution begins, a detached signature or equivalent verification performed by tooling outside the package under review. The in-package certification command cannot certify its own integrity.

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
- tamper-proof or complete forensic audit
- cleanup of a command that deliberately escapes the owned process group with `setsid()` or an equivalent new session
- automatic removal or safe retention of persistent browser cookies, downloads, screenshots, or Loom memory after an incident
- protection from indirect prompt injection in files, pages, skills, memory, or terminal output
- artifact authenticity from Git commit status or the in-package certification tool without an independently checked artifact hash or detached signature

## Evidence storage

Store sanitized evidence under `docs/release-evidence/` and index it in `docs/release-evidence/README.md`. Never commit owner passwords, OAuth tokens, Cloudflare secrets, authorization headers, private file content, or unredacted account identifiers.
~~~~~

### Embedded source: `REPO_MAP.md`

- Bytes: `53242`
- Lines: `583`
- SHA-256: `d175526b35de87e4a106d20f75de897b0a52601df44ae24b8d94aeb6a14e33ae`

~~~~~markdown
# Loom Repository Map

Assessment key: `PASS` = present and validated for its current gate; `PARTIAL` = present but later work remains; `FAIL` = known broken; `PLANNED` = intentionally absent until its owning task.

This map is exhaustive for the tracked governance baseline. Validate it against `git ls-files | sort` before every gate/commit that changes tracked files.

## Tracked files

### `.gitignore`
- **Purpose:** Excludes dependencies, build output, packages, macOS metadata, coverage, and local skill-observation state.
- **Success check:** `git status --short` does not show ignored runtime/generated directories.
- **Current assessment:** PASS
- **Evidence:** Contains `node_modules/`, `dist/`, `*.tgz`, `.DS_Store`, `coverage/`, and `skill-observations/`.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0 / G0.

### `AGENTS.md`
- **Purpose:** Mandatory execution, TDD, governance, and completion contract for implementation agents.
- **Success check:** Requires canonical read/startup order, test-first work, explicit plan amendments before task regrouping, same-commit governance, and green typecheck/test/build/map gates before commits.
- **Current assessment:** PASS
- **Evidence:** T5 recovery hardened the execution contract after the adversarial review exposed task drift.
- **Last meaningful change:** T5 recovery governance hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0 and all later gates.

### `ALGORITHM.md`
- **Purpose:** Compact ordered implementation loop.
- **Success check:** Twenty lines or fewer, plan amendment required before regrouping/skipping, and commits require green typecheck/tests/build/map/governance.
- **Current assessment:** PASS
- **Evidence:** Fifteen numbered steps remain within the line limit and match AGENTS.md.
- **Last meaningful change:** T5 recovery governance hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0 and all later gates.

### `CHANGELOG.md`
- **Purpose:** Human-readable implementation and evidence history.
- **Success check:** Updated in every repository-changing commit with actual command, test, package, and certification-boundary evidence.
- **Current assessment:** PASS
- **Evidence:** Records T15.3 code-grounded adversarial triage, every verified fix/residual/false-positive class, the 214/214 full gate, transient-EPERM stress, and the 90-file hardened tarball SHA/install evidence.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** All tasks; current T15.3.

### `EXTERNAL_AUDIT.md`
- **Purpose:** One self-contained external expert audit dossier covering the complete product, architecture, security model, control flows, implementation chronology, evidence boundaries, every tracked path, generated source/test inventories, and verbatim governing documents.
- **Success check:** Executable documentation tests require the mandatory audit sections, exact seven tools, human-review/no-proof boundary, and representation of every path documented by this repository map; generated inventories and embedded source snapshots must match the current tracked state.
- **Current assessment:** PASS
- **Evidence:** Regenerated after T15.3 to include the hardened implementation, 74-file ledger, 214 static test declarations, adversarial evidence, residual-risk disclosures, and updated canonical documents; final dossier integrity and coverage gates pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15.2 and T15.3.

### `HANDOFF.md`
- **Purpose:** Exact resumable state, commands, failures, blockers, SHA, and next action.
- **Success check:** Contains every field required by plan Section 25 and an executable next command.
- **Current assessment:** PASS
- **Evidence:** Records T15.3 scope, verified findings, exact tests/package evidence, real residual blockers, resulting commit candidate, and next command.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** All tasks; current T15.3.
### `LICENSE`
- **Purpose:** MIT license for Loom source distribution.
- **Success check:** Valid MIT license text with copyright attribution.
- **Current assessment:** PASS
- **Evidence:** Present at repository root.
- **Last meaningful change:** T0 governance baseline, 2026-07-07.
- **Owning task or gate:** T0 / T15.

### `README.md`
- **Purpose:** Public package overview, safety warning, supported commands, setup, tunnel/browser behavior, and documentation links.
- **Success check:** Matches the implemented CLI and trust boundary without claiming real ChatGPT or production certification.
- **Current assessment:** PASS
- **Evidence:** Public overview now warns that untrusted tool content can prompt-inject the authorized agent, MCP results leave the Mac, browser/memory state persists, localhost/private-network access is allowed, and containment is local-only.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `REPO_MAP.md`
- **Purpose:** Exhaustive tracked-file ledger with ownership, checks, assessment, and evidence.
- **Success check:** Extracted path headings exactly match `git ls-files | sort` after staging, with no undocumented tracked files.
- **Current assessment:** PASS
- **Evidence:** Documents all 74 tracked T15.3 files and exact changed responsibilities; staged-tree comparison is required to be empty before commit.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** All tasks; current T15.3.
### `SPEC.md`
- **Purpose:** Approved behavioral, security, dependency, command, packaging, and release contract.
- **Success check:** Matches the canonical plan and prevents deterministic tooling or self-reported manifests from substituting for real external certification.
- **Current assessment:** PASS
- **Evidence:** Locks the body limit, authorization throttling, scrypt migration, refresh-family lifetime, monotonic/bounded watchdog behavior, macOS alias/nonblocking read policy, safety-action audit exception, tombstone/OSC checks, and explicit residual risks.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0 and every behavior-changing task; current T15.3.
### `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- **Purpose:** Full self-contained ordered implementation plan and certification contract.
- **Success check:** Covers Sections 0–26, T0–T16, G0–G7, explicit recovery subtasks, governance gates, and external-evidence boundaries.
- **Current assessment:** PASS
- **Evidence:** Adds T15.3 for code-grounded adversarial verification, concrete hardening, residual-risk disclosure, deterministic regressions, dossier regeneration, and unchanged external certification blockers.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T0 / G0; source of truth for all later tasks.
### `NOTICE`
- **Purpose:** Distribution notice for Loom and third-party software/trademarks.
- **Success check:** Ships in the public tarball and names the license plus major third-party components without claiming affiliation.
- **Current assessment:** PASS
- **Evidence:** Present in the 90-file package and clean-prefix installation.
- **Last meaningful change:** T15 release notice, 2026-07-08.
- **Owning task or gate:** T15 packaging and documentation.
### `docs/DEVELOPMENT.md`
- **Purpose:** Developer workflow, architecture, validation, security boundaries, and unsupported-claim guidance.
- **Success check:** Matches the implemented task/gate workflow and does not replace external evidence with local tests.
- **Current assessment:** PASS
- **Evidence:** Documents deliberate session escape, APFS/F_FULLFSYNC and local-filesystem durability limits, persistent browser state, code-grounded review discipline, and pre-schema request-boundary testing.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `docs/OPERATOR.md`
- **Purpose:** Supported installation, configuration, launch, dashboard, shutdown, recovery, and diagnostic guide for the single macOS owner.
- **Success check:** Lists only real commands and accurately states the full-access, TTY, owner-password, tunnel, browser, and cleanup boundaries.
- **Current assessment:** PASS
- **Evidence:** Adds TCC, minimal-environment/login-shell guidance, prompt-injection/provider disclosure, persistent profile and artifact handling, terminal-scrollback caution, local-only containment, and complete incident review beyond auth reset.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `docs/RELEASE_CERTIFICATION.md`
- **Purpose:** Public distinction between deterministic readiness, production eligibility, and real externally reviewed certification.
- **Success check:** Documents G5/G6/T16 evidence, forbidden claims, and that `loom-certify` cannot prove external events or independently certify.
- **Current assessment:** PASS
- **Evidence:** Requires exact tarball hash and independent artifact verification, states the absence of an out-of-band trust root, and forbids claims about prompt injection, deliberate process escape, forensic audit, or automatic persistent-state cleanup.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15, T15.1, T15.3, G5–G7, and T16.
### `docs/SECURITY.md`
- **Purpose:** Public security model for unrestricted tools, OAuth, process ownership, files, browser, tunnels, dashboard, state, audit, and incident response.
- **Success check:** Matches the approved trust boundary and explicitly identifies non-goals and same-user limitations.
- **Current assessment:** PASS
- **Evidence:** Expanded threat model covers authorized-agent prompt injection, provider disclosure, persistent browser/memory, sole-factor/throttling limits, deliberate session escape, TCC, LAN pivoting, inherited login-shell secrets, local-only containment, and non-forensic audit.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15 and T15.3.
### `docs/certification-evidence.example.json`
- **Purpose:** Sanitized strict example manifest for optional G5–G7 artifact-integrity validation.
- **Success check:** Uses current pinned arm64 Cloudflared/Chromium metadata, contains no secrets, omits optional Quick evidence, and cannot cause automatic certification.
- **Current assessment:** PASS
- **Evidence:** Parsed by certification tests; package includes the current example.
- **Last meaningful change:** T15.1 current pinned example and trust correction, 2026-07-08.
- **Owning task or gate:** T15.1 and T16.
### `docs/release-evidence/README.md`
- **Purpose:** Private-repository index and sanitization rules for deterministic and real external release evidence.
- **Success check:** Lists current T15 local evidence, required future G5/G6/clean-Mac artifacts, forbidden secrets, and human-review requirement.
- **Current assessment:** PASS
- **Evidence:** Indexes the T15.3 adversarial verification record while preserving all G5/G6/clean-Mac gates as not yet certified.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15–T16 and G5–G7.
### `docs/release-evidence/t15-local-package.md`
- **Purpose:** Sanitized deterministic record of the T15 candidate tarball and clean-prefix installation.
- **Success check:** Records environment, exact commands/results, package hash/size, installed binaries/assets, fail-closed launches, cleanup, and explicit external limitations.
- **Current assessment:** PASS
- **Evidence:** Records SHA-256 `3711d511bf530ec3d834b4a021d960cbb001af43c126c850069640bfd7f7a549`, 90 files, 204/204 tests, and no state creation.
- **Last meaningful change:** T15 local package evidence, 2026-07-08.
- **Owning task or gate:** T15 packaging and documentation.

### `docs/release-evidence/t15.3-adversarial-review.md`
- **Purpose:** Sanitized code-grounded classification of the five supplied adversarial audits, including verified fixes, verified residual risks, false positives, intentional scope tradeoffs, and controlled local experiments.
- **Success check:** Contains no secrets or simulated external evidence; every fixed claim names a regression, every residual risk is disclosed in public docs, and G5–G7 remain explicitly blocked.
- **Current assessment:** PASS
- **Evidence:** Records MCP/body/auth/scrypt/refresh/watchdog/path/read/cancel/tombstone/clock fixes, 64 MiB output and deliberate-session-escape experiments, false-positive evidence, and package/full-suite requirements.
- **Last meaningful change:** T15.3 adversarial verification evidence, 2026-07-08.
- **Owning task or gate:** T15.3 and T16.

### `package-lock.json`
- **Purpose:** Reproducible exact npm dependency graph.
- **Success check:** `npm ci` succeeds and direct dependencies match package.json exact pins.
- **Current assessment:** PASS
- **Evidence:** Generated by npm 11.12.1; install reported 106 packages and zero vulnerabilities.
- **Last meaningful change:** T0 dependency installation, 2026-07-07.
- **Owning task or gate:** T0 / G1.

### `package.json`
- **Purpose:** Package identity, Node floor, executable mappings, exact dependencies, scripts, and explicit public release allowlist.
- **Success check:** No dependency ranges; Node `>=22`; `loom` and `loom-certify` bins; public runtime/assets/docs/license/notice included; tests, plans, and release evidence excluded.
- **Current assessment:** PASS
- **Evidence:** Full suite passes 204/204; `npm pack --dry-run --json` reports 90 approved files; clean-prefix install executes both npm bin symlinks and fail-closed launch checks.
- **Last meaningful change:** T15/T15.1 public package allowlist and certification CLI, 2026-07-08.
- **Owning task or gate:** T0 / G1 and T15/T15.1.
### `src/audit.ts`
- **Purpose:** Private durable JSONL audit logging with bounded serialization, mutation fail-closed deadlines, rotation, retention, degradation state, and metadata redaction.
- **Success check:** Mutation start resolves only after fsync, saturation/deadline/write failure disables later mutations, reads remain non-throwing, files remain 0600 in a 0700 directory, rotation is parseable, and forbidden values never appear.
- **Current assessment:** PASS
- **Evidence:** `test/audit.test.ts` passes 8/8; full suite passes 47/47.
- **Last meaningful change:** T3 audit completion, 2026-07-08.
- **Owning task or gate:** T3; integrated by terminal, files, memory, browser, and runtime tasks.

### `src/atomic-file.ts`
- **Purpose:** Durable same-directory atomic replacement with per-canonical-path serialization and optimistic conflict detection.
- **Success check:** Enforces the write-size limit, rejects symlink paths, preserves existing mode, creates new files as 0600, fsyncs file and parent directory, cleans temporary files, and allows only one concurrent writer sharing an expected hash to succeed.
- **Current assessment:** PASS
- **Evidence:** `test/atomic-file.test.ts` passes 5/5; full suite passes 14/14.
- **Last meaningful change:** T1 atomic-file foundation, 2026-07-08.
- **Owning task or gate:** T1; reused by config, OAuth, audit state, memory, and file tools.

### `src/browser.ts`
- **Purpose:** Dependency-free browser backend contract, result types, and typed public/backend error hierarchy.
- **Success check:** Defines every approved browser action result and shutdown contract without loading Playwright or performing side effects.
- **Current assessment:** PASS
- **Evidence:** Imported by both public policy and backend modules; browser target and full 120-test suite typecheck and pass.
- **Last meaningful change:** T9 browser contract separation, 2026-07-08.
- **Owning task or gate:** T9 / G4.

### `src/browser/backend.ts`
- **Purpose:** Wrapper-owned persistent Chromium/CDP lifecycle, tabs/actions, browser lock recovery, bounded page operations, downloads, screenshots, permissions, geolocation, and graceful shutdown.
- **Success check:** Uses direct ProcessManager executable/argv launch, guarded Playwright import, dedicated profile, PID-reuse-safe lock recovery, twelve-tab bound, per-tab timeout recovery, private no-overwrite artifacts, CDP `Browser.close`, and bounded cancellation fallback.
- **Current assessment:** PASS
- **Evidence:** Deterministic browser tests cover lock identity, false positives, downloads, shutdown, snapshot/evaluate recovery, and dispatcher boundaries; real Chrome restored localStorage across two controlled restarts with no process or lock residue.
- **Last meaningful change:** T9 managed Chromium backend and profile-persistence repair, 2026-07-08.
- **Owning task or gate:** T9 / G4; composed by T14 runtime.

### `src/browser/setup.ts`
- **Purpose:** Explicit architecture-pinned Chromium acquisition, exact executable verification, wrapper-owned launch proof, private manifest, atomic promotion, and pinned metadata export.
- **Success check:** Retains install/rollback/security behavior and exposes only the architecture-specific pinned executable SHA required by certification validation.
- **Current assessment:** PASS
- **Evidence:** Browser tests remain green; T15.1 external evidence rejects non-pinned Chromium revision/hash; full suite passes 204/204.
- **Last meaningful change:** T15.1 pinned certification metadata export, 2026-07-08.
- **Owning task or gate:** T9 / G4, T15.1, and T16 certification.
### `src/certification-cli.ts`
- **Purpose:** Packaged command boundary for deterministic evidence collection, optional manifest/artifact validation, private report output, and blocked/fail exit semantics.
- **Success check:** Executes through npm bin symlinks, never auto-certifies external gates, reports deterministic failure as 1 and unresolved external gates as 2.
- **Current assessment:** PASS
- **Evidence:** Five CLI tests pass, including real package-bin symlink execution and supplied evidence remaining blocked.
- **Last meaningful change:** T15.1 fail-closed certification CLI and symlink repair, 2026-07-08.
- **Owning task or gate:** T15.1 and T16.
### `src/certification.ts`
- **Purpose:** Strict deterministic certification collector, external manifest schema, artifact verifier, package validator, residue scanner, report evaluator, and private writer.
- **Success check:** Binds evidence to exact SHA/current pins, rejects unsafe package/report/artifact paths, detects Loom residue, and keeps G5–G7 blocked pending human review.
- **Current assessment:** PASS
- **Evidence:** Fourteen certification tests plus five CLI/docs tests pass; full suite 204/204 and 90-file package gate pass.
- **Last meaningful change:** T15.1 certification recovery and adversarial hardening, 2026-07-08.
- **Owning task or gate:** T15.1, G5–G7, and T16.

### `src/child-wrapper.ts`
- **Purpose:** Detached process-group leader that receives launch data only over IPC, starts targets with ignored stdin, forwards separate output streams, flushes lifecycle IPC in order, and independently watches parent identity.
- **Success check:** Wrapper and target share one dedicated PGID; `ready` is delivered before a fast target `exit`/disconnect; startup errors flush before disconnect; duplicate finish paths are suppressed; missed heartbeat or parent-identity mismatch triggers whole-group TERM then KILL cleanup.
- **Current assessment:** PASS
- **Evidence:** Uses monotonic heartbeat age and serializes bounded parent-identity probes; confirmed mismatch cleans immediately while transient unobservability with healthy heartbeats no longer causes false orphan cleanup. Rapid exit, parent-death, EPERM, and full suites pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2, T13.1, and T15.3.

### `src/cli.ts`
- **Purpose:** Executable command boundary for version/help, explicit foreground YOLO launch, browser setup, configuration management, and owner-credential rotation.
- **Success check:** Plain launch refuses access; exact `launch --yolo` requires macOS 14+/Node 22+ and direct `/dev/tty`, prints the warning/new owner password only locally, invokes the production foreground runtime, and cleans a factory-created lock on launch failure; existing setup/reset safety remains intact.
- **Current assessment:** PASS
- **Evidence:** Thirteen CLI tests pass, including injected exact YOLO routing and a genuinely terminal-less YOLO attempt that creates no `~/.loom`, plus package-bin/PTTY/setup/reset/live-lock coverage.
- **Last meaningful change:** T14 real foreground YOLO launch and support/TTY boundary, 2026-07-08.
- **Owning task or gate:** T0 / G1, T1, T4, T9, and T14.

### `src/cloudflare.ts`
- **Purpose:** Pinned Cloudflared acquisition/verification plus Quick and Named Tunnel validation, direct launch, bounded readiness, retry, audit, status, and cleanup.
- **Success check:** Retains T10/T12 guarantees; named mode validates private stable certificate/current credentials and exact name/account/hostname, launches explicit ephemeral origin argv, exposes production status only after registration, revalidates every attempt, retries only transient failures five times with capped backoff, never falls back to Quick, fails closed on audit/auth/config/cleanup uncertainty, and aborts startup waits on stop without recreation.
- **Current assessment:** PASS
- **Evidence:** Cloudflared target passes 30/30. Thirteen named tests prove static validation, exact argv/status, endpoint/password persistence, retry classification/limits, auth/config fail-fast, audit secrecy/order, timeout cleanup, per-attempt revalidation, cleanup failure, benign config notices, option-like rejection, and prompt startup cancellation. T10 real official binary/network evidence remains valid; G5 real named certification remains pending.
- **Last meaningful change:** T13 Named Tunnel manager and validation, 2026-07-08.
- **Owning task or gate:** T10 acquisition, T12 Quick Tunnel, and T13 Named Tunnel; consumed by T14.

### `src/config.ts`
- **Purpose:** Secure Loom state initialization, strict versioned configuration, private atomic next-launch replacement, invalid-config preservation, runtime-lock persistence, and PID-reuse identity comparison.
- **Success check:** Creates/repairs private state, validates without mutation, atomically writes strict 0600 config without symlink traversal, canonicalizes named values, preserves invalid bytes on reset, and requires exact runtime identity.
- **Current assessment:** PASS
- **Evidence:** Eight config tests pass, including T14 `writeConfig` canonical/private replacement and unknown-key rejection; the 45-test T14 target and 181-test full suite are green.
- **Last meaningful change:** T14 audited dashboard next-launch config writer, 2026-07-08.
- **Owning task or gate:** T1, T13, and T14.

### `src/limits.ts`
- **Purpose:** Single source of truth for all fixed Loom v1 byte, time, count, retry, and shutdown limits.
- **Success check:** Every exported value exactly matches plan Section 8 and boundary tests import the production constants.
- **Current assessment:** PASS
- **Evidence:** Adds the 9 MiB MCP request limit, ten-attempt/60-second authorization window, and two-second watchdog command timeout; exact 40-constant ledger test passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1, T13.1, and T15.3.

### `src/process-manager.ts`
- **Purpose:** Launches wrapper-owned detached process groups, streams bounded output, sends heartbeats, validates ownership, manages startup/exit races, timeout/cancellation, and TERM-to-KILL shutdown deadlines.
- **Success check:** Real processes have no PTY/stdin; wrapper exit before readiness rejects immediately; exit events between readiness and managed construction are preserved; natural exit/cancellation clean descendants; transient `EPERM` is revalidated; persistent `EPERM` fails closed; forced manager death is recovered; and no test descendants remain.
- **Current assessment:** PASS
- **Evidence:** Owned-group TERM/KILL and EPERM retry deadlines now use monotonic time; process-manager and ten-run transient-EPERM stress pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2, T12.1, T13.1, T14, and T15.3.

### `src/runtime.ts`
- **Purpose:** T11 readiness plus T14 exclusive foreground lifecycle, production component assembly, lock/state ownership, status, signals, dashboard actions, and reverse cleanup.
- **Success check:** Builds all seven handlers; acquires an identity-bound exclusive lock before audit; starts MCP NOT_READY/dashboard/catalogs/browser/tunnel in order; publishes exact `/mcp` once; supports verified browser or missing/corrupt-manifest degraded mode and pinned Quick/Named tunnel without fallback; opens the authenticated local dashboard by default; handles explicit/dashboard/signal stops; enforces a real 15-second per-step deadline; terminates public listeners/process groups; and removes exact readiness state plus lock only after content/identity ownership and cleanup certainty.
- **Current assessment:** PASS
- **Evidence:** Runtime shutdown uses monotonic deadline arithmetic and lock creation explicitly uses O_CREAT|O_EXCL|O_NOFOLLOW; integrated lifecycle and lock tests pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T11, T14, and T15.3.

### `src/mcp.ts`
- **Purpose:** Loopback-only Streamable HTTP MCP and OAuth HTTP server with deterministic readiness, endpoint-bound bearer authentication, server-bound authorization transactions, token routes, and bounded client-bound sessions.
- **Success check:** Authorization GET stores the request server-side; POST accepts only transaction ID and owner password; replay/substitution fail; strict CSP/frame/no-store headers apply; SDK metadata strings are normalized without `any`; sessions and readiness remain bounded.
- **Current assessment:** PASS
- **Evidence:** Bounds MCP JSON before SDK parsing, preserves SDK localhost Host validation, limits OAuth metadata bodies, returns structured 413/parse errors, rate-limits owner authorization monotonically, and tracks session idleness monotonically. MCP target passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T5 and T15.3.

### `src/oauth.ts`
- **Purpose:** Persistent single-owner credentials and endpoint-bound OAuth clients, authorization transactions/codes, access/refresh tokens, revocation, metadata, and endpoint-generation state.
- **Success check:** Exact endpoint/generation bindings remain atomic; `revokeAllOAuth` increments generation and clears clients/codes/tokens while preserving the canonical endpoint and owner credential; owner reset remains the only password rotation path.
- **Current assessment:** PASS
- **Evidence:** New owner hashes use scrypt N=32768/r8/p3 with explicit memory, successful legacy verification upgrades atomically, and refresh rotation preserves one absolute 30-day family expiration. OAuth/MCP suites pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T4, T5, T14, and T15.3.

### `src/output.ts`
- **Purpose:** Ordered bounded terminal-output storage with sanitization, binary suppression, head/tail retention, cursor pagination, gap detection, and terminal state.
- **Success check:** Preserves stdout/stderr append order, strips ANSI/unsafe controls, never splits UTF-8, reports exact truncation cursors, and records completed/cancelled/timed-out outcomes.
- **Current assessment:** PASS
- **Evidence:** `test/output.test.ts` passes 6/6; full suite passes 29/29.
- **Last meaningful change:** T2 output foundation, 2026-07-08.
- **Owning task or gate:** T2 / G2; reused by terminal and Cloudflared process management.

### `src/paths.ts`
- **Purpose:** Parse absolute or `~/` user paths, reject malformed input, and prevent writes through existing symbolic-link components.
- **Success check:** Rejects empty, relative, alternate-home, NUL, malformed-Unicode, symlink-parent, symlink-final, and non-directory-intermediate paths while allowing a missing tail under real directories.
- **Current assessment:** PASS
- **Evidence:** Canonicalizes only macOS /tmp and /var compatibility aliases to /private paths while retaining strict rejection of all other mutation symlinks; path and full suites pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1 and T15.3.

### `test/audit.test.ts`
- **Purpose:** Real-filesystem proof for durable starts, 0700/0600 permissions, queue saturation, deadline failure, disk failure, serialized rotation, retention, read availability, finish duration, and redaction.
- **Success check:** All failure paths are explicit, no JSONL line is corrupted, and secret/content literals are absent from persisted bytes.
- **Current assessment:** PASS
- **Evidence:** Eight targeted tests pass, including fixed-time rotation/retention and a one-millisecond durable-start deadline.
- **Last meaningful change:** T3 audit RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T3.

### `test/atomic-file.test.ts`
- **Purpose:** Real-filesystem proof for atomic replacement, permissions, expected-hash conflicts, same-path serialization, cleanup, size limits, and symlink rejection.
- **Success check:** Exactly one of two concurrent expected-hash writers succeeds and no `.tmp` residue remains after success or rejection.
- **Current assessment:** PASS
- **Evidence:** Targeted suite reports 5 passed, 0 failed.
- **Last meaningful change:** T1 atomic-file RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T1.

### `test/browser.test.ts`
- **Purpose:** Deterministic and real-local boundary tests for pinned setup, wrapper-owned launch, install rollback, browser locks, artifacts, audit policy, validation, dispatch, graceful shutdown, and per-tab recovery.
- **Success check:** Proves exact hashes and symlink rejection, CWD-independent official-CDN installer arguments, CDP readiness cleanup, stale-lock identity rules, no-overwrite downloads, audit secrecy/fail-closed behavior, all actions, bounded snapshot/evaluate recovery, natural shutdown, and cancellation fallback.
- **Current assessment:** PASS
- **Evidence:** Proves audit degradation blocks capability-increasing browser work but not tab close/read-only actions; full browser target remains green.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T9 and T15.3.

### `test/certification-cli.test.ts`
- **Purpose:** CLI-level blocked/fail semantics, strict evidence flow, help side-effect, and npm package-bin symlink regressions.
- **Success check:** Proves supplied self-reported evidence remains blocked and the installed-style symlink invokes the CLI.
- **Current assessment:** PASS
- **Evidence:** Five tests pass as part of the 19-test certification/documentation target.
- **Last meaningful change:** T15.1 certification CLI RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T15.1 and T16.
### `test/certification.test.ts`
- **Purpose:** Unit/integration tests for deterministic collection, external schema/pins, artifact/report path safety, package contents, residue detection, and fail-closed evaluation.
- **Success check:** Proves no self-certification, optional Quick evidence, exact managed pins, symlink rejection before mutation, complete public package requirements, and managed process detection.
- **Current assessment:** PASS
- **Evidence:** Fourteen tests pass; required RED cases reproduced each repaired defect; full suite passes 204/204.
- **Last meaningful change:** T15.1 certification recovery and adversarial RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T15.1, G5–G7, and T16.

### `test/cli.test.ts`
- **Purpose:** Real-process/PTY and injected-routing tests for package/bootstrap, setup/reset, plain-launch refusal, and explicit foreground YOLO launch.
- **Success check:** Proves exact `launch --yolo` routes once, a sessionless launch fails before state creation, plain launch remains refused, and all prior symlink/setup/config/auth reset protections remain.
- **Current assessment:** PASS
- **Evidence:** Target passes 14/14 and participates in the 49/49 T14 target and 185/185 full suite.
- **Last meaningful change:** T14 YOLO launch routing and local-terminal refusal, 2026-07-08.
- **Owning task or gate:** T0 / G1, T1, T4, T9, and T14.

### `test/cloudflare.test.ts`
- **Purpose:** Deterministic acquisition/verification plus Quick and Named Tunnel parser, trust, lifecycle, retry, audit, OAuth, status, and cleanup tests.
- **Success check:** Retains T10/T12 checks and proves named certificate/credential validation, exact direct argv, registration gating, hidden pre-ready status, bounded transient-only retries, no fallback, per-attempt revalidation, cleanup fail-closed behavior, prompt stop cancellation, audit secrecy/order, stable endpoint generation, and owner-password persistence.
- **Current assessment:** PASS
- **Evidence:** Adds a bounded 256 KiB hostile Quick Tunnel parser case while retaining all acquisition, Quick, Named, retry, OAuth, and cleanup coverage.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T10, T12, T13, and T15.3.

### `test/config.test.ts`
- **Purpose:** Real-filesystem tests for state permissions, strict config validation, non-mutating checks, invalid-config preservation, runtime-lock storage, full identity matching, and named-tunnel config canonicalization.
- **Success check:** Exercises private creation/repair, symlink rejection, schema failures, named stable-hostname/name boundaries, timestamped backup bytes, strict lock parsing, and every PID-reuse defense field.
- **Current assessment:** PASS
- **Evidence:** Targeted suite passes 8/8, adding strict private atomic `writeConfig`; combined T14 target passes 49/49 and full suite passes 185/185.
- **Last meaningful change:** T14 next-launch config replacement test, 2026-07-08.
- **Owning task or gate:** T1, T13, and T14.

### `test/limits.test.ts`
- **Purpose:** Locks every centralized Loom v1 limit to the approved specification.
- **Success check:** Exact value comparison passes without duplicating runtime logic.
- **Current assessment:** PASS
- **Evidence:** Locks all 40 current limits including request, authorization, and watchdog bounds.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1, T13.1, and T15.3.

### `public/dashboard.css`
- **Purpose:** Minimal responsive styling for the authenticated loopback dashboard without inline CSS.
- **Success check:** Loads only inside an authenticated dashboard session and remains compatible with the strict self-only CSP.
- **Current assessment:** PASS
- **Evidence:** Targeted dashboard HTTP tests pass 2/2; full tracked suite passes 99/99.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `public/dashboard.html`
- **Purpose:** Static dashboard shell containing only redacted status surfaces, allowlisted controls, and the injected per-session CSRF meta value.
- **Success check:** Contains no inline executable content or secrets; requires an authenticated session; uses text-only rendering through dashboard.js.
- **Current assessment:** PASS
- **Evidence:** Bootstrap/session/CSRF/redaction tests pass through real HTTP.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `public/dashboard.js`
- **Purpose:** Same-origin dashboard client for redacted status and the fixed action allowlist.
- **Success check:** Sends credentials and X-Loom-CSRF, renders with textContent, never evaluates returned HTML, and exposes no generic command/action endpoint.
- **Current assessment:** PASS
- **Evidence:** Targeted dashboard action tests pass and unknown actions return 404.
- **Last meaningful change:** T8 secure dashboard, 2026-07-08.
- **Owning task or gate:** T8.

### `src/dashboard.ts`
- **Purpose:** Loopback-only dashboard HTTP server with one-time bootstrap, bounded sessions, exact Host/Origin validation, CSRF, strict headers, recursive redaction, and allowlisted actions.
- **Success check:** Nonces are single-use/expiring; cookies are HttpOnly SameSite=Strict; all pages/APIs require a session; mutations require exact Origin and CSRF; hostile Host and unknown actions fail.
- **Current assessment:** PASS
- **Evidence:** Production nonce/session lifetimes now default to monotonic time; wall-clock-jump regression and all dashboard security tests pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T8 and T15.3.

### `src/tools/browser.ts`
- **Purpose:** Public `loom_browser` validation, audit policy, bounded result shaping, image return, typed error preservation, and dispatcher composition.
- **Success check:** Accepts only approved actions/schemes/origins/permissions/bounds, audits every browser mutation before backend work without secret content, keeps reads available after audit degradation, and never statically loads Playwright.
- **Current assessment:** PASS
- **Evidence:** Capability-increasing browser mutations remain audit-fail-closed while tab close is best-effort audited and remains available for containment during audit degradation.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T9 and T15.3.

### `src/tools/files.ts`
- **Purpose:** Concrete bounded text/image/binary read, audited atomic write, exact audited edit, and dispatcher composition for the three public file tools.
- **Success check:** Reads safely follow only a stable final symlink to a regular-file target, reject symlinked parents, detect image MIME by magic bytes, bound output, and hash the complete stable snapshot; writes/edits retain strict symlink rejection, audit-before-mutation, conflict detection, and atomic replacement.
- **Current assessment:** PASS
- **Evidence:** Stable read targets are opened O_NONBLOCK|O_NOFOLLOW before regular-file verification, preventing FIFO/device replacement from hanging the server; file suite passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T6 and T15.3.

### `src/tools/memory.ts`
- **Purpose:** Loom-owned stable-ID memory store with deterministic search, audited save/delete, crash-recovered tombstones, bounded rescans, and dispatcher composition.
- **Success check:** Save/delete are serialized and audited; stale valid tombstones are durably removed under audit; unsafe tombstones remain with diagnostics; malformed/oversized entries do not corrupt published snapshots; aggregate limits fail atomically.
- **Current assessment:** PASS
- **Evidence:** Tombstone cleanup repeats symlink/type and full identity verification immediately before removal and retains a diagnostic on replacement; memory suite passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T7 and T15.3.

### `src/tools/skills.ts`
- **Purpose:** Bounded deterministic multi-root SKILL.md discovery, metadata extraction, search/read, diagnostics, and dispatcher composition.
- **Success check:** Symlinks are skipped, limits preserve prior snapshots, unterminated frontmatter is skipped with `malformed_frontmatter_skipped`, and skipped malformed bytes do not count as indexed bytes.
- **Current assessment:** PASS
- **Evidence:** `test/skills.test.ts` passes 10/10; full tracked suite passes 97/97.
- **Last meaningful change:** T7 skills catalog and malformed-frontmatter handling, 2026-07-08.
- **Owning task or gate:** T7.

### `src/tools/terminal.ts`
- **Purpose:** Concrete unrestricted but noninteractive terminal service and dispatcher using the sole static `/bin/sh -lc` ProcessManager adapter.
- **Success check:** Validates centralized command/environment/cwd/timeout/job/poll bounds; canonicalizes safe cwd symlinks; audits start/cancel before mutation without sensitive bytes; returns stable job IDs and cursor lifecycle metadata with output only in MCP content; never evicts running jobs; awaits audit completion before finished-job eviction; and cancels every retained running process group on shutdown.
- **Current assessment:** PASS
- **Evidence:** Terminal start remains audit-fail-closed while cancel is best-effort audited and remains available for containment; terminal/process suites pass with zero residue.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T13.1, T14, and T15.3.

### `src/tools/register.ts`
- **Purpose:** Registers exactly seven public Loom MCP tools with strict Zod v4 action/path/size/URL schemas and an injected dispatcher.
- **Success check:** The public list contains only the seven approved tools; terminal schema bounds import centralized constants; every safe action dispatches; dangerous browser schemes, malformed paths, and oversized inputs fail before handlers.
- **Current assessment:** PASS
- **Evidence:** A real SDK client lists/calls all seven branches; T13.1 centralizes terminal command/environment/job/poll/wait/timeout bounds and its dispatcher delegates every non-terminal tool.
- **Last meaningful change:** T13.1 terminal schema centralization and concrete dispatcher, 2026-07-08.
- **Owning task or gate:** T5 registration and T13.1 terminal implementation; consumed by T14.

### `src/watchdog.ts`
- **Purpose:** macOS process-table observation using `ps` plus canonical executable resolution using `lsof`, observable identity matching, and PGID membership scans.
- **Success check:** Returns PID/PPID/PGID/start time/canonical executable, treats missing PIDs as absent, and rejects any PID/start/executable mismatch.
- **Current assessment:** PASS
- **Evidence:** All ps/lsof probes use fixed PATH/LANG/LC_ALL, bounded buffers, and a two-second SIGKILL timeout through one helper; live watchdog and timeout tests pass.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2, T12.1, and T15.3.

### `test/dashboard.test.ts`
- **Purpose:** Real HTTP tests for one-time bootstrap, cookies, strict headers, session/CSRF/Origin/Host boundaries, recursive redaction, and action allowlisting.
- **Success check:** Replayed nonces, missing sessions, wrong Origin/CSRF/Host, leaked secrets, and unknown actions are all rejected deterministically.
- **Current assessment:** PASS
- **Evidence:** Adds a wall-clock-jump regression proving production dashboard bootstrap lifetime is monotonic; dashboard target passes 3/3.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T8 and T15.3.

### `test/docs.test.ts`
- **Purpose:** Executable contract for real CLI commands, security/operating documentation, certification limitations, package metadata, and the repository-only external audit dossier.
- **Success check:** Rejects stale commands/placeholders, requires the human-review/no-proof boundary, verifies the exact public package allowlist/bins, and requires the dossier’s mandatory sections, exact seven tools, gate boundary, and representation of every mapped tracked path.
- **Current assessment:** PASS
- **Evidence:** Adds executable requirements for prompt injection, persistent browser state, TCC, LAN/provider disclosure, local-only containment, non-forensic audit, process escape, minimal environment, F_FULLFSYNC limits, and artifact trust.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T15, T15.1, T15.2, and T15.3.

### `test/files.test.ts`
- **Purpose:** Real-filesystem proof for stable/ranged reads, image magic bytes, explicit binary base64, stable final-symlink reads, parent/mutation symlink rejection, audited writes/edits, conflicts, concurrency, and dispatcher composition.
- **Success check:** Final-link reads return target content without weakening writes or edits; parent symlinks fail; content never enters audit records; one concurrent expected-hash writer wins; no temporary residue remains.
- **Current assessment:** PASS
- **Evidence:** Adds a real FIFO final-symlink regression with delayed writer and proves prompt regular-file rejection without blocking; file target passes.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T6 and T15.3.

### `test/memory.test.ts`
- **Purpose:** Real-filesystem tests for persistent stable IDs, ranking, audit fail-closed behavior, delete conflicts, concurrency, limits, symlink safety, tombstone recovery, diagnostics, and dispatcher composition.
- **Success check:** Valid stale tombstones are removed, unsafe tombstones remain diagnosed, aggregate limits are tested with individually valid files, and failed rescans preserve the prior immutable snapshot.
- **Current assessment:** PASS
- **Evidence:** Adds an adversarial tombstone replacement during audit admission and proves the replacement is preserved with a cleanup diagnostic.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T7 and T15.3.

### `test/runtime.test.ts`
- **Purpose:** T11 readiness plus T14 integrated real-local runtime, lock, signal, deadline, factory, degraded-browser, listener, process-group, and cleanup tests.
- **Success check:** Uses real audit, ProcessManager/terminal, MCP, dashboard, catalogs, dispatcher chain and runtime files; proves one readiness publication, public 401 transition, normal/startup-failure/signal/direct-stop cleanup, stop during tunnel startup without recreation, listener termination, deadline-preserved ownership, live/replaced lock refusal, exact current-state replacement refusal, default assembly/password persistence, browser degradation, and factory lock cleanup.
- **Current assessment:** PASS
- **Evidence:** Target passes 18/18; five consecutive runs pass 90/90 with no Loom-owned process or listener residue; combined T14 target passes 49/49 and full suite passes 185/185.
- **Last meaningful change:** T14 full runtime integration and stress cycle, 2026-07-08.
- **Owning task or gate:** T11 and T14.

### `test/skills.test.ts`
- **Purpose:** Tests deterministic discovery/ranking, stable IDs, duplicate names, symlink/depth/size/entry/total/time limits, missing roots, malformed frontmatter, and dispatcher composition.
- **Success check:** Unterminated frontmatter never becomes a skill and emits exactly one deterministic diagnostic while valid peers remain indexed.
- **Current assessment:** PASS
- **Evidence:** Ten targeted tests pass; full tracked suite passes 97/97.
- **Last meaningful change:** T7 malformed-frontmatter RED/GREEN cycle, 2026-07-08.
- **Owning task or gate:** T7.

### `test/mcp.test.ts`
- **Purpose:** End-to-end loopback HTTP and pinned-SDK tests for readiness, metadata, bearer challenges, server-bound OAuth authorization, revocation, seven tools, session ownership/capacity/expiry, endpoint lifecycle, and clean shutdown.
- **Success check:** The authorization page contains only a transaction ID, has CSP and frame denial, ignores attacker-supplied POST parameters, rejects replay, and all existing transport/session behaviors remain green.
- **Current assessment:** PASS
- **Evidence:** Adds structured pre-SDK 413 and monotonic owner-password throttling regressions while retaining full OAuth/session/seven-tool behavior.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T5 and T15.3.

### `test/oauth.test.ts`
- **Purpose:** State-level security tests for owner credentials, endpoint-bound OAuth, rotation/replay/expiry, reset, metadata, and owner-preserving revoke-all behavior.
- **Success check:** Existing tokens fail after revoke-all, endpoint/password remain unchanged, fresh registration succeeds, and all prior exact binding/secret-at-rest checks remain.
- **Current assessment:** PASS
- **Evidence:** Proves N=32768/r8/p3 creation, successful legacy-hash migration, and absolute refresh-family expiration in addition to all endpoint/token/reset behavior.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T4 and T15.3.

### `test/output.test.ts`
- **Purpose:** Boundary tests for terminal stream ordering, sanitization, deterministic binary markers, exact truncation, cursor pagination, UTF-8 boundaries, and lifecycle states.
- **Success check:** Stale cursors report gaps and pagination preserves source order without duplication or loss.
- **Current assessment:** PASS
- **Evidence:** Adds OSC 52 clipboard-control input and proves only safe text remains while retaining binary/truncation/cursor/lifecycle coverage.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2 and T15.3.

### `test/process-manager.test.ts`
- **Purpose:** Real-process proof for no PTY/stdin, dedicated groups, complete descendant cleanup, rapid natural-exit wrapper handshakes, hard-kill escalation, parent-death watchdog recovery, timeouts, and transient/persistent negative-PGID `EPERM` behavior.
- **Success check:** Every success test ends with an empty owned PGID; twenty rapid zero-work targets complete after the ready handshake; transient `EPERM` retries after ownership validation; persistent `EPERM` rejects at the deadline; and no wrapper/target/grandchild process remains.
- **Current assessment:** PASS
- **Evidence:** Ten process-manager tests pass, including twenty rapid natural exits and deterministic transient/persistent `EPERM`; the combined T13.1 target passes 19/19, full suite passes 167/167, and delayed residue scan is empty.
- **Last meaningful change:** T13.1 rapid natural-exit handshake regression, 2026-07-08.
- **Owning task or gate:** T2 / G2, T12.1, and T13.1.

### `test/paths.test.ts`
- **Purpose:** Real-filesystem tests for user-path parsing and symbolic-link rejection.
- **Success check:** Covers accepted absolute/home paths, hostile path strings, malformed surrogate pairs, missing tails, and real directory/file symlinks.
- **Current assessment:** PASS
- **Evidence:** Proves exact macOS /tmp and /var compatibility canonicalization without matching similarly prefixed paths, plus existing hostile path/symlink policy.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T1 and T15.3.

### `test/terminal.test.ts`
- **Purpose:** Real-process and policy tests for the terminal service, static shell adapter, audit boundary, polling, cancellation, timeout, retention, shutdown, validation, and dispatcher.
- **Success check:** Proves no PTY/stdin dependency; exact shell behavior; canonical symlink cwd and explicit environment; command/environment/cwd/output audit secrecy; poll availability during audit degradation; complete grandchild cleanup; completed-only eviction; all-running capacity rejection; and zero delayed residue.
- **Current assessment:** PASS
- **Evidence:** Proves start stays blocked while poll and cancel remain usable after audit storage failure, with all timeout/descendant/retention/shutdown coverage green.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T13.1 and T15.3.

### `test/watchdog.test.ts`
- **Purpose:** Live macOS tests for canonical executable identity, PID-reuse defenses, process-group scans, and absent PID handling.
- **Success check:** Identity changes in PID, start time, or executable all fail matching.
- **Current assessment:** PASS
- **Evidence:** Proves fixed C locale and hard timeout for watchdog subprocesses plus existing live identity/group behavior.
- **Last meaningful change:** T15.3 adversarial verification and hardening, 2026-07-08.
- **Owning task or gate:** T2 and T15.3.

### `tsconfig.json`
- **Purpose:** Strict NodeNext TypeScript compilation for source and tests.
- **Success check:** `npm run typecheck` and `npm run build` pass with Node types loaded explicitly.
- **Current assessment:** PASS
- **Evidence:** Added `types: ["node"]`; clean-install typecheck and build pass.
- **Last meaningful change:** T0 test-infrastructure correction, 2026-07-08.
- **Owning task or gate:** T0 / G1.
~~~~~

### Embedded source: `CHANGELOG.md`

- Bytes: `61748`
- Lines: `850`
- SHA-256: `bb4ab3fca62303ae929cdd985e9961835f513ce6fc3fef9cb80be03df6c3a4e2`

~~~~~markdown
# Changelog

All notable implementation and governance changes are recorded here with command evidence.

## 2026-07-07

### T0 — repository initialization (in progress)

- Initialized `/Users/aashu/loom` as a fresh Git repository on `planning/loom-v1-cavekit`.
- Created the required Cavekit governance artifacts and initial package metadata.
- Pinned runtime dependencies after querying the npm registry: MCP SDK 1.29.0, Express 5.2.1, Zod 4.4.3, Playwright Core 1.61.1.
- Local toolchain observed: Node v26.0.0, npm 11.12.1. The package contract remains Node 22+.
- No code, external tunnel, OAuth, ChatGPT integration, package publication, push, or deployment has been claimed or performed.

Validation and commit evidence will be added before T0 is marked complete.

### G0 — governance baseline prepared

- Restored the full canonical implementation plan at `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt` and incorporated the independent audit corrections.
- Made `loom launch --yolo` the sole unrestricted launch path; plain `loom launch` must not start listeners.
- Locked the production floor to macOS 14+ and preserved Node.js 22+.
- Added fail-closed MCP startup, exact `/mcp` endpoint-bound OAuth, refresh-token rotation, wrapper-owned Chromium, `cloudflared --no-autoupdate`, named-tunnel ephemeral origin routing, and precise watchdog/shutdown deadlines to the approved baseline.
- Generated `package-lock.json` with exact direct versions. `npm install` added 106 packages and reported zero vulnerabilities.
- Removed the incomplete `.transfer/part-0.b64` fragment and temporary `docs/plans/transfer-test.txt` file; neither belongs in the tracked repository.
- Created exhaustive `REPO_MAP.md` for the intended G0 tracked baseline. Production source remains intentionally absent until G0 is committed.

Evidence:

```text
npm ls --depth=0
@modelcontextprotocol/sdk@1.29.0
express@5.2.1
playwright-core@1.61.1
zod@4.4.3
typescript@6.0.3
@types/node@26.1.0
@types/express@5.0.6

wc -l ALGORITHM.md
17 ALGORITHM.md
```

## 2026-07-08

### G0 — governance baseline complete

- Committed the exact thirteen-file governance baseline at `868d20d2d2cf17bef2992abe6b95d9d4152cd223`.
- Staged-index paths and `REPO_MAP.md` paths matched with an empty `comm -3` result.
- `git diff --cached --check` returned no errors.
- Repository was clean immediately after the commit.

### T0 — minimum CLI/package bootstrap

- Added a real subprocess test before production code.
- Initial test compilation failed because Node types were not explicitly loaded; added `types: ["node"]` to `tsconfig.json` and reran.
- Required RED then failed because `dist/src/cli.js` did not exist: metadata test passed and three CLI behavior tests failed as expected.
- Added the minimum `src/cli.ts` implementation for `--version`, `--help`, and refusal of plain `loom launch` with the explicit `loom launch --yolo` instruction.
- Targeted GREEN: 4 tests passed, 0 failed.
- Full clean-install validation passed: `npm ci`, typecheck, full tests, and build; npm reported zero vulnerabilities.

Evidence:

```text
node --test dist/test/cli.test.js
pass 4
fail 0

npm ci
added 106 packages, audited 107 packages
found 0 vulnerabilities

npm run typecheck
PASS
npm test
PASS (4/4)
npm run build
PASS
```

### T1 — central limits and path-policy foundation

- Added the approved central limits as one dependency-free module.
- Added absolute/`~/` path resolution with rejection of empty input, bare relative paths, alternate-user home syntax, NUL bytes, and malformed UTF-16 surrogate sequences.
- Added real `lstat` component walking for mutating paths: existing symbolic-link parents and final symlinks are rejected, non-directory intermediate components fail, and a missing tail beneath real directories is allowed for later atomic creation.
- Required RED: TypeScript failed because `src/limits.ts` and `src/paths.ts` did not exist.
- First GREEN attempt exposed one production bug and two test-platform issues: an unmatched high surrogate was not rejected because `charCodeAt` returned `NaN`; ESM namespace objects have a null prototype; and macOS `/var` is itself a symlink to `/private/var`.
- Fixed the Unicode check and canonicalized test temporary roots with `realpath` without weakening the production symlink policy.
- Targeted GREEN: 5/5 tests passed.
- Full validation: typecheck, 9/9 tests, and build passed.

Evidence:

```text
node --test dist/test/limits.test.js dist/test/paths.test.js
pass 5
fail 0

npm run typecheck
PASS
npm test
PASS (9/9)
npm run build
PASS
```

### T1 — atomic-file primitive

- Added a same-directory atomic writer with per-canonical-path serialization.
- New files default to mode 0600; existing regular-file mode is preserved.
- Content is capped by `MAX_WRITE_BYTES`, temporary files use exclusive creation, file data and the parent directory are synced, and uncommitted temporary files are removed on failure.
- Existing symbolic-link components and non-regular targets are rejected through the shared path policy.
- Optional expected SHA-256 detects stale callers. Target identity is rechecked immediately before rename so external replacement or mutation fails closed.
- Required RED: build failed because `src/atomic-file.ts` did not exist.
- Targeted GREEN: 5/5 real-filesystem tests passed, including a concurrency proof where two writers share the same expected hash and exactly one succeeds.
- Full validation: typecheck, 14/14 tests, and build passed.

Evidence:

```text
node --test dist/test/atomic-file.test.js
pass 5
fail 0

npm run typecheck
PASS
npm test
PASS (14/14)
npm run build
PASS
```

### T1 — secure state, configuration, and runtime-lock identity

- Added strict versioned configuration for Quick Tunnel and named-tunnel modes, with absolute/`~/` path validation, duplicate-root rejection, unknown-key rejection, and named-tunnel completeness checks.
- Added exact Loom state initialization for `audit`, `browser-profile`, `cloudflared`, `downloads/screenshots`, `memory`, and `runtime`; directories are 0700 and state files are 0600.
- Existing current-user permissions are repaired. Symbolic-link state roots, wrong file kinds, and wrong ownership fail closed.
- `checkConfig` validates without writing or changing timestamps.
- `resetConfig` preserves invalid original bytes to a timestamped private backup, then writes valid defaults atomically.
- Added strict private `runtime/loom.lock` read/write with PID, process start time, canonical executable, launch ID, and state path; identity matching requires every field.
- Wired `loom config check` and `loom config reset`; reset has no noninteractive bypass and requires typing `RESET` through `/dev/tty`.
- Required RED: build failed because `src/config.ts` did not exist. A later RED showed runtime-lock exports were absent, then CLI routing remained the sole failing behavior.
- A real PTY test initially failed because macOS Expect does not accept `spawn --`; debug output proved Node never launched. Removing the unsupported Expect flag made the unchanged Loom confirmation test pass.
- Targeted validation: 13/13 CLI/config tests passed, including a real pseudo-terminal reset and invalid-config backup.
- Full validation: typecheck, 23/23 tests, and build passed.

Evidence:

```text
node --test dist/test/cli.test.js dist/test/config.test.js
pass 13
fail 0

npm run typecheck
PASS
npm test
PASS (23/23)
npm run build
PASS
```

### T2 — bounded terminal output

- Added one ordered stream model for separately piped stdout and stderr.
- ANSI escape sequences and unsafe controls are stripped; invalid UTF-8 or NUL-containing chunks become deterministic binary-suppression markers.
- Output retains an exact UTF-8-safe head and tail within the configured byte budget.
- Cursor reads report requested cursor, first available cursor, next cursor, and an explicit gap when truncation makes a poll stale.
- Pagination preserves source ordering and makes progress without splitting a UTF-8 code point.
- Added running, completed, cancelled, and timed-out state with exit code and signal tracking.
- Required RED: build failed because `src/output.ts` did not exist.
- Targeted GREEN: 6/6 boundary tests passed.
- Full validation: typecheck, 29/29 tests, and build passed.

Evidence:

```text
node --test dist/test/output.test.js
pass 6
fail 0

npm run typecheck
PASS
npm test
PASS (29/29)
npm run build
PASS
```

### T2 / G2 — wrapper-owned process groups and watchdog cleanup

- Added live macOS process observation using `ps` for PID/PPID/PGID/start time and `lsof` for the canonical executable path.
- Identity checks require PID, start time, and executable path; PID-only matches are rejected.
- Added a detached child wrapper that receives launch configuration over IPC, launches the target without a PTY or usable stdin, forwards stdout/stderr, receives heartbeats, and independently scans the parent process table.
- Added a process manager with dedicated wrapper-led process groups, bounded output integration, timeout/cancellation, ownership validation, and exact TERM-to-KILL deadlines.
- Natural target completion still terminates background descendants left in the owned group.
- Cancellation kills targets and grandchildren. SIGTERM-resistant targets are escalated to SIGKILL after the soft grace period.
- A separate helper process was SIGKILLed in testing; the independent wrapper detected the missing parent and removed wrapper, target, and grandchild in under half a second.
- Initial natural-exit testing took 30 seconds because the child handle was not unreferenced; the test was corrected to genuinely detach the descendant and then completed in about 170 ms while proving cleanup.
- Required RED: build failed because `src/process-manager.ts` was absent. Earlier watchdog RED failed because `src/watchdog.ts` was absent.
- Targeted process/watchdog validation: 10/10 passed.
- Full validation: typecheck, 39/39 tests, and build passed.
- Post-suite process evidence found no `child-wrapper`, `loom-process`, or test `sleep` descendants.

Evidence:

```text
node --test dist/test/process-manager.test.js dist/test/watchdog.test.js
pass 10
fail 0

npm run typecheck
PASS
npm test
PASS (39/39)
npm run build
PASS

ps -axo pid,ppid,pgid,command | grep -E 'dist/src/child-wrapper|loom-process-|/bin/sleep 30' | grep -v grep
<no output>
```

### T3 — durable private audit system

- Added private JSONL audit logging under the configured audit directory, with 0700 directory repair and 0600 file enforcement.
- Mutation-start records resolve only after the record and directory entry are synced. The fixed deadline defaults to two seconds.
- Added a bounded serial queue with no silent drops. Saturation, deadline expiry, or write failure marks audit degraded and rejects later mutation starts.
- Read audit remains explicitly non-throwing after degradation so read-only functionality can stay available.
- Added start/finish receipts with operation ID, timestamp, status, and measured duration.
- Added serialized size rotation and fixed-window startup retention without touching unrelated files.
- Added recursive bounded metadata sanitization. Commands, content, environment, authorization, cookies, tokens, output, typed values, screenshots, page text, token-shaped values, circular data, and excessive depth are not persisted.
- Required RED: build failed because `src/audit.ts` did not exist.
- Targeted GREEN: 8/8 tests passed, including queue saturation, a one-millisecond durable-start deadline, removed-directory write failure, concurrent rotation, retention, and forbidden-literal checks.
- Full validation: typecheck, 47/47 tests, and build passed.

Evidence:

```text
node --test dist/test/audit.test.js
pass 8
fail 0

npm run typecheck
PASS
npm test
PASS (47/47)
npm run build
PASS
```

### T4 — persistent endpoint-bound OAuth and owner reset

- Added one private atomic `auth.json` state file with strict schema validation and optimistic cross-process conflict detection.
- Owner credentials use a fresh random password, salt, and Node `crypto.scrypt`; reopening the installation never rotates or reprints the password.
- OAuth clients, authorization codes, access tokens, and refresh tokens are stored only by SHA-256 hashes. Plain owner/client/code/token secrets are absent from persisted bytes.
- Added exact HTTPS resource binding to the canonical public URL ending `/mcp`. A changed endpoint increments the generation and invalidates clients, codes, access tokens, refresh tokens, and pending transactions while preserving the owner password.
- Added dynamic client registration, exact registered redirect matching, fixed supported scopes, owner-password-gated authorization, mandatory S256 PKCE, five-minute single-use codes, fifteen-minute access tokens, and thirty-day refresh tokens.
- Refresh rotates both access and refresh tokens, prevents replay, cannot change resource/client or expand scopes, and persists atomically.
- Added access validation, expiry, revocation, protected-resource metadata, authorization-server metadata, and owner reset that revokes OAuth state while preserving endpoint/config/memory/browser state.
- Wired `loom auth reset` with live runtime-lock verification against PID/start-time/canonical-executable identity. It checks before and after confirmation and refuses while Loom is running.
- Reset confirmation and the new password use direct bounded `/dev/tty` descriptor I/O. There is no stdin/environment/flag bypass, and the password is not written to process stdout or stderr.
- Required RED: OAuth build failed because `src/oauth.ts` did not exist. CLI RED then failed only because `auth reset` was unknown.
- During PTY testing, the first reusable readline abstraction deadlocked after successful input because long-lived `fs` streams over `/dev/tty` did not close reliably. Expect traces and isolated reproductions identified the boundary; direct FileHandle reads/writes exited cleanly and replaced the stream abstraction.
- Non-terminal tests use Python `setsid()` so `/dev/tty` genuinely does not exist instead of inheriting the test runner's controlling terminal.
- Targeted validation: OAuth 8/8, CLI 8/8, combined T4 16/16.
- Full validation: typecheck, 57/57 tests, and build passed.

Evidence:

```text
node --test dist/test/oauth.test.js dist/test/cli.test.js
pass 16
fail 0

npm run typecheck
PASS
npm test
PASS (57/57)
npm run build
PASS
```

### T5 — authenticated Streamable HTTP MCP and seven-tool registry

- Added a loopback-only Express server using the pinned MCP SDK’s stateful Streamable HTTP transport and per-session `McpServer` instances.
- `/mcp` is deterministically unavailable before endpoint binding and returns a structured `NOT_READY` error without advertising incomplete OAuth metadata.
- After binding, the server publishes exact path-aware protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`, authorization-server metadata, and an RFC bearer challenge pointing to the public metadata URL rather than the loopback listener.
- Added HTTP dynamic client registration, owner-password authorization form/POST, S256 code exchange, refresh rotation, replay rejection, authenticated token revocation, and no-store responses over the T4 atomic OAuth state engine.
- Added exactly seven public tools: `loom_terminal`, `loom_read`, `loom_write`, `loom_edit`, `loom_skills`, `loom_memory`, and `loom_browser`.
- Tool input uses strict Zod v4 schemas with action-specific fields, absolute/`~/` paths, central size limits, and browser URL restrictions that reject `javascript:` and `file:` navigation.
- Sessions are validated by format and bound to the OAuth client that initialized them. Unknown, malformed, cross-client, over-capacity, and missing-session requests return structured errors.
- Concurrent initialization reservations are counted before transport creation, so simultaneous requests cannot race past the session cap.
- Active request counts prevent the inactivity reaper from closing long-running calls. Inactive sessions are closed within the configured bound, and all sessions close on server shutdown or endpoint generation change.
- Rebinding the same public URL preserves sessions. Changing the public `/mcp` URL closes every session, updates metadata/challenges, and rejects all old tokens immediately.
- A real pinned-SDK client listed exactly seven tools and called every schema through the transport.
- The first endpoint-change test exposed a pinned SDK bearer-middleware bug: stale-token validation produced a 500 because its catch path dereferenced an undefined error. Loom replaced only that brittle boundary with a defensive equivalent middleware that preserves the SDK challenge format and `req.auth` shape; stale/revoked tokens now return 401.
- Required RED: build failed because `src/mcp.ts` and `src/tools/register.ts` did not exist. The initial compile also exposed the pinned SDK’s TypeScript 6 exact-optional transport mismatch, handled with a narrow `Transport` cast.
- Targeted validation: 9/9 MCP tests passed.
- Full validation: typecheck, 66/66 tests, and build passed.
- Post-suite process scan found no MCP test listener/process residue.

Evidence:

```text
node --test dist/test/mcp.test.js
pass 9
fail 0

npm run typecheck
PASS
npm test
PASS (66/66)
npm run build
PASS

ps -axo pid,ppid,pgid,command | grep -E 'dist/test/mcp.test.js|loom-mcp-|dist/src/mcp.js' | grep -v grep
<no output>
```

### T5 recovery — adversarial-review hardening

- Reproduced the committed T5 TypeScript failure caused by the MCP SDK metadata helper returning a string where the local bearer-challenge boundary required a `URL`; normalized it explicitly with `new URL(...)` without casts or SDK modification.
- Replaced authorization POST parameter replay with a persistent, short-lived, single-use server-side transaction bound to client, redirect URI, scope, resource, endpoint generation, PKCE challenge, and OAuth state.
- The authorization page now posts only `transaction_id` and `owner_password`; attacker-supplied client, redirect, and resource fields are ignored because they are not read. Successful consumption is atomic and replay returns `invalid_request`.
- Added `X-Frame-Options: DENY` alongside strict CSP `frame-ancestors 'none'`, no-store, no-sniff, and no-referrer headers.
- Amended the canonical plan and SPEC only for findings verified against the actual repository: direct argument-vector spawning for Loom-owned binaries, a static terminal adapter, safe symlink canonicalization, memory tombstone recovery, malformed skill frontmatter, browser module separation/evaluation recovery/screenshot persistence, and integrated runtime-lock testing.
- Hardened the execution contract: task regrouping requires an explicit plan amendment and no task commit may occur without green typecheck, full tests, build, map, and governance checks.
- Found that stale compiled tests remained in `dist/` after later untracked sources were quarantined. Added an explicit clean step before every build so abandoned output can never create false failures or false greens.
- Required RED: the authorization page lacked `X-Frame-Options` and still mirrored OAuth parameters into hidden fields.
- Targeted GREEN: MCP and OAuth suites passed 15/15.
- Full clean-output validation: typecheck passed, tracked tests passed 64/64, and build passed.

Evidence:

```text
npm run typecheck
PASS
node --test dist/test/mcp.test.js dist/test/oauth.test.js
PASS (15/15)
npm test
PASS (64/64 after clean build)
npm run build
PASS
```

### T6 — bounded file tools and approved final-symlink reads

- Restored only the quarantined T6 implementation and tests after the clean T5 recovery commit.
- Added stable text, image, and explicit binary reads; private audited atomic writes; exact audited edits; byte limits; expected-SHA conflicts; concurrency serialization; and composable dispatcher behavior.
- Corrected the salvaged implementation’s plan violation: `loom_read` now permits a final symbolic link only after rejecting symlinked parents, resolving the canonical target, opening it with `O_NOFOLLOW`, verifying a regular file, and rechecking both the original pathname identity and canonical target identity after reading.
- Writes and edits still reject final and parent symbolic links through the atomic mutation path.
- Required RED: the file suite failed because the prior implementation rejected the final symbolic link.
- Targeted GREEN: 11/11 file tests passed.
- Full validation: typecheck passed, tracked tests passed 75/75, and build passed.

Evidence:

```text
node --test dist/test/files.test.js
PASS (11/11)
npm run typecheck
PASS
npm test
PASS (75/75)
npm run build
PASS
```

### T7 — skills and memory catalogs

- Restored only the quarantined T7 skills/memory implementation and tests after T6 committed cleanly.
- Added deterministic multi-root skill discovery, stable IDs, ranking, limits, symlink diagnostics, and atomic catalog publication.
- Unterminated SKILL.md frontmatter is now skipped with `malformed_frontmatter_skipped`; it cannot be partially interpreted as metadata/body and does not count toward indexed bytes.
- Added Loom-owned stable-ID memory save/read/search/delete, audit fail-closed behavior, conflict detection, concurrency serialization, and bounded rescans.
- Valid current-user 0600 regular-file delete tombstones are durably removed under an audit start during rescan. Unsafe tombstones remain with `unsafe_tombstone_skipped`; cleanup failures remain visible.
- Repaired the aggregate-byte test so both files are individually valid and only their sum violates the cap.
- Required RED: malformed frontmatter was indexed, recoverable tombstones remained, and the aggregate test accidentally exercised oversized-file skipping.
- Targeted GREEN: skills and memory passed 22/22.
- Full validation: typecheck passed, tracked tests passed 97/97, and build passed.

### T8 — secure loopback dashboard

- Added a loopback-only dashboard server and static client with no permissive CORS or generic action endpoint.
- A 256-bit five-second bootstrap nonce is single-use and exchanged for a bounded HttpOnly SameSite=Strict session cookie.
- Every page and API requires the session; mutations additionally require exact Origin and a per-session `X-Loom-CSRF` value.
- Exact Host validation, strict self-only CSP, frame denial, no-store, no-sniff, no-referrer, and restrictive Permissions-Policy are applied.
- Status values are recursively redacted before serialization. Static JavaScript renders with `textContent` and exposes only rescan, browser restart, audit reveal, next-launch config, OAuth revoke, and stop actions.
- Required RED: `src/dashboard.ts` did not exist. A later test correction replaced fetch’s normalized Host header with a raw HTTP request.
- Targeted GREEN: dashboard passed 2/2.
- Full validation: typecheck passed, tracked tests passed 99/99, and build passed.

### T9 — managed persistent browser subsystem

- Added the browser contract/error module, separated public browser policy and MCP result shaping from the Playwright/CDP backend, and retained guarded dynamic Playwright loading so a browser failure cannot statically disable other tools.
- Added explicit `loom setup browser`. It initializes private `~/.loom/browser/` state, resolves the installed Playwright Core CLI independently of the caller’s working directory, installs Chromium without the unused headless shell, forces the official Playwright CDN, verifies the exact architecture-specific executable SHA-256, performs a real wrapper-owned loopback CDP launch, and atomically promotes or rolls back the installation.
- Added the dedicated persistent profile backend with direct executable/argument ProcessManager launch, loopback ephemeral CDP, twelve-tab enforcement, stable per-page IDs, bounded navigation/actions/snapshots/evaluation/screenshots, explicit permissions/geolocation, and no attachment to normal Chrome.
- Added private `runtime/browser.lock` identity using wrapper PID, start time, executable, launch ID, and canonical profile. Recovery rejects live or identity-uncertain owners, distinguishes actual Chrome executables from unrelated commands mentioning the profile, and removes stale Chromium singleton artifacts only after process-table verification.
- Added audited no-overwrite download persistence and audited collision-safe screenshots under `~/.loom/downloads/`; page text, expressions, typed values, screenshot bytes, selectors, and URL query values remain absent from audit bytes.
- Added one deadline/recovery boundary for both public evaluation and internal snapshot evaluation. A timed-out tab is closed without `beforeunload`, surviving CDP health is checked, and whole-browser restart occurs only when tab cleanup or CDP health fails.
- Replaced the original `--dump-dom about:blank` setup probe after the real pinned Chrome build hung with no DOM output. The replacement waits for safe `DevToolsActivePort` metadata and validates a loopback `/json/version` response while the browser remains wrapper-owned.
- Fixed persistent-profile loss: Playwright `connectOverCDP()` close only disconnected and Loom immediately killed Chrome before storage flush. Shutdown now sends CDP `Browser.close`, waits for natural managed-process exit within the soft grace, and cancels the group only as fallback.
- Fixed package-bin execution through symlinks and proved `loom setup browser` does not depend on the caller’s current directory.
- Required RED evidence included strict TypeScript failures, final-symlink executable acceptance, install rollback loss, stale-lock false positives, missing CDP launch verifier, `--dump-dom` real hang, profile storage returning `null` after restart, unbounded snapshot evaluation, package-bin no-op, CWD-relative CLI resolution, and download-host override drift.
- Deterministic final validation: typecheck passed, browser/CLI/config targets passed, full tracked suite passed 120/120, and build passed.
- Real macOS arm64 evidence: official Chromium archive SHA-256 `311211b54c429245e2cec0314ee1e314085e9c00350215b95e1a879350786630`; installed executable SHA-256 `b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7`; Chrome 149.0.7827.55 revision 1228 launched through ProcessManager, produced a private manifest and no setup/process residue, and restored localStorage value `"v"` across two controlled backend restarts with no remaining Chrome process or browser lock.

Evidence:

```text
npm run typecheck
PASS
npm test
PASS (120/120)
npm run build
PASS

real setup manifest
playwrightVersion: 1.61.1
chromiumRevision: 1228
chromiumVersion: 149.0.7827.55
architecture: arm64
executableSha256: b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7
browser directory: 0700
manifest: 0600
staging residue: none
process residue: none

controlled profile restart
first launch: set "v"
second launch: restored "v"
post-shutdown process/browser-lock residue: none
```

### T10 — pinned Cloudflared acquisition and validation

- Added exact Cloudflared `2026.7.0` release descriptors for macOS arm64 and x64, including official GitHub HTTPS URLs, archive byte counts, archive SHA-256 values, and extracted executable SHA-256 values.
- Added stable executable inspection using canonical resolution, current-user ownership, regular-file and executable-mode checks, `O_NOFOLLOW`, before/after file identity, full SHA-256, and exact wrapper-owned `cloudflared --version` parsing.
- PATH discovery accepts a normal symlink only after canonical verification and reports requested path, canonical path, hash, bytes, and version. The first PATH match fails closed on unknown bytes/version rather than silently searching later entries.
- Added credential-free HTTPS acquisition with manual redirects capped at five, a bounded 30-minute total transfer deadline, optional Content-Length validation, exact streamed byte/hash enforcement, private exclusive staging, and cleanup of partial downloads.
- Added the default macOS `/usr/bin/tar` boundary with an exact single-file `cloudflared` archive layout, private chmod, executable hash/version verification, stable inode promotion, directory fsync, and preservation of any existing binary on pre-promotion failure.
- Added direct ProcessManager launch that re-verifies the binary and injects `tunnel --no-autoupdate --metrics 127.0.0.1:0` as an explicit argv vector. Caller attempts to override `tunnel`, autoupdate, or metrics flags fail before launch; shell command construction and terminal-tool routing are absent.
- Added pre-mutation parent-symlink rejection so installation cannot create state through a symlinked ancestor.
- Required RED evidence covered the absent production module, absent verification/PATH/installer/launch APIs, pre-rejection symlink side effects, and an empirically insufficient 60-second then 10-minute official download deadline. The real official transfer required about fourteen minutes on this connection, so the production deadline is bounded at 30 minutes.
- Targeted validation passes 9/9; full typecheck, 129/129 tests, and build pass.
- Real evidence: official arm64 archive `276f4ae3119c88d1708b0f884a35a1c87d9ae459b0dab6313f2daddbddab2bec` and executable `cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04`; official x64 archive `dd1fb6a914a21dc52c64bad96987bbbc72d6c65553a2cfee1dd5bc886742ddfb` and executable `c0c65579c6f11b1381cf5ffd1614f5094bf140e18938eae4ad16931da9f69499`. Both binaries reported version `2026.7.0` through ProcessManager.
- A real official HTTPS arm64 install used the production downloader and default extractor, produced a private 0700 `cloudflared` executable of 38,388,400 bytes with the pinned hash/version, removed its staging directory, and left no installer or Cloudflared process residue.

Evidence:

```text
node --test dist/test/cloudflare.test.js
PASS (9/9)

npm run typecheck
PASS
npm test
PASS (129/129)
npm run build
PASS

real official HTTPS install
version: 2026.7.0
sha256: cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04
bytes: 38388400
mode: 0700
staging residue: none
process residue: none
```

### T11 — tunnel-independent runtime readiness

- Explicitly amended path ownership before coding: T11 introduces only the readiness subset of `src/runtime.ts` and `test/runtime.test.ts`; T14 retains full startup/shutdown orchestration in the same files.
- Added strict local endpoint validation requiring a bare HTTP loopback origin with explicit port and an exact `<origin>/mcp` URL.
- Added strict public endpoint canonicalization requiring a bare HTTPS origin with no credentials, explicit port, path, query, or fragment, deriving exactly `<origin>/mcp` as the OAuth protected resource.
- Added `RuntimeReadiness` that persists an immutable NOT_READY snapshot, delegates exact endpoint binding to the existing MCP server, and publishes immutable ready/status state only after successful validation, binding, and private atomic state replacement.
- Added strict secret-free `runtime/current.json` schema with local/public MCP URLs, resource, tunnel mode, connector readiness, production eligibility, and timestamp. Writes require a current-user 0700 runtime directory, reject a symlinked `current.json` before binding, and produce a 0600 atomic file.
- Added status-block formatting with full local/public MCP URLs, tunnel/connector/production fields, and the exact full-computer-access warning. T11 does not print, redraw, start, or stop any runtime component.
- Added real local integration using `LoomMcpHttpServer`: before readiness binding, `/mcp` returns structured 503 NOT_READY with no challenge; after canonical binding, it returns the endpoint-bound 401 OAuth challenge and exact protected-resource metadata.
- Required RED evidence included the absent runtime module, unsafe runtime-directory validation after binding, and current.json symlink rejection after binding. Both state-target cases now fail before the MCP endpoint changes and preserve prior state.
- Targeted validation passes 6/6; full typecheck, 135/135 tests, and build pass.

Evidence:

```text
node --test dist/test/runtime.test.js
PASS (6/6)

npm run typecheck
PASS
npm test
PASS (135/135)
npm run build
PASS

real local MCP readiness transition
before binding: HTTP 503, NOT_READY, no WWW-Authenticate
after binding: HTTP 401, exact endpoint-bound resource metadata challenge
runtime/current.json: 0600
```

### T12 — Quick Tunnel

- Added fail-closed Quick Tunnel configuration checks. Quick mode returns without side effects when the config directory is absent, but refuses an unsafe config path or any existing `config.yaml`/`config.yml` before audit or process launch.
- Added strict Quick origin parsing for a single valid DNS label under `trycloudflare.com`, bounded by whitespace or end-of-buffer. Paths, ports, multi-label prefixes, invalid label edges, and concatenated prefixes are rejected.
- Added `QuickTunnelManager` around the verified T10 direct ProcessManager boundary. It passes only `--url <bare-loopback-origin>`; T10 injects `tunnel --no-autoupdate --metrics 127.0.0.1:0` and re-verifies the binary.
- Added bounded 256 KiB output accumulation, cursor consistency checks, split-chunk/end-boundary URL handling, and readiness requiring both a strict public origin and a registered tunnel connection.
- Enforced the central 15-second readiness deadline separately for each attempt. A process-start failure, early transient exit, or timeout permits exactly one fully cleaned recreation. A malformed/unsafe candidate URL fails immediately without recreation.
- Added idempotent status/start/stop state with exact public `<origin>/mcp`, `production: false`, recreation count, and process cancellation on failure/stop.
- Added audit fail-closed behavior and start/finish-only records. Tests prove Cloudflared output, registration text, and trycloudflare URL bytes never enter the audit log.
- Added integration through `RuntimeReadiness` and `AuthStore`: two changed Quick URLs increment endpoint generation and invalidate endpoint-bound OAuth state while the installation owner password remains valid across reopen. Quick runtime status remains ineligible for production.
- Required RED evidence covered missing parser/config/manager APIs, transient process-start recreation bypass, and unsafe endpoint behaviors. An additional end-of-buffer chunk-boundary review case was already handled correctly by the strict parser and required no production change.
- Cloudflared targeted validation passes 17/17; full typecheck, 143/143 tests, and build pass.
- One first full-suite run observed a nonreproducing `kill EPERM` in the pre-existing ProcessManager SIGKILL-escalation test. The isolated test passed immediately, no owned process residue existed, and the complete suite then passed 143/143. No unrelated process-manager code was changed.
- No real Quick Tunnel smoke claim is made. The plan explicitly marks it optional and non-certifying; production certification still requires a real named tunnel.

Evidence:

```text
node --test dist/test/cloudflare.test.js
PASS (17/17)

npm run typecheck
PASS
npm test
PASS (143/143)
npm run build
PASS

Quick endpoint lifecycle
first URL generation: 1
second URL generation: 2
owner password after both changes/reopen: valid
production eligible: false
```

### T12.1 — transient process-group signal hardening

- Promoted the previously intermittent negative-PGID `SIGKILL` `EPERM` into a release-blocking subtask before T13 and amended the canonical plan and specification accordingly.
- Added deterministic real-process regressions for one transient `EPERM` and persistent `EPERM` while a managed target ignores `SIGTERM`.
- Required RED reproduced the raw `kill EPERM` escape from the former single-attempt signal helper. The persistent case also proved the error was not wrapped at the owned-group boundary.
- Replaced direct signaling with one minimal owned-group helper. `ESRCH` remains already-gone; any `EPERM` revalidates the recorded wrapper PID/start-time/executable identity and current group membership before retry; retries use only the existing absolute shutdown deadline; persistent failure rejects without widening the signal target.
- Preserved cancellation state and complete descendant cleanup. Test-only forced cleanup prevents intentional fail-closed cases from leaking processes.
- Preserved a concurrent-agent refinement that replaces process-global `process.kill` monkeypatching with one optional group-signal function on `ProcessManager`; simplified its draft one-purpose system-call interface to the single function required by the tests.
- A concurrent agent supplied the initial retry implementation during review. Its extra fixed three-retry policy was removed because the existing absolute deadline is the approved and sufficient bound.
- Targeted EPERM validation passes 2/2; process-manager/watchdog validation passes 12/12; full typecheck, 145/145 tests, and build pass. A delayed external process-table scan is empty.

Evidence:

```text
node --test --test-name-pattern='EPERM' dist/test/process-manager.test.js
PASS (2/2)

node --test dist/test/process-manager.test.js dist/test/watchdog.test.js
PASS (12/12)

npm run typecheck
PASS
npm test
PASS (145/145)
npm run build
PASS

ten consecutive ProcessManager runs
PASS (90/90 test executions)

post-suite process scan
<no output>
```

### T13 — Named Tunnel

- Added strict named-tunnel configuration canonicalization: lowercase stable DNS hostnames, no `trycloudflare.com`, no surrounding whitespace/control characters, no option-like names, and a 128-character name ceiling.
- Added stable private authentication-file reads for the origin certificate and credentials JSON. Both paths reject symbolic-link components, nonregular/wrong-owner files, group/other access, executable or special mode bits, invalid size, and identity changes before/during read.
- Added strict origin-certificate PEM/token validation and current credential schema validation for exactly `AccountTag`, `TunnelSecret`, `TunnelID`, and `TunnelName`. Credentials must match the certificate account and configured tunnel name; the secret must be canonical 32-byte base64 and the ID must be a UUID.
- Added `NamedTunnelManager` on the verified direct Cloudflared boundary. It launches only explicit `--origincert`, `run --url <bare-loopback-origin>`, `--credentials-file`, and tunnel-name arguments after the fixed T10 `tunnel --no-autoupdate --metrics 127.0.0.1:0` prefix.
- Named status exposes no public endpoint and no production eligibility before a registered tunnel connection is observed within 15 seconds. A benign missing-persistent-config notice is accepted; Loom does not use persistent ingress as its origin mapping.
- Static validation and audit-start failures block process launch. Authentication/configuration output fails immediately. Only transient spawn/edge/readiness failures retry, at most five times, with one-second exponential backoff bounded by 60 seconds.
- Revalidates the certificate and credentials before every attempt, fully cancels each failed process before retry, and fails closed if cleanup is uncertain. No Quick Tunnel fallback exists.
- Added lifecycle-version plus `AbortController` cancellation so `stop()` interrupts pending readiness/backoff waits, cancels the active attempt exactly once, prevents recreation, and remains idempotent. An uncleaned process blocks restart.
- Audit records include only mode/retry metadata. Tests prove the tunnel name, hostname, endpoint, authentication paths/values, certificate fields, and Cloudflared output do not persist in audit bytes.
- Added runtime/OAuth integration evidence: restarting the same canonical hostname preserves endpoint generation; changing the hostname increments generation and invalidates endpoint-bound state; the owner password remains valid across both and across store reopen.
- Preserved and reviewed concurrent-agent adversarial additions for per-retry auth revalidation, cleanup-failure fail-closed behavior, benign config notices, option-like name rejection, hidden pre-ready status, and prompt stop-during-startup cancellation. Duplicate cancellation mechanisms were removed in favor of one `AbortController` path.
- Required RED evidence covered missing named APIs/constants, permissive config names/hostnames, pre-ready production exposure, retry auth mutation, cleanup uncertainty, stop-triggered recreation, and startup sleeps that did not wake promptly.
- T13 target passes 38/38. Full typecheck, 158/158 tests, clean build, and delayed Loom-owned process-residue scan pass. A pre-existing Homebrew Cloudflared process belongs to `node /opt/homebrew/bin/devspace launch devspace`, predates T13, and is explicitly excluded rather than touched. This is deterministic implementation evidence only; real named-tunnel and ChatGPT certification remain G5/G6 work.

Evidence:

```text
node --test dist/test/cloudflare.test.js dist/test/config.test.js dist/test/limits.test.js
PASS (38/38)

npm run typecheck
PASS
npm test
PASS (158/158)
npm run build
PASS

Loom-owned post-suite process scan
<no output>

unrelated pre-existing infrastructure (not touched)
cloudflared tunnel run devspace
parent: node /opt/homebrew/bin/devspace launch devspace

Named endpoint lifecycle
same canonical hostname generation: 1 -> 1
changed hostname generation: 1 -> 2
owner password after restarts/change/reopen: valid
production eligible before readiness/after stop: false
production eligible while registered: true
```

### T13.1 — terminal tool implementation recovery

- Added the missing concrete `loom_terminal` handler required by the seven-tool contract and blocked T14 until it existed.
- Added twelve centralized terminal limits for command size, environment entries/key/value/aggregate bytes, timeout, poll/default-poll bytes, wait, retained jobs, job-ID bytes, and poll interval; the exact limit ledger now covers 36 values.
- Added one static typed process boundary only: `ProcessManager.start({ executable: '/bin/sh', args: ['-lc', command], cwd, env, timeoutMs })`. No reflection, `Function.toString()`, alternate method guessing, PTY, stdin, or shell routing for Loom-owned binaries exists.
- Added absolute-or-home cwd validation with `realpath`, safe symlink traversal, and directory enforcement. Environment keys use the portable identifier grammar; values and aggregate bytes are bounded and NUL-free.
- Added stable `job_<uuid>` identifiers, bounded cursor/gap polling, at most 60 seconds of wait, lifecycle statuses (`running`, `exited`, `cancelled`, `timed-out`), timeout propagation, and PGID metadata.
- Kept command output exclusively in MCP content. Structured data contains lifecycle/cursor/byte/PGID metadata only; audit records never contain command, cwd, environment names/values, or output.
- Terminal start and cancel require a durable audit-start record before launch/signaling. Audit degradation blocks those mutations while polling an existing job remains available.
- Added idempotent cancellation and service shutdown that terminate complete wrapper-owned groups, including grandchildren. No PTY or usable stdin is exposed.
- Added bounded retention of 128 jobs. Capacity rejects only when every retained job is running; finished jobs are awaited through process and audit completion before the oldest finished record is evicted. Running jobs are never evicted.
- Added `createTerminalToolDispatcher` using the existing fallback-chain convention and centralized the public terminal Zod bounds in `src/tools/register.ts`.
- The repeated short-command workload exposed a real wrapper race: `ready` and `exit` were asynchronous IPC sends followed by immediate disconnect, so a fast target could lose readiness and leave the parent waiting for the full startup timeout. The wrapper now flushes `ready` before `exit`, flushes startup errors before disconnect, and guards against duplicate finish paths. ProcessManager now rejects wrapper exit during startup immediately, records exits that occur between readiness and managed-object construction, and settles the startup timeout exactly once.
- Required RED first failed on the missing terminal module/exports. Later stress runs reproduced five-second wrapper startup timeouts and test-owned residue. Concurrent adversarial tests were preserved for typed job/capacity failures, audit-degraded polling, completion-order retention, strict UUID job IDs, aggregate environment limits, and complete group cleanup.
- Terminal/limits target passes 9/9. The combined ProcessManager/terminal/limits target passes 19/19, including twenty rapid natural exits without losing the wrapper ready handshake. The real terminal suite passes five consecutive runs (40/40 executions) with zero wrapper/target/grandchild residue. Full typecheck, 167/167 tests, and build pass; delayed Loom-owned residue scan is empty.

Evidence:

```text
node --test dist/test/terminal.test.js dist/test/limits.test.js
PASS (9/9)

node --test dist/test/process-manager.test.js dist/test/terminal.test.js dist/test/limits.test.js
PASS (19/19)
rapid natural exits: 20/20

five consecutive terminal-suite runs
PASS (40/40 test executions)
residue after every run: none

npm run typecheck
PASS
npm test
PASS (167/167)
npm run build
PASS

Loom-owned delayed process scan
<no output>
```

### T14 — full runtime orchestration and signal cleanup

- Expanded `src/runtime.ts` from readiness-only state into an exclusive foreground lifecycle with identity-bound `runtime/loom.lock`, strict private `runtime/current.json`, startup state, one readiness publication, foreground waiting, idempotent stop, and fail-closed ownership removal.
- Added the exact local startup sequence: initialize/validate state and config, acquire lock, create audit and ProcessManager, compose all seven concrete tool handlers, start MCP NOT_READY, dashboard, skill and memory catalogs, verified managed browser or explicit unavailable mode, selected verified Cloudflare tunnel, canonical public `/mcp` binding, private ready state, one secret-free status block, optional local dashboard open, then foreground wait.
- Added the production runtime factory. It uses the pinned browser manifest and managed persistent profile when valid; a missing manifest degrades browser tools only. A present invalid manifest remains fatal before public readiness. It resolves or installs only the pinned architecture-specific Cloudflared release and constructs exactly the configured Quick or Named manager with no fallback.
- Added strict concrete dashboard actions: catalog rescan, audited browser restart, audited local audit-folder reveal through direct `/usr/bin/open`, audited strict atomic next-launch config replacement, audited owner-preserving OAuth revoke-all, and runtime stop.
- Added `writeConfig` for strict 0600 atomic config replacement and `AuthStore.revokeAllOAuth` for endpoint/password-preserving OAuth invalidation.
- Added the exact shutdown sequence: mark stopping, reject new terminal jobs, cancel terminal groups, close browser, stop tunnel, close MCP then dashboard, drain ProcessManager, close audit, and remove state/lock only after cleanup certainty. Every step races the real absolute shutdown deadline; timeout/error preserves ownership files fail-closed.
- Hardened runtime-state deletion separately from lock deletion: shutdown opens `runtime/current.json` without following symlinks, verifies current-user 0600 mode, stable file identity, and byte-for-byte equality with the last immutable readiness snapshot before removing it. Replaced or missing owned state rejects cleanup and preserves the lock for manual recovery.
- Added stop-during-startup lifecycle versioning so SIGINT/SIGTERM/direct stop during tunnel readiness prevents public binding, status output, process recreation, or stale state. Repeated stop remains idempotent.
- Added runtime lock acquisition/release with exclusive create, live exact-identity refusal, stale-lock replacement, current-process revalidation, and refusal to remove a replaced lock.
- Added foreground status with browser, catalogs, tunnel, connector, audit, complete local/public MCP and dashboard URLs, production eligibility, and the full-access warning. Owner password and secrets never enter status.
- Wired the real `loom launch --yolo` command. It enforces macOS 14+/Node 22+, requires direct `/dev/tty`, prints the bright full-access warning and newly generated owner password only there, invokes the production factory and signal runner, and cleans a partially created runtime on launch failure. Plain launch remains refused.
- Hardened the launch boundary with an explicit minimal factory-result type and a dual input/output terminal-handle test fixture, avoiding unsafe inference while preserving the exact local-terminal behavior.
- Default production launch now opens the single-use authenticated dashboard bootstrap URL through direct `/usr/bin/open`; tests explicitly capture or suppress that local side effect. Missing and corrupt browser manifests both produce browser-unavailable mode while preserving the other six tools.
- Required RED first failed on missing orchestration exports. Subsequent adversarial tests proved stop during tunnel startup, true deadline behavior, lock replacement refusal, browser-degraded mode, default production graph construction, owner-password persistence, factory lock cleanup, exact CLI routing, and sessionless TTY refusal before state creation.
- Runtime target passes 18/18; exact T14 runtime/CLI/config/OAuth target passes 49/49; five runtime stress runs pass 90/90. Full typecheck, 185/185 tests, and build pass. Post-stress Loom-owned process and listener scans are empty.
- This completes deterministic local T14 only. Real named-tunnel DNS/credentials and real ChatGPT OAuth/tool calls remain G5/G6 blockers; packaging/docs and clean-machine certification remain T15/T16.

Evidence:

```text
node --test dist/test/runtime.test.js dist/test/cli.test.js dist/test/config.test.js dist/test/oauth.test.js
PASS (49/49)

five consecutive runtime-suite runs
PASS (90/90 test executions)
active test processes: none
Loom-owned listeners: none

npm run typecheck
PASS
npm test
PASS (185/185)
npm run build
PASS
```

### T15 — packaging and public operating documentation

- Finalized the operator and security guides around the actual supported command surface, foreground-only trust boundary, Quick-versus-Named tunnel behavior, browser setup/recovery, configuration and owner-password reset, shutdown ownership rules, diagnostics, and incident response.
- Added the MIT distribution notice and the public release-certification guide plus a sanitized release-evidence index.
- Corrected the package allowlist so the tarball contains the compiled runtime, dashboard assets, README, license, notice, and only the public operator/security/development/certification documents. Internal implementation plans, release-evidence artifacts, source tests, and compiled tests are explicitly excluded.
- Corrected both packaged executable boundaries. `loom` and `loom-certify` now execute through npm-created package-bin symbolic links; the certification CLI regression was reproduced as silent output before the realpath fix.
- Built `loom-mcp-0.1.0.tgz`, installed it with scripts disabled into a new temporary prefix and temporary HOME, and verified installed version/help behavior, public assets, and fail-closed launches. Plain launch and sessionless YOLO launch both exit 2, and the failed YOLO attempt creates no `~/.loom` state.
- The candidate tarball contains 90 files, is 186200 bytes, and has SHA-256 `3711d511bf530ec3d834b4a021d960cbb001af43c126c850069640bfd7f7a549`. The temporary installation and tarball directory were removed after verification. No package was published.
- Sanitized local package evidence is recorded in `docs/release-evidence/t15-local-package.md`.

### T15.1 — fail-closed certification evidence tooling and recovery

- Resumed from commits that had advanced beyond the T14 handoff without same-commit governance and with a non-compiling certification test. The mandated startup gate first exposed invalid TypeScript syntax, then a missing `./filesystem.js` import. The repair reused the existing path-policy module rather than inventing a duplicate filesystem abstraction.
- Added a packaged `loom-certify` command that collects deterministic typecheck/test/build/documentation/map/package/residue evidence for the exact current commit, writes a private canonical report, and validates strict optional external-evidence manifests and stable private artifact hashes.
- Closed a release-blocking trust flaw found during adversarial review: self-authored JSON booleans and artifact hashes cannot prove real Cloudflare, ChatGPT, OAuth, tool-call, cleanup, clean-host, sleep/wake, or connector-persistence events. G5–G7 now remain blocked pending human review even when a supplied manifest passes schema and hash checks; the automated tool cannot independently mark a release certified.
- Bound G5 evidence to the exact pinned architecture-specific Cloudflared executable, Cloudflared version `2026.7.0`, Chromium revision `1228`, and architecture-specific Chromium executable hash. Quick Tunnel evidence is optional and never certifying.
- Hardened artifact/report paths against symbolic links, including rejecting an existing symbolic-link parent before directory creation. Report files remain private canonical JSON.
- Strengthened package certification to require every public release asset and reject `.loom`, credential-like files, source/compiled tests, internal plans, release-evidence artifacts, dependencies, and VCS content.
- Strengthened process-residue checks to include wrapper/runtime/terminal groups, the managed `~/.loom/cloudflared/cloudflared` executable, and the dedicated `~/.loom/browser-profile` process family.
- Added executable documentation checks for the human-review boundary and corrected stale certification examples to the current managed-component pins.
- Independent automated review was attempted in read-only mode, but Gemini lacked `GEMINI_API_KEY` and no Codex reviewer CLI was installed. This was not treated as approval; a direct adversarial review produced the trust, symlink, package, pinning, and residue fixes above.
- Final focused certification/documentation validation passes 19/19. Full typecheck, 204/204 tests, build, the 90-file package dry run, clean-prefix install, and delayed Loom-owned process scan all pass.

Evidence:

```text
npm run typecheck
PASS

npm test
PASS (204/204)

npm run build
PASS

node --test dist/test/certification.test.js dist/test/certification-cli.test.js dist/test/docs.test.js
PASS (19/19)

npm pack --dry-run --json
PASS (90 public release files)
forbidden package paths: none

clean temporary-prefix tarball install
loom --version: 0.1.0
loom --help: PASS
loom-certify --help: PASS
plain launch: exit 2
sessionless YOLO launch: exit 2
state created: no

package SHA-256
3711d511bf530ec3d834b4a021d960cbb001af43c126c850069640bfd7f7a549

post-suite delayed Loom-owned process scan
<no output>
```

### T15.2 — external expert audit dossier

- Added an explicit plan amendment for one repository-root, self-contained external audit dossier without changing runtime behavior, dependencies, public commands, or the npm package allowlist.
- Added an executable documentation contract requiring the dossier’s core product, architecture, security, repository-ledger, implementation-plan, evidence, and embedded-document sections; the exact seven tools; the human-review and does-not-prove certification boundary; G5/G6/G7 status; and representation of every tracked path documented by `REPO_MAP.md`.
- Required RED reproduced the missing deliverable as `ENOENT: EXTERNAL_AUDIT.md` before the dossier was created.
- Authored the audit narrative from the actual source and governance state, including end-to-end startup/shutdown flow, trust boundaries, local state, process supervision, audit, OAuth/MCP, every tool, browser, Cloudflare, dashboard, package/certification behavior, implementation chronology, evidence status, and an external-review checklist.
- Generated the exact tree, source/export index, test inventory, and verbatim snapshots of the canonical plan plus relevant design, scope, governance, operations, security, release, evidence, package, license, and history documents into the same Markdown file.
- Fresh pre-edit startup validation passed `npm ci`, typecheck, 204/204 tests, and build with zero vulnerabilities and a clean worktree. Final T15.2 validation is recorded below after dossier assembly.

RED evidence:

```text
node --test --test-name-pattern='external audit dossier' dist/test/docs.test.js
FAIL (expected)
ENOENT: /Users/aashu/loom/EXTERNAL_AUDIT.md
```

GREEN and validation evidence:

```text
node --test --test-name-pattern='external audit dossier' dist/test/docs.test.js
PASS (1/1)

npm run typecheck
PASS

npm test
PASS (205/205)

npm run build
PASS

EXTERNAL_AUDIT.md generated inventory
represented files: 73
static test declarations: 205
mandatory headings missing: none
mapped paths missing: none

npm pack --dry-run --json
PASS (90 public release files, 186200 bytes)
EXTERNAL_AUDIT.md packaged: no
forbidden paths: none

supported secret-material scan
findings: none

Loom-owned wrapper/cloudflared/browser-profile residue
none
```

### T15.3 — adversarial security verification and hardening

- Treated five externally supplied adversarial reviews as hypotheses and verified each consolidated claim against the exact source, pinned MCP SDK, deterministic tests, or controlled local experiments before changing behavior.
- Added a complete classification record at `docs/release-evidence/t15.3-adversarial-review.md`, separating verified fixes, verified residual risks, false positives/already-mitigated claims, and intentional scope tradeoffs.
- Replaced the pinned SDK helper's unbounded global JSON parser with explicit localhost Host validation, a route-specific 9 MiB MCP parser, 64 KiB OAuth metadata parsers, and structured 413/400 responses before SDK or Zod handling.
- Added a monotonic global owner-password authorization limit of ten attempts per 60-second foreground process window with 429 and `Retry-After` behavior.
- Raised new owner-password scrypt verifiers to N=32768, r=8, p=3 with explicit memory bounds and added transparent atomic migration after successful verification of legacy N=16384, r=8, p=1 state.
- Bound refresh-token rotation to one absolute 30-day family expiration so regular use cannot renew access indefinitely.
- Bounded every watchdog `ps`/`lsof` command with a fixed C locale, bounded output, two-second SIGKILL timeout, serialized wrapper identity probes, monotonic heartbeat age, and distinct mismatch-versus-unavailable handling.
- Canonicalized only macOS's root-owned `/tmp` and `/var` aliases, opened read targets nonblocking before regular-file verification, rechecked memory tombstone identity immediately before removal, and made runtime-lock creation explicitly `O_EXCL | O_NOFOLLOW`.
- Preserved capability-reducing safety controls during audit degradation: terminal cancel and browser tab close remain available while capability-increasing mutations remain audit-fail-closed.
- Converted runtime, ProcessManager, wrapper, dashboard, and MCP in-process safety windows to monotonic time while retaining wall time for persisted OAuth expiry and human-readable records.
- Added explicit OSC 52 regression coverage and a bounded 256 KiB hostile Quick Tunnel parser input.
- Controlled experiments showed a 64 MiB terminal-output command completed normally in about 323 ms without false watchdog termination, while a child deliberately launched with `start_new_session=True` escaped owned-PGID cancellation as expected; the escaped process was explicitly killed and the residual limitation is now documented.
- Expanded README, security, operator, development, release-certification, specification, and evidence guidance for prompt injection, persistent browser/memory state, remote-client/provider disclosure, login-shell secrets, TCC, localhost/LAN pivoting, local-only containment, non-forensic audit, deliberate process escape, filesystem durability assumptions, artifact retention, terminal scrollback, and package trust roots.
- The first full suite reached 213/214 and exposed a timing-dependent transient-EPERM test failure. Root cause was overlapping wrapper fallback identity probes plus transient `lsof` unavailability being treated as parent death. The wrapper fix passed the transient-EPERM test ten consecutive isolated runs, then the complete suite passed 214/214.
- Built and installed the hardened tarball into an isolated prefix/HOME. The package remains 90 public files with internal tests, plans, release evidence, and `EXTERNAL_AUDIT.md` excluded. Installed version/help and certification help passed; plain and sessionless YOLO launches exited 2 and created no state. Nothing was published or deployed.

Evidence:

```text
npm run typecheck
PASS

npm test
PASS (214/214)

npm run build
PASS

focused hardening suite
PASS (68/68)

transient EPERM isolated stress
PASS (10/10)

npm pack --dry-run --json
PASS — 90 files, 194258 bytes
forbidden internal paths: none

actual tarball
loom-mcp-0.1.0.tgz
bytes: 194258
SHA-256: 31c0f309a0bb94d3b974a852f0510282898ec5087c98f1229fe94c8203f1a491

isolated installed package
loom --version: 0.1.0
loom --help: PASS
loom-certify --help: PASS
plain launch: exit 2
sessionless YOLO launch: exit 2
state created: no
```
~~~~~

### Embedded source: `HANDOFF.md`

- Bytes: `9704`
- Lines: `202`
- SHA-256: `03b190ca755cbd2b066e63125d3fdf8e9f6b0401dff1bb7bc50b1c22870a703d`

~~~~~markdown
# Loom Implementation Handoff

**Date and local time:** 2026-07-08 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA before pending T15.3 commit:** `82412ef4753ba2bff4ea8e47d7cc52a13a0460ce`
**Repository state:** dirty only with completed T15.3 adversarial hardening, tests, evidence, public threat-model updates, regenerated audit dossier, and synchronized governance
**Current task:** T15.3 complete locally; commit pending
**Last completed gate:** typecheck, 214/214 tests, build, ten-run transient-EPERM stress, exact 74-file map/dossier coverage, 22 embedded-source hash checks, 90-file package inspection, isolated tarball installation, supported secret scan, and empty Loom-owned residue scan
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## T15.3 completed work

- Treated all five supplied adversarial reviews as hypotheses and verified consolidated claims against source, the pinned MCP SDK, tests, or controlled local experiments.
- Added `docs/release-evidence/t15.3-adversarial-review.md` with verified/fixed, verified/residual, false-positive/already-mitigated, and intentional-scope classifications.
- Replaced the SDK helper's unbounded JSON parser with explicit localhost Host validation, a pre-SDK 9 MiB MCP body limit, 64 KiB OAuth metadata parsers, and structured 413/400 responses.
- Added monotonic owner-password authorization throttling: ten attempts per 60-second foreground-process window with 429 and `Retry-After`.
- Changed new owner verifiers to scrypt N=32768, r=8, p=3 with explicit memory bounds and transparent atomic migration after successful legacy N=16384, r=8, p=1 verification.
- Added one absolute 30-day refresh-token family expiration across rotation.
- Added fixed C locale, bounded output, and two-second hard timeout to all watchdog `ps`/`lsof` probes.
- Serialized wrapper identity probes, converted wrapper heartbeat age to monotonic time, and distinguished confirmed parent mismatch from temporary process-table unavailability.
- Converted runtime, ProcessManager, dashboard, and MCP session in-process deadlines to monotonic time.
- Canonicalized only macOS `/tmp` and `/var` aliases to `/private/tmp` and `/private/var`.
- Opened final read targets with `O_NONBLOCK | O_NOFOLLOW` before regular-file verification to prevent FIFO/device hangs.
- Rechecked exact memory-tombstone identity immediately before removal.
- Made runtime-lock creation explicitly `O_CREAT | O_EXCL | O_NOFOLLOW`.
- Kept terminal start and capability-increasing browser work audit-fail-closed, while preserving terminal cancellation and browser-tab close as best-effort-audited containment actions.
- Added OSC 52 stripping coverage, a bounded 256 KiB hostile Quick Tunnel parser case, wall-clock-jump dashboard coverage, body-limit/rate-limit/scrypt/refresh/FIFO/tombstone/watchdog regressions, and updated exact limits.
- Controlled output-flood experiment: 64 MiB terminal output completed normally in about 323 ms without false watchdog termination or residue.
- Controlled deliberate-session-escape experiment: a child launched with `start_new_session=True` survived owned-PGID cancellation, was explicitly killed, and is now documented as outside the cleanup guarantee.
- Expanded README, SPEC, security, operator, development, release-certification, release-evidence, and external-audit guidance for prompt injection, provider disclosure, persistent state, login-shell secrets, TCC, LAN pivoting, local-only containment, non-forensic audit, process escape, storage durability, retention, password scrollback, and artifact trust.

## RED/GREEN evidence

```text
MCP body limit RED
new test failed before the explicit pre-SDK parser existed
GREEN: structured 413 and zero sessions

authorization throttle RED
new setup options/behavior absent
GREEN: two attempts accepted in test window, third 429, accepted after monotonic expiry

owner scrypt migration / refresh family RED
new parameters and family expiration absent
GREEN: legacy hash upgraded after correct owner authorization; refresh at day 29 cannot rotate after day 30

watchdog RED
runWatchdogCommand export absent
GREEN: fixed C locale and SIGKILL timeout

FIFO read / macOS aliases / safety cancellation / tombstone identity
new expectations failed or were absent before production changes
GREEN in focused suite

documentation RED
security/operator residual-risk test failed first on missing prompt-injection disclosure
GREEN: docs target passes
```

## Exact final commands and results so far

```text
mandatory startup gate at 82412ef
npm ci
PASS — 106 packages, 0 vulnerabilities
npm run typecheck
PASS
npm test
PASS — 205/205 baseline
npm run build
PASS
repository map
PASS — 73/73 before T15.3 edits

focused hardening target
PASS — 68/68

dashboard/runtime/process monotonic target
PASS — 31/31

browser/terminal containment target
PASS — 27/27

transient EPERM isolated stress after wrapper fix
PASS — 10/10

complete current gate
npm run typecheck
PASS
npm test
PASS — 214/214
npm run build
PASS

npm pack --dry-run --json
PASS — 90 files, 194258 bytes
forbidden internal paths: none

actual hardened tarball
loom-mcp-0.1.0.tgz
bytes: 194258
SHA-256: 31c0f309a0bb94d3b974a852f0510282898ec5087c98f1229fe94c8203f1a491

isolated prefix/HOME install
loom --version: 0.1.0
loom --help: PASS
loom-certify --help: PASS
plain launch: exit 2
sessionless YOLO launch: exit 2
state created: no
```

## Review classification highlights

Already mitigated or false-positive claims include loopback CDP binding, cryptographic OAuth transaction and job IDs, 0600 config backup, launch-time Cloudflared re-verification, absence of public `z.coerce`, exact environment-key grammar, OSC 52 passage, Quick-parser ReDoS, `--` tunnel-name injection, active-request decrement without `finally`, and hard-link overwrite through atomic rename.

Verified residual risks now disclosed include indirect prompt injection/cross-tool escalation, authorized-client/provider data exposure, persistent browser/memory/artifacts, login-shell/inherited secrets, macOS TCC, localhost/private-network pivoting, local-only incident containment, privacy-oriented non-forensic audit, deliberate `setsid()` escape, finite process-identity precision, local-filesystem/power-loss assumptions, operator-managed retention, terminal scrollback, and no out-of-band package-signing root.

## Known failures and corrections

- The first T15.3 full suite reached 213/214. The transient-EPERM escalation test intermittently observed no SIGKILL retry because overlapping wrapper fallback probes and transient bounded `lsof` failure could trigger false orphan cleanup while heartbeats were healthy.
- Root correction serialized wrapper identity probes, used monotonic heartbeat age, and distinguished `unknown` observation from `mismatch`. The isolated test then passed ten consecutive runs and the full suite passed 214/214.
- The deliberate process-session escape is not a failed test or claimed fix; it is an experimentally verified residual limitation.

## Real blockers

- G5 requires an eligible current ChatGPT workspace/account, a real stable Named Tunnel, real DNS/public `/mcp` routing, and public OAuth discovery.
- G6 requires real ChatGPT authorization, all seven real tool categories, access-token refresh/reconnect, public-access termination, and process tables for Ctrl+C, SIGTERM, terminal close, and forced parent death.
- T16 still requires remaining manual sleep/wake, connector persistence, real owner-password lifecycle, clean supported-Mac evidence, sanitized committed external artifacts, and human review.
- G7 remains blocked. T15.3 does not turn residual unrestricted-agent risks into mitigations and does not grant production certification.

## Files changed

- `CHANGELOG.md`
- `EXTERNAL_AUDIT.md`
- `HANDOFF.md`
- `README.md`
- `REPO_MAP.md`
- `SPEC.md`
- `docs/DEVELOPMENT.md`
- `docs/OPERATOR.md`
- `docs/RELEASE_CERTIFICATION.md`
- `docs/SECURITY.md`
- `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- `docs/release-evidence/README.md`
- `docs/release-evidence/t15.3-adversarial-review.md`
- `src/child-wrapper.ts`
- `src/dashboard.ts`
- `src/limits.ts`
- `src/mcp.ts`
- `src/oauth.ts`
- `src/paths.ts`
- `src/process-manager.ts`
- `src/runtime.ts`
- `src/tools/browser.ts`
- `src/tools/files.ts`
- `src/tools/memory.ts`
- `src/tools/terminal.ts`
- `src/watchdog.ts`
- `test/browser.test.ts`
- `test/cloudflare.test.ts`
- `test/dashboard.test.ts`
- `test/docs.test.ts`
- `test/files.test.ts`
- `test/limits.test.ts`
- `test/mcp.test.ts`
- `test/memory.test.ts`
- `test/oauth.test.ts`
- `test/output.test.ts`
- `test/paths.test.ts`
- `test/terminal.test.ts`
- `test/watchdog.test.ts`

## Final dossier and integrity evidence

```text
EXTERNAL_AUDIT.md represented files: 74
static test declarations: 214
embedded canonical sources: 22
missing mapped paths: none
package files: 90
package bytes: 194258
supported secret findings: none
Loom-owned process residue: none
```

## Exact next command

```bash
git add CHANGELOG.md EXTERNAL_AUDIT.md HANDOFF.md README.md REPO_MAP.md SPEC.md docs src test && git diff --cached --check && git commit -m "fix: harden adversarial security boundaries"
```

## Next expected result

A single clean T15.3 local commit with the regenerated 74-file audit dossier, 214/214 tests, unchanged 90-file public allowlist, exact hardened tarball evidence, no secrets or Loom-owned residue, and all external/manual certification gates still honestly blocked. No push, publication, or deployment.
~~~~~

### Embedded source: `docs/release-evidence/README.md`

- Bytes: `3240`
- Lines: `67`
- SHA-256: `798b4d743a977de48adb8502328291ddf77a32164e25d84d2753d19f9f24ec82`

~~~~~markdown
# Loom Release Evidence Index

This directory indexes sanitized evidence for release gates. It must never contain owner passwords, OAuth tokens, Cloudflare API tokens, tunnel secrets, authorization headers, browser typed secrets, or private file content.

## Deterministic local evidence

Current local implementation evidence is recorded in `CHANGELOG.md` and `HANDOFF.md` for each task. T14 records the integrated runtime and stress gates. T15/T15.1 record the 204-test full suite, fail-closed certification boundary, 90-file public-only package, clean-prefix installation, installed CLI behavior, and empty delayed Loom-owned process scan. T15.2 records the external audit dossier. T15.3 records code-grounded verification of the supplied adversarial reviews, fixes, residual risks, false positives, and controlled process experiments.

- `t15-local-package.md` — candidate tarball hash, environment, package contents, clean-prefix install, installed executable checks, and fail-closed launch evidence.
- `t15.3-adversarial-review.md` — consolidated adversarial finding classification, deterministic fixes, empirical output/session tests, and residual-risk disclosures.

## G5 — real Named Tunnel prerequisite

Status: **not yet certified**.

Expected evidence files:

- `g5-environment.md`
- `g5-cloudflare-verification.md`
- `g5-public-oauth-discovery.md`
- sanitized screenshots or transcripts referenced by those Markdown files

The evidence must show a real stable hostname, current Named Tunnel credentials, exact public `/mcp` routing, OAuth discovery, and an eligible ChatGPT custom-MCP workspace/account.

## G6 — real ChatGPT and cleanup

Status: **not yet certified**.

Expected evidence files:

- `g6-chatgpt-oauth.md`
- `g6-seven-tools.md`
- `g6-refresh-reconnect.md`
- `g6-shutdown-cleanup.md`
- sanitized screenshots or transcripts referenced by those Markdown files

The evidence must show real ChatGPT OAuth, exactly seven tools, representative tool calls, refresh/reconnect behavior, and cleanup after Ctrl+C, SIGTERM, terminal close, and forced parent death.

## Clean supported-Mac certification

Status: **not yet certified**.

Expected evidence files:

- `clean-mac-install.md`
- `clean-mac-browser-setup.md`
- `clean-mac-packaging.md`

The evidence must identify the macOS and Node versions, package SHA, installed file list, browser revision/hash, test commands, and cleanup observations.

## Evidence format

Each evidence document should include:

1. date and timezone
2. machine and supported OS/Node versions
3. Loom commit SHA and package version
4. exact commands
5. sanitized outputs
6. success/failure assessment
7. process/listener observations
8. artifacts referenced by relative path
9. remaining limitations

If a gate is unavailable because credentials, account eligibility, DNS, or a clean machine are unavailable, record the blocker in `HANDOFF.md`; do not create simulated evidence.

`loom-certify` can validate an evidence manifest's structure, release SHA, pinned binary metadata, and referenced artifact hashes. It cannot determine whether the external events described by the manifest actually happened, so G5–G7 remain blocked until the sanitized artifacts are reviewed by a human.
~~~~~

### Embedded source: `docs/release-evidence/t15-local-package.md`

- Bytes: `2561`
- Lines: `90`
- SHA-256: `267f01b8955256749368afc89c72db66017473fbf94493b3cb548f3a829df271`

~~~~~markdown
# T15 Local Package Evidence

## Scope

This is deterministic local packaging evidence for the T15 candidate working tree. It is not G5, G6, T16, or production-certification evidence. No package was published.

## Environment

- Date and local time: 2026-07-08 20:58:04 PDT
- Checkout: `/Users/aashu/loom`
- Branch: `planning/loom-v1-cavekit`
- Parent commit before the pending T15/T15.1 commit: `91b6b23cdd8f4f0ba363a969d31a4af81738aa7a`
- Platform: Darwin arm64
- macOS: 26.5.1
- Node.js: v26.0.0
- npm: 11.12.1
- Package: `loom-mcp-0.1.0.tgz`
- Package bytes: 186200
- Package SHA-256: `3711d511bf530ec3d834b4a021d960cbb001af43c126c850069640bfd7f7a549`

## Repository gates

```text
npm run typecheck
PASS

npm test
PASS — 204/204

npm run build
PASS

npm pack --dry-run --json
PASS — 90 files
```

The dry-run file list contained no `test/`, `dist/test/`, `docs/plans/`, or `docs/release-evidence/` paths. A delayed process-table scan found no Loom-owned wrapper, runtime, terminal, managed Cloudflared, or dedicated browser-profile residue.

## Clean-prefix install

The tarball was installed with scripts disabled into a newly created temporary prefix and a newly created temporary HOME:

```text
npm install --prefix <temporary-prefix> <tarball> --ignore-scripts --no-audit --no-fund
PASS
```

Installed executable checks:

```text
loom --version
0.1.0

loom --help
PASS — includes `loom launch --yolo`

loom-certify --help
PASS — includes `loom-certify --output`
```

Installed package checks:

```text
Dashboard assets present: yes
Operator/security/development/release-certification documents present: yes
License and notice present: yes
Internal implementation plan absent: yes
Release-evidence directory absent: yes
Compiled tests absent: yes
```

Fail-closed launch checks used the temporary HOME:

```text
loom launch
exit 2
Unrestricted access is disabled. Start it explicitly with: loom launch --yolo

sessionless loom launch --yolo
exit 2
Local terminal confirmation is required: ENXIO opening /dev/tty

~/.loom created in temporary HOME: no
```

The temporary installation and tarball directory were removed after verification.

## Assessment

T15 local package construction and clean-prefix installation pass for this candidate content. This evidence does not prove a clean supported-Mac browser installation, real Named Tunnel routing, real ChatGPT OAuth or tool calls, sleep/wake behavior, connector persistence, or required external cleanup paths. Those remain T16/G5/G6 work and require real sanitized evidence plus human review.
~~~~~

### Embedded source: `docs/release-evidence/t15.3-adversarial-review.md`

- Bytes: `18840`
- Lines: `279`
- SHA-256: `3bb5e05a5de5c336df2d77e272e853cb37b6181810540beff4779ae4db3e2d80`

~~~~~markdown
# T15.3 Adversarial Review Verification

Date: 2026-07-08 PDT
Baseline commit: `82412ef4753ba2bff4ea8e47d7cc52a13a0460ce`
Task: T15.3 adversarial security verification and hardening
Status: deterministic local hardening only; G5, G6, T16 external/manual work, and G7 remain blocked

## Method

Five externally supplied adversarial reviews were treated as hypotheses. Each claim was checked against the exact source, pinned MCP SDK, deterministic tests, or a controlled local experiment before it was accepted. Duplicate claims were consolidated. A finding was classified as:

- **Verified and fixed** — the implementation had a concrete defect and now has a regression test.
- **Verified residual risk** — the behavior is real but cannot honestly be eliminated within Loom v1's unrestricted, foreground-only scope; public documentation now states it.
- **Already mitigated / false positive** — the implementation already enforced the requested property or the proposed exploit did not apply.
- **Intentional scope tradeoff** — the behavior follows the approved product contract and is disclosed rather than silently reframed as a mitigation.

No real credentials, account identifiers, owner passwords, tokens, private file content, or external deployment were used.

## Verified and fixed

### MCP request-body exhaustion

The pinned SDK helper `createMcpExpressApp()` installed an unbounded `express.json()` middleware before Loom's route handlers. A large authenticated JSON body could therefore be allocated and parsed before Zod tool validation.

Correction:

- replaced the helper with a plain Express app plus the SDK's localhost Host-header middleware
- installed a route-specific MCP JSON parser before transport handling
- bounded the body at 9 MiB, allowing the 8 MiB public write contract plus protocol overhead
- retained 64 KiB JSON/form limits for OAuth and dashboard-style metadata requests
- return a structured JSON-RPC 413 before SDK or tool-schema handling

Regression: `MCP JSON parsing rejects oversized bodies before SDK or tool-schema handling`.

### Public owner-password brute-force surface

The public authorization POST had no request-rate control. Dynamic client registration is intentionally available, so owner-password attempts required a separate bound.

Correction:

- global in-process monotonic window
- ten attempts per 60 seconds in production
- 429 plus `Retry-After` while limited
- counter resets with the foreground process and is not represented as distributed edge protection

Regression: `owner-password authorization attempts are globally bounded by a monotonic window`.

### Owner-password scrypt work factor and migration

New owner verifiers used scrypt N=16384, r=8, p=1. T15.3 selected N=32768, r=8, p=3, one of the currently documented OWASP scrypt parameter sets, after measuring it on the supported development Mac. The measured single derivation was about 307 ms; the older setting was about 54 ms.

Correction:

- new verifiers use N=32768, r=8, p=3
- scrypt memory limits are set explicitly
- successful owner authorization transparently replaces a weaker legacy verifier in the same atomic state mutation
- failed authorization never upgrades state

Regressions:

- `owner password is created once, scrypt-verified, private, and persistent across reopen`
- `successful owner authorization upgrades a legacy scrypt hash in place`

### Indefinitely renewable refresh tokens

Each refresh previously issued a fresh 30-day expiration, allowing regular use to renew access indefinitely.

Correction:

- initial refresh tokens record an absolute family expiration
- rotation carries that family expiration forward
- legacy tokens without the field use their existing expiration as the family boundary
- a family cannot issue a token after its original 30-day boundary

Regression: `refresh-token rotation preserves one absolute family expiration`.

### Unbounded and locale-sensitive watchdog subprocesses

`ps` and `lsof` used bounded output but no execution deadline and inherited the caller locale. A blocked command could stall identity checks, and locale variation could destabilize `lstart` parsing.

Correction:

- fixed `PATH`, `LANG=C`, and `LC_ALL=C`
- two-second hard timeout with SIGKILL
- existing output bounds retained
- every watchdog `ps` and `lsof` call uses the common helper
- child-wrapper identity probes are serialized so fallback intervals cannot create overlapping `lsof` work
- a transient inspection failure is distinguished from a confirmed parent mismatch; healthy monotonic heartbeats prevent false orphan cleanup, while stale heartbeats plus unavailable identity still fail closed

Regressions: `watchdog subprocesses are locale-pinned and terminate at their explicit deadline`; the transient-EPERM process test passed ten consecutive isolated runs after the wrapper fix.

### Special-file read hang

A final symlink target was opened before `fstat()` verified it was a regular file. A FIFO target could block the event loop awaiting a writer.

Correction:

- open the canonical target with `O_NONBLOCK | O_NOFOLLOW | O_RDONLY`
- reject nonregular targets before reading

Regression: `final symlinks to FIFOs fail promptly without blocking the file-read worker`.

### macOS `/tmp` and `/var` compatibility aliases

The mutation path policy rejected every symlink component, including macOS's root-owned `/tmp -> /private/tmp` and `/var -> /private/var` aliases. This broke legitimate absolute paths.

Correction:

- on macOS only, canonicalize exact `/tmp` and `/var` paths and descendants to `/private/tmp` and `/private/var`
- do not generalize this exception to arbitrary symlinks

Regression: `resolveUserPath accepts only absolute paths or ~/ paths` now proves both aliases and a `/tmp-like` nonmatch.

### Safety actions during audit degradation

A failed audit store blocked terminal cancellation and browser-tab closure along with capability-increasing mutations. That removed targeted containment during exactly the failure mode where it could be most important.

Correction:

- terminal start and capability-increasing browser operations remain audit-fail-closed
- terminal cancellation and browser-tab closure attempt audit best effort but proceed if audit is unavailable
- runtime-wide shutdown was already independent of public mutation audit

Regressions:

- `audit failure blocks terminal start but preserves cancellation and polling as safety operations`
- `audit failure blocks capability-increasing browser mutations but preserves tab close and read-only actions`

### In-process wall-clock deadline sensitivity

Some shutdown, process, dashboard, and MCP session deadlines used `Date.now()`. Wall-clock changes should not alter an in-process safety interval.

Correction:

- runtime and ProcessManager shutdown deadlines use `performance.now()`
- dashboard nonce/session defaults use `performance.now()`
- MCP session idle and authorization-attempt windows use an injected/default monotonic clock
- persisted OAuth expiration and human-readable audit timestamps remain wall-clock values because they must survive process restart or be understandable to an operator

Regression: `dashboard bootstrap lifetime is unaffected by wall-clock jumps`; existing runtime and ProcessManager deadline suites remain green.

### Tombstone replacement identity

Memory tombstone recovery verified the file before durable audit admission but did not compare its identity again immediately before path removal.

Correction:

- repeat symlink, regular-file, and full dev/inode/size/mtime/ctime identity verification immediately before removal
- refuse cleanup and retain a diagnostic when replacement is observed

Regression: `tombstone recovery refuses to remove a path replaced after verification`.

### Runtime-lock syscall ambiguity

`open(path, "wx", 0600)` already provides exclusive creation and prevents replacing an existing symlink. T15.3 nevertheless made the syscall intent explicit with `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW`.

Existing live-owner and replaced-lock tests remain the behavioral gate.

### OSC terminal controls

Node's `stripVTControlCharacters()` already removed OSC 52 clipboard sequences. A regression now locks that behavior so future sanitizer changes cannot pass OSC clipboard payloads through MCP output.

Regression: `bounded output preserves stdout/stderr order and sanitizes terminal controls`.

## Verified residual risks and scope disclosures

### Indirect prompt injection and cross-tool escalation

Files, pages, skills, memory, and terminal output are untrusted content returned to the authorized model. Loom cannot reliably distinguish instructions from data. Content can influence the model to invoke unrestricted terminal, file, memory, or browser operations. Memory and the browser profile persist across reset/restart, so injected state can survive OAuth credential rotation.

Disposition: explicitly documented in README, security model, operator guide, specification, and certification limitations. Not represented as solved.

### Data disclosure to the authorized client/provider

Audit redaction protects the local JSONL record, not the normal MCP content channel. File contents, terminal output, browser text, screenshots, and results intentionally go to the authorized remote client and may be processed or retained by its provider.

Disposition: explicit trust-boundary disclosure and preflight guidance.

### Persistent browser and memory state

The dedicated browser profile preserves cookies/local storage and Loom memory persists. `loom auth reset` revokes OAuth but does not clear browser profile, memory, skills, downloads, screenshots, shell profiles, scheduled jobs, or files created by a client.

Disposition: explicit incident-response checklist; no automatic destructive reset added.

### Login-shell and inherited-environment exposure

The approved terminal adapter remains `/bin/sh -lc`. It can source login profile files, and ProcessManager inherits Loom's environment plus explicit overrides. Secrets present there are intentionally accessible to an unrestricted terminal client.

Disposition: operator guidance to use a dedicated account/minimal environment and review profile files. Changing to a non-login shell would alter the approved unrestricted-terminal behavior and user environment semantics.

### macOS TCC and Full Disk Access

TCC can deny Desktop/Documents/Downloads, network volume, Accessibility, Automation, Camera, Microphone, or Full Disk Access operations. Loom cannot bypass or reliably answer permission prompts remotely.

Disposition: requirements and security documentation now state this operating-system boundary.

### Localhost/private-network pivot

Browser navigation and terminal networking intentionally allow localhost and private IP space. An authorized or prompt-injected client can access services that trust local network position.

Disposition: explicit SSRF/LAN-pivot disclosure. No network allowlist was added because it would contradict the locked unrestricted developer-tool scope.

### Local-only incident containment

The dashboard and foreground stop controls bind locally. There is no independent remote kill service; containment while away requires physical access or another trusted remote-admin path.

Disposition: explicit operator/security disclosure. Adding a cloud kill service would violate the foreground-only/no-control-plane scope.

### Audit is not forensic or tamper-evident

Commands, outputs, file contents, page text, typed values, and secrets are intentionally omitted. An authorized shell client has the same-user access needed to alter or delete local logs.

Disposition: security and operator docs now call audit privacy-oriented coarse activity evidence, not forensic proof. No off-box audit service or command logging was introduced.

### Deliberate process-session escape

A controlled local experiment started `/bin/sleep 30` from Python with `start_new_session=True`. Cancelling the wrapper-owned process group left the escaped process alive. The test harness then killed it explicitly and verified no residue.

Disposition: process cleanup claims are now limited to ordinary descendants that remain in the inherited group. Preventing deliberate `setsid()` escape requires sandbox/OS containment outside Loom v1's scope.

### Filesystem crash and network-mount durability

Atomic same-directory replacement and `fsync` establish process-visible atomicity on the tested local macOS filesystem but do not prove storage-controller power-loss durability. Loom does not call Apple's stronger `F_FULLFSYNC` and does not certify state on NFS/SMB mounts.

Disposition: development and certification documentation corrected; no false durability claim.

### Artifact retention

Browser profile, downloads, screenshots, and memory have no automatic retention cleanup. They can contain sensitive data and grow until the operator removes them.

Disposition: operator-managed retention is disclosed; automatic destructive cleanup was not added.

### Package/certification root of trust

A compromised repository could modify both Loom and the in-package `loom-certify`. Git cleanliness and the packaged verifier do not create an out-of-band trust root.

Disposition: release certification now requires an independently recorded tarball hash and recommends detached signing or equivalent external verification before distribution.

### Process identity precision and same-user races

The macOS process-table identity uses PID, executable path, and `ps lstart`, whose wall representation has finite precision. Identity is rechecked and uncertain cases fail closed, but same-user manipulation and races are not eliminated by this mechanism.

Disposition: retained as a same-user/out-of-scope limitation; watchdog subprocesses are now bounded and locale-pinned.

## Already mitigated or false-positive claims

- **Browser CDP bound to all interfaces:** false. Setup and runtime backend both pass `--remote-debugging-address=127.0.0.1` with an ephemeral port.
- **Audit admission deadline depends on wall-clock time:** false. Durable admission is raced against a real `setTimeout`; only human-readable timestamps and duration reporting used wall time. Other in-process safety clocks were still converted to monotonic time where applicable.
- **Fast target IPC ordering was unaddressed:** false for the current baseline. T13.1 already flushes wrapper `ready` before target `exit`/disconnect, flushes startup errors, preserves an exit arriving during managed-object construction, and stress-tests twenty rapid exits.
- **Predictable OAuth transaction IDs:** false. Transactions use 32 bytes from `crypto.randomBytes()` and only their SHA-256 hashes are stored.
- **Predictable terminal job IDs:** false. Process launch IDs use `crypto.randomUUID()` and public jobs are `job_<uuid>`.
- **Config backup mode may be 0644:** false. Invalid config backup uses the atomic private writer and is created 0600.
- **Cloudflared discovery-to-launch swap accepted:** false for the launch boundary. Every launch reopens and revalidates stable identity, exact hash, and exact version.
- **Zod coercion bypass:** no public tool schema uses `z.coerce`. The only `.passthrough()` use parses npm's external pack-report envelope, not public MCP input.
- **Environment key injection:** false. Terminal keys use `^[A-Za-z_][A-Za-z0-9_]*$`; values and total bytes are bounded and NUL-free.
- **Quick parser catastrophic backtracking:** not supported by the simple bounded regex. A 256 KiB hostile input regression completes within the fixed test bound.
- **`--` tunnel-name injection:** false. It begins with `-` and is rejected before direct argv launch. Direct argv also removes shell interpretation.
- **Hard-link overwrite bypass:** not applicable to atomic rename mutation. Replacing a directory entry does not modify another hard link's inode. Hard links can expose data already readable by the same authorized user, which is within the unrestricted read scope.
- **OSC 52 passes through:** false in the current Node implementation; regression coverage was added.
- **High output necessarily starves heartbeats:** not reproduced. A controlled 64 MiB output command completed normally in about 323 ms and left no process residue. This does not prove every event-loop workload is harmless, but the specific claim was not accepted as a release blocker.
- **Runtime lock blindly follows a swapped symlink:** the existing `wx` exclusive create did not overwrite an existing symlink. T15.3 added explicit `O_NOFOLLOW` for clarity and defense in depth.
- **MCP active-request reaper decrement lacks `finally`:** false. Both initialization and existing-session paths decrement active request counts in `finally` blocks.
- **Only revoke-all is possible:** false at the protocol layer. The OAuth revocation endpoint authenticates the client and revokes an individual access or refresh token; the local dashboard intentionally exposes only the simpler owner-wide revoke-all control.
- **Screenshot names are not chronologically sortable:** false for the implemented order. UTC timestamp precedes tab ID, padded counter, and random suffix; random data resolves collisions only after the chronological prefix.
- **Named credentials require `flock` to be safe:** partial concurrent writes fail stable identity/schema validation and stop the attempt. Spurious failure is acceptable fail-closed behavior; Loom does not modify those credentials.

## Intentional scope tradeoffs

- Quick Tunnel endpoint changes invalidate endpoint-bound OAuth. That inconvenience is intentional and is why Quick Tunnel is non-production.
- The OAuth scope remains one full-tool scope in v1. Adding read-only or per-tool authorization would be a product-scope expansion, not a hidden fix.
- Dynamic registration remains supported by the MCP/OAuth model. Password throttling was added, but the stable hostname must not be treated as secret or as an authentication factor.
- Client revocation remains revoke-all plus authenticated token revocation; a richer client-management UI is outside the approved minimal v1 surface.
- Persistent browser state is a required feature, not an accidental daemon. It is now disclosed as a security consequence.

## Verification summary

Focused hardening suites cover limits, paths, output, watchdog, files, memory, OAuth, MCP, dashboard, browser, terminal, runtime, ProcessManager, and Cloudflare parser behavior. Full typecheck, full tests, build, package inspection, map validation, dossier regeneration, secret scanning, and Loom-owned process-residue scanning are required before the T15.3 commit.

This document does not satisfy G5, G6, T16 external/manual requirements, or G7. No package was published and no public tunnel was deployed.
~~~~~

### Embedded source: `docs/certification-evidence.example.json`

- Bytes: `2751`
- Lines: `90`
- SHA-256: `43145e54b1013e7556304f92cf64676a2b81f546472ed2b7981ec9421c20e32e`

~~~~~json
{
  "g5": {
    "releaseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "host": {
      "platform": "darwin",
      "architecture": "arm64",
      "macosVersion": "15.5",
      "nodeVersion": "v22.17.0"
    },
    "cloudflared": {
      "managed": true,
      "version": "2026.7.0",
      "sha256": "cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04"
    },
    "chromium": {
      "managed": true,
      "revision": "1228",
      "sha256": "b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7"
    },
    "namedTunnel": {
      "registered": true,
      "endpoint": "https://loom.example.com/mcp",
      "stableRestartGenerationPreserved": true,
      "hostnameChangeGenerationIncremented": true,
      "ownerPasswordPreserved": true,
      "noQuickFallback": true,
      "publicAccessTerminated": true
    },
    "processResidue": [],
    "artifacts": [
      {
        "path": "/absolute/path/to/managed-cloudflared",
        "sha256": "cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04"
      },
      {
        "path": "/absolute/path/to/managed-chromium",
        "sha256": "b1b9e2dd063115031f08eadc10ed381ca0fa05b2284baff8f721d87f5f0f61b7"
      },
      {
        "path": "/absolute/path/to/redacted-g5-evidence.txt",
        "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    ]
  },
  "g6": {
    "releaseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "chatGptEligible": true,
    "oauthCompleted": true,
    "unauthorizedRejected": true,
    "revokedCredentialsRejected": true,
    "toolsInvoked": [
      "loom_read",
      "loom_write",
      "loom_edit",
      "loom_terminal",
      "loom_skills",
      "loom_memory",
      "loom_browser"
    ],
    "auditSecretScanPassed": true,
    "publicAccessTerminated": true,
    "processResidue": [],
    "artifacts": [
      {
        "path": "/absolute/path/to/redacted-g6-evidence.txt",
        "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    ]
  },
  "g7": {
    "releaseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "immutableRelease": true,
    "cleanSupportedMacInstall": true,
    "packageSha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "fullGatePassed": true,
    "documentationConsistent": true,
    "publicAccessTerminated": true,
    "processResidue": [],
    "artifacts": [
      {
        "path": "/absolute/path/to/loom-package.tgz",
        "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      },
      {
        "path": "/absolute/path/to/redacted-g7-evidence.txt",
        "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    ]
  }
}
~~~~~

### Embedded source: `package.json`

- Bytes: `1222`
- Lines: `48`
- SHA-256: `696449fde77e8fc4558647b687e268ba682078ca215322adfcbe431f2b5a5fdc`

~~~~~json
{
  "name": "loom-mcp",
  "version": "0.1.0",
  "description": "Foreground-only single-owner remote MCP server for macOS",
  "type": "module",
  "private": true,
  "license": "MIT",
  "engines": {
    "node": ">=22"
  },
  "bin": {
    "loom": "dist/src/cli.js",
    "loom-certify": "dist/src/certification-cli.js"
  },
  "files": [
    "dist/src",
    "public",
    "README.md",
    "LICENSE",
    "NOTICE",
    "docs/OPERATOR.md",
    "docs/SECURITY.md",
    "docs/DEVELOPMENT.md",
    "docs/RELEASE_CERTIFICATION.md",
    "docs/certification-evidence.example.json"
  ],
  "scripts": {
    "clean": "rm -rf dist",
    "build": "npm run clean && tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "npm run build && node --test 'dist/test/**/*.test.js'",
    "start": "node dist/src/cli.js launch",
    "pack": "npm pack",
    "prepack": "npm run build",
    "certify": "npm run build && node dist/src/certification-cli.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0",
    "express": "5.2.1",
    "playwright-core": "1.61.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/express": "5.0.6",
    "@types/node": "26.1.0",
    "typescript": "6.0.3"
  }
}
~~~~~

### Embedded source: `package-lock.json`

- Bytes: `46834`
- Lines: `1319`
- SHA-256: `722002261fc0f37a5ccc7458744d0b1489eaab84c99741d40aabc7a2248732f8`

~~~~~json
{
  "name": "loom-mcp",
  "version": "0.1.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "loom-mcp",
      "version": "0.1.0",
      "license": "MIT",
      "dependencies": {
        "@modelcontextprotocol/sdk": "1.29.0",
        "express": "5.2.1",
        "playwright-core": "1.61.1",
        "zod": "4.4.3"
      },
      "bin": {
        "loom": "dist/src/cli.js"
      },
      "devDependencies": {
        "@types/express": "5.0.6",
        "@types/node": "26.1.0",
        "typescript": "6.0.3"
      },
      "engines": {
        "node": ">=22"
      }
    },
    "node_modules/@hono/node-server": {
      "version": "1.19.14",
      "resolved": "https://registry.npmjs.org/@hono/node-server/-/node-server-1.19.14.tgz",
      "integrity": "sha512-GwtvgtXxnWsucXvbQXkRgqksiH2Qed37H9xHZocE5sA3N8O8O8/8FA3uclQXxXVzc9XBZuEOMK7+r02FmSpHtw==",
      "license": "MIT",
      "engines": {
        "node": ">=18.14.1"
      },
      "peerDependencies": {
        "hono": "^4"
      }
    },
    "node_modules/@modelcontextprotocol/sdk": {
      "version": "1.29.0",
      "resolved": "https://registry.npmjs.org/@modelcontextprotocol/sdk/-/sdk-1.29.0.tgz",
      "integrity": "sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==",
      "license": "MIT",
      "dependencies": {
        "@hono/node-server": "^1.19.9",
        "ajv": "^8.17.1",
        "ajv-formats": "^3.0.1",
        "content-type": "^1.0.5",
        "cors": "^2.8.5",
        "cross-spawn": "^7.0.5",
        "eventsource": "^3.0.2",
        "eventsource-parser": "^3.0.0",
        "express": "^5.2.1",
        "express-rate-limit": "^8.2.1",
        "hono": "^4.11.4",
        "jose": "^6.1.3",
        "json-schema-typed": "^8.0.2",
        "pkce-challenge": "^5.0.0",
        "raw-body": "^3.0.0",
        "zod": "^3.25 || ^4.0",
        "zod-to-json-schema": "^3.25.1"
      },
      "engines": {
        "node": ">=18"
      },
      "peerDependencies": {
        "@cfworker/json-schema": "^4.1.1",
        "zod": "^3.25 || ^4.0"
      },
      "peerDependenciesMeta": {
        "@cfworker/json-schema": {
          "optional": true
        },
        "zod": {
          "optional": false
        }
      }
    },
    "node_modules/@types/body-parser": {
      "version": "1.19.6",
      "resolved": "https://registry.npmjs.org/@types/body-parser/-/body-parser-1.19.6.tgz",
      "integrity": "sha512-HLFeCYgz89uk22N5Qg3dvGvsv46B8GLvKKo1zKG4NybA8U2DiEO3w9lqGg29t/tfLRJpJ6iQxnVw4OnB7MoM9g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/connect": "*",
        "@types/node": "*"
      }
    },
    "node_modules/@types/connect": {
      "version": "3.4.38",
      "resolved": "https://registry.npmjs.org/@types/connect/-/connect-3.4.38.tgz",
      "integrity": "sha512-K6uROf1LD88uDQqJCktA4yzL1YYAK6NgfsI0v/mTgyPKWsX1CnJ0XPSDhViejru1GcRkLWb8RlzFYJRqGUbaug==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/node": "*"
      }
    },
    "node_modules/@types/express": {
      "version": "5.0.6",
      "resolved": "https://registry.npmjs.org/@types/express/-/express-5.0.6.tgz",
      "integrity": "sha512-sKYVuV7Sv9fbPIt/442koC7+IIwK5olP1KWeD88e/idgoJqDm3JV/YUiPwkoKK92ylff2MGxSz1CSjsXelx0YA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/body-parser": "*",
        "@types/express-serve-static-core": "^5.0.0",
        "@types/serve-static": "^2"
      }
    },
    "node_modules/@types/express-serve-static-core": {
      "version": "5.1.2",
      "resolved": "https://registry.npmjs.org/@types/express-serve-static-core/-/express-serve-static-core-5.1.2.tgz",
      "integrity": "sha512-d3KvEXBSo/lOAMc2u6fkyDHBvetBHeqD7wm/AcXfLpSOQwlmG9D/aQ0SFswVjv05p7ullQS7Mjohj6/VdbZuTg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/node": "*",
        "@types/qs": "*",
        "@types/range-parser": "*",
        "@types/send": "*"
      }
    },
    "node_modules/@types/http-errors": {
      "version": "2.0.5",
      "resolved": "https://registry.npmjs.org/@types/http-errors/-/http-errors-2.0.5.tgz",
      "integrity": "sha512-r8Tayk8HJnX0FztbZN7oVqGccWgw98T/0neJphO91KkmOzug1KkofZURD4UaD5uH8AqcFLfdPErnBod0u71/qg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/node": {
      "version": "26.1.0",
      "resolved": "https://registry.npmjs.org/@types/node/-/node-26.1.0.tgz",
      "integrity": "sha512-O0A1G3xPGy4w7AgQdAQYUlQ+BKk2Oovw8eRpofyp5KdBZULnbe+WqaOVNrm705SHphCiG4XHsACrSmPu1f+Kgw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "undici-types": "~8.3.0"
      }
    },
    "node_modules/@types/qs": {
      "version": "6.15.1",
      "resolved": "https://registry.npmjs.org/@types/qs/-/qs-6.15.1.tgz",
      "integrity": "sha512-GZHUBZR9hckSUhrxmp1nG6NwdpM9fCunJwyThLW1X3AyHgd9IlHb6VANpQQqDr2o/qQp6McZ3y/IA2rVzKzSbw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/range-parser": {
      "version": "1.2.7",
      "resolved": "https://registry.npmjs.org/@types/range-parser/-/range-parser-1.2.7.tgz",
      "integrity": "sha512-hKormJbkJqzQGhziax5PItDUTMAM9uE2XXQmM37dyd4hVM+5aVl7oVxMVUiVQn2oCQFN/LKCZdvSM0pFRqbSmQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/send": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/@types/send/-/send-1.2.1.tgz",
      "integrity": "sha512-arsCikDvlU99zl1g69TcAB3mzZPpxgw0UQnaHeC1Nwb015xp8bknZv5rIfri9xTOcMuaVgvabfIRA7PSZVuZIQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/node": "*"
      }
    },
    "node_modules/@types/serve-static": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/@types/serve-static/-/serve-static-2.2.0.tgz",
      "integrity": "sha512-8mam4H1NHLtu7nmtalF7eyBH14QyOASmcxHhSfEoRyr0nP/YdoesEtU+uSRvMe96TW/HPTtkoKqQLl53N7UXMQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/http-errors": "*",
        "@types/node": "*"
      }
    },
    "node_modules/accepts": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/accepts/-/accepts-2.0.0.tgz",
      "integrity": "sha512-5cvg6CtKwfgdmVqY1WIiXKc3Q1bkRqGLi+2W/6ao+6Y7gu/RCwRuAhGEzh5B4KlszSuTLgZYuqFqo5bImjNKng==",
      "license": "MIT",
      "dependencies": {
        "mime-types": "^3.0.0",
        "negotiator": "^1.0.0"
      },
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/ajv": {
      "version": "8.20.0",
      "resolved": "https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz",
      "integrity": "sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==",
      "license": "MIT",
      "dependencies": {
        "fast-deep-equal": "^3.1.3",
        "fast-uri": "^3.0.1",
        "json-schema-traverse": "^1.0.0",
        "require-from-string": "^2.0.2"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/epoberezkin"
      }
    },
    "node_modules/ajv-formats": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/ajv-formats/-/ajv-formats-3.0.1.tgz",
      "integrity": "sha512-8iUql50EUR+uUcdRQ3HDqa6EVyo3docL8g5WJ3FNcWmu62IbkGUue/pEyLBW8VGKKucTPgqeks4fIU1DA4yowQ==",
      "license": "MIT",
      "dependencies": {
        "ajv": "^8.0.0"
      },
      "peerDependencies": {
        "ajv": "^8.0.0"
      },
      "peerDependenciesMeta": {
        "ajv": {
          "optional": true
        }
      }
    },
    "node_modules/body-parser": {
      "version": "2.3.0",
      "resolved": "https://registry.npmjs.org/body-parser/-/body-parser-2.3.0.tgz",
      "integrity": "sha512-2cGmJupaNgg+QUwVLAucDuWuoMZ6EX9iHDRswZ5lsNYEmwPaRknMPCLZz07yTzVq/83p4o/wzbDZbBrTvGGTIw==",
      "license": "MIT",
      "dependencies": {
        "bytes": "^3.1.2",
        "content-type": "^2.0.0",
        "debug": "^4.4.3",
        "http-errors": "^2.0.1",
        "iconv-lite": "^0.7.2",
        "on-finished": "^2.4.1",
        "qs": "^6.15.2",
        "raw-body": "^3.0.2",
        "type-is": "^2.1.0"
      },
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/body-parser/node_modules/content-type": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/content-type/-/content-type-2.0.0.tgz",
      "integrity": "sha512-j/O/d7GcZCyNl7/hwZAb606rzqkyvaDctLmckbxLzHvFBzTJHuGEdodATcP3yIRoDrLHkIATJuvzbFlp/ki2cQ==",
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/bytes": {
      "version": "3.1.2",
      "resolved": "https://registry.npmjs.org/bytes/-/bytes-3.1.2.tgz",
      "integrity": "sha512-/Nf7TyzTx6S3yRJObOAV7956r8cr2+Oj8AC5dt8wSP3BQAoeX58NoHyCU8P8zGkNXStjTSi6fzO6F0pBdcYbEg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/call-bind-apply-helpers": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/call-bind-apply-helpers/-/call-bind-apply-helpers-1.0.2.tgz",
      "integrity": "sha512-Sp1ablJ0ivDkSzjcaJdxEunN5/XvksFJ2sMBFfq6x0ryhQV/2b/KwFe21cMpmHtPOSij8K99/wSfoEuTObmuMQ==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "function-bind": "^1.1.2"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/call-bound": {
      "version": "1.0.4",
      "resolved": "https://registry.npmjs.org/call-bound/-/call-bound-1.0.4.tgz",
      "integrity": "sha512-+ys997U96po4Kx/ABpBCqhA9EuxJaQWDQg7295H4hBphv3IZg0boBKuwYpt4YXp6MZ5AmZQnU/tyMTlRpaSejg==",
      "license": "MIT",
      "dependencies": {
        "call-bind-apply-helpers": "^1.0.2",
        "get-intrinsic": "^1.3.0"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/content-disposition": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/content-disposition/-/content-disposition-1.1.0.tgz",
      "integrity": "sha512-5jRCH9Z/+DRP7rkvY83B+yGIGX96OYdJmzngqnw2SBSxqCFPd0w2km3s5iawpGX8krnwSGmF0FW5Nhr0Hfai3g==",
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/content-type": {
      "version": "1.0.5",
      "resolved": "https://registry.npmjs.org/content-type/-/content-type-1.0.5.tgz",
      "integrity": "sha512-nTjqfcBFEipKdXCv4YDQWCfmcLZKm81ldF0pAopTvyrFGVbcR6P/VAAd5G7N+0tTr8QqiU0tFadD6FK4NtJwOA==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/cookie": {
      "version": "0.7.2",
      "resolved": "https://registry.npmjs.org/cookie/-/cookie-0.7.2.tgz",
      "integrity": "sha512-yki5XnKuf750l50uGTllt6kKILY4nQ1eNIQatoXEByZ5dWgnKqbnqmTrBE5B4N7lrMJKQ2ytWMiTO2o0v6Ew/w==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/cookie-signature": {
      "version": "1.2.2",
      "resolved": "https://registry.npmjs.org/cookie-signature/-/cookie-signature-1.2.2.tgz",
      "integrity": "sha512-D76uU73ulSXrD1UXF4KE2TMxVVwhsnCgfAyTg9k8P6KGZjlXKrOLe4dJQKI3Bxi5wjesZoFXJWElNWBjPZMbhg==",
      "license": "MIT",
      "engines": {
        "node": ">=6.6.0"
      }
    },
    "node_modules/cors": {
      "version": "2.8.6",
      "resolved": "https://registry.npmjs.org/cors/-/cors-2.8.6.tgz",
      "integrity": "sha512-tJtZBBHA6vjIAaF6EnIaq6laBBP9aq/Y3ouVJjEfoHbRBcHBAHYcMh/w8LDrk2PvIMMq8gmopa5D4V8RmbrxGw==",
      "license": "MIT",
      "dependencies": {
        "object-assign": "^4",
        "vary": "^1"
      },
      "engines": {
        "node": ">= 0.10"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/cross-spawn": {
      "version": "7.0.6",
      "resolved": "https://registry.npmjs.org/cross-spawn/-/cross-spawn-7.0.6.tgz",
      "integrity": "sha512-uV2QOWP2nWzsy2aMp8aRibhi9dlzF5Hgh5SHaB9OiTGEyDTiJJyx0uy51QXdyWbtAHNua4XJzUKca3OzKUd3vA==",
      "license": "MIT",
      "dependencies": {
        "path-key": "^3.1.0",
        "shebang-command": "^2.0.0",
        "which": "^2.0.1"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/debug": {
      "version": "4.4.3",
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
      "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
      "license": "MIT",
      "dependencies": {
        "ms": "^2.1.3"
      },
      "engines": {
        "node": ">=6.0"
      },
      "peerDependenciesMeta": {
        "supports-color": {
          "optional": true
        }
      }
    },
    "node_modules/depd": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/depd/-/depd-2.0.0.tgz",
      "integrity": "sha512-g7nH6P6dyDioJogAAGprGpCtVImJhpPk/roCzdb3fIh61/s/nPsfR6onyMwkCAR/OlC3yBC0lESvUoQEAssIrw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/dunder-proto": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/dunder-proto/-/dunder-proto-1.0.1.tgz",
      "integrity": "sha512-KIN/nDJBQRcXw0MLVhZE9iQHmG68qAVIBg9CqmUYjmQIhgij9U5MFvrqkUL5FbtyyzZuOeOt0zdeRe4UY7ct+A==",
      "license": "MIT",
      "dependencies": {
        "call-bind-apply-helpers": "^1.0.1",
        "es-errors": "^1.3.0",
        "gopd": "^1.2.0"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/ee-first": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/ee-first/-/ee-first-1.1.1.tgz",
      "integrity": "sha512-WMwm9LhRUo+WUaRN+vRuETqG89IgZphVSNkdFgeb6sS/E4OrDIN7t48CAewSHXc6C8lefD8KKfr5vY61brQlow==",
      "license": "MIT"
    },
    "node_modules/encodeurl": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/encodeurl/-/encodeurl-2.0.0.tgz",
      "integrity": "sha512-Q0n9HRi4m6JuGIV1eFlmvJB7ZEVxu93IrMyiMsGC0lrMJMWzRgx6WGquyfQgZVb31vhGgXnfmPNNXmxnOkRBrg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/es-define-property": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/es-define-property/-/es-define-property-1.0.1.tgz",
      "integrity": "sha512-e3nRfgfUZ4rNGL232gUgX06QNyyez04KdjFrF+LTRoOXmrOgFKDg4BCdsjW8EnT69eqdYGmRpJwiPVYNrCaW3g==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/es-errors": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/es-errors/-/es-errors-1.3.0.tgz",
      "integrity": "sha512-Zf5H2Kxt2xjTvbJvP2ZWLEICxA6j+hAmMzIlypy4xcBg1vKVnx89Wy0GbS+kf5cwCVFFzdCFh2XSCFNULS6csw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/es-object-atoms": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/es-object-atoms/-/es-object-atoms-1.1.2.tgz",
      "integrity": "sha512-HWcBoN6NileqtSydK2FqHbS/LoDd2pqrnQHLyJzBj4kOp/ky2MWMN694xOfkK8/SnUsW2DH7EfyVlydKCsm1Zw==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/escape-html": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/escape-html/-/escape-html-1.0.3.tgz",
      "integrity": "sha512-NiSupZ4OeuGwr68lGIeym/ksIZMJodUGOSCZ/FSnTxcrekbvqrgdUxlJOMpijaKZVjAJrWrGs/6Jy8OMuyj9ow==",
      "license": "MIT"
    },
    "node_modules/etag": {
      "version": "1.8.1",
      "resolved": "https://registry.npmjs.org/etag/-/etag-1.8.1.tgz",
      "integrity": "sha512-aIL5Fx7mawVa300al2BnEE4iNvo1qETxLrPI/o05L7z6go7fCw1J6EQmbK4FmJ2AS7kgVF/KEZWufBfdClMcPg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/eventsource": {
      "version": "3.0.7",
      "resolved": "https://registry.npmjs.org/eventsource/-/eventsource-3.0.7.tgz",
      "integrity": "sha512-CRT1WTyuQoD771GW56XEZFQ/ZoSfWid1alKGDYMmkt2yl8UXrVR4pspqWNEcqKvVIzg6PAltWjxcSSPrboA4iA==",
      "license": "MIT",
      "dependencies": {
        "eventsource-parser": "^3.0.1"
      },
      "engines": {
        "node": ">=18.0.0"
      }
    },
    "node_modules/eventsource-parser": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/eventsource-parser/-/eventsource-parser-3.1.0.tgz",
      "integrity": "sha512-kJezFj9YFAMLeORyi7aCLxLbD5/qWMQnoMVlVPyHIll7lgRJCc3JVln9Vgl9nwQi0YkMnhdGTMNn7CkRRAptMg==",
      "license": "MIT",
      "engines": {
        "node": ">=18.0.0"
      }
    },
    "node_modules/express": {
      "version": "5.2.1",
      "resolved": "https://registry.npmjs.org/express/-/express-5.2.1.tgz",
      "integrity": "sha512-hIS4idWWai69NezIdRt2xFVofaF4j+6INOpJlVOLDO8zXGpUVEVzIYk12UUi2JzjEzWL3IOAxcTubgz9Po0yXw==",
      "license": "MIT",
      "dependencies": {
        "accepts": "^2.0.0",
        "body-parser": "^2.2.1",
        "content-disposition": "^1.0.0",
        "content-type": "^1.0.5",
        "cookie": "^0.7.1",
        "cookie-signature": "^1.2.1",
        "debug": "^4.4.0",
        "depd": "^2.0.0",
        "encodeurl": "^2.0.0",
        "escape-html": "^1.0.3",
        "etag": "^1.8.1",
        "finalhandler": "^2.1.0",
        "fresh": "^2.0.0",
        "http-errors": "^2.0.0",
        "merge-descriptors": "^2.0.0",
        "mime-types": "^3.0.0",
        "on-finished": "^2.4.1",
        "once": "^1.4.0",
        "parseurl": "^1.3.3",
        "proxy-addr": "^2.0.7",
        "qs": "^6.14.0",
        "range-parser": "^1.2.1",
        "router": "^2.2.0",
        "send": "^1.1.0",
        "serve-static": "^2.2.0",
        "statuses": "^2.0.1",
        "type-is": "^2.0.1",
        "vary": "^1.1.2"
      },
      "engines": {
        "node": ">= 18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/express-rate-limit": {
      "version": "8.5.2",
      "resolved": "https://registry.npmjs.org/express-rate-limit/-/express-rate-limit-8.5.2.tgz",
      "integrity": "sha512-5Kb34ipNX694DH48vN9irak1Qx30nb0PLYHXfJgw4YEjiC3ZEmZJhwOp+VfiCYwFzvFTdB9QkArYS5kXa2cx2A==",
      "license": "MIT",
      "dependencies": {
        "ip-address": "^10.2.0"
      },
      "engines": {
        "node": ">= 16"
      },
      "funding": {
        "url": "https://github.com/sponsors/express-rate-limit"
      },
      "peerDependencies": {
        "express": ">= 4.11"
      }
    },
    "node_modules/fast-deep-equal": {
      "version": "3.1.3",
      "resolved": "https://registry.npmjs.org/fast-deep-equal/-/fast-deep-equal-3.1.3.tgz",
      "integrity": "sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==",
      "license": "MIT"
    },
    "node_modules/fast-uri": {
      "version": "3.1.3",
      "resolved": "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.3.tgz",
      "integrity": "sha512-i70LwGWUduXqzicKXWshooq+sWL1K3WUU5rKZNG/0i3a1OSoX3HqhH5WbWwTmqWfor4urUakGPiRQcleRZTwOg==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "BSD-3-Clause"
    },
    "node_modules/finalhandler": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/finalhandler/-/finalhandler-2.1.1.tgz",
      "integrity": "sha512-S8KoZgRZN+a5rNwqTxlZZePjT/4cnm0ROV70LedRHZ0p8u9fRID0hJUZQpkKLzro8LfmC8sx23bY6tVNxv8pQA==",
      "license": "MIT",
      "dependencies": {
        "debug": "^4.4.0",
        "encodeurl": "^2.0.0",
        "escape-html": "^1.0.3",
        "on-finished": "^2.4.1",
        "parseurl": "^1.3.3",
        "statuses": "^2.0.1"
      },
      "engines": {
        "node": ">= 18.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/forwarded": {
      "version": "0.2.0",
      "resolved": "https://registry.npmjs.org/forwarded/-/forwarded-0.2.0.tgz",
      "integrity": "sha512-buRG0fpBtRHSTCOASe6hD258tEubFoRLb4ZNA6NxMVHNw2gOcwHo9wyablzMzOA5z9xA9L1KNjk/Nt6MT9aYow==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/fresh": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/fresh/-/fresh-2.0.0.tgz",
      "integrity": "sha512-Rx/WycZ60HOaqLKAi6cHRKKI7zxWbJ31MhntmtwMoaTeF7XFH9hhBp8vITaMidfljRQ6eYWCKkaTK+ykVJHP2A==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/function-bind": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/function-bind/-/function-bind-1.1.2.tgz",
      "integrity": "sha512-7XHNxH7qX9xG5mIwxkhumTox/MIRNcOgDrxWsMt2pAr23WHp6MrRlN7FBSFpCpr+oVO0F744iUgR82nJMfG2SA==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/get-intrinsic": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/get-intrinsic/-/get-intrinsic-1.3.0.tgz",
      "integrity": "sha512-9fSjSaos/fRIVIp+xSJlE6lfwhES7LNtKaCBIamHsjr2na1BiABJPo0mOjjz8GJDURarmCPGqaiVg5mfjb98CQ==",
      "license": "MIT",
      "dependencies": {
        "call-bind-apply-helpers": "^1.0.2",
        "es-define-property": "^1.0.1",
        "es-errors": "^1.3.0",
        "es-object-atoms": "^1.1.1",
        "function-bind": "^1.1.2",
        "get-proto": "^1.0.1",
        "gopd": "^1.2.0",
        "has-symbols": "^1.1.0",
        "hasown": "^2.0.2",
        "math-intrinsics": "^1.1.0"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/get-proto": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/get-proto/-/get-proto-1.0.1.tgz",
      "integrity": "sha512-sTSfBjoXBp89JvIKIefqw7U2CCebsc74kiY6awiGogKtoSGbgjYE/G/+l9sF3MWFPNc9IcoOC4ODfKHfxFmp0g==",
      "license": "MIT",
      "dependencies": {
        "dunder-proto": "^1.0.1",
        "es-object-atoms": "^1.0.0"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/gopd": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/gopd/-/gopd-1.2.0.tgz",
      "integrity": "sha512-ZUKRh6/kUFoAiTAtTYPZJ3hw9wNxx+BIBOijnlG9PnrJsCcSjs1wyyD6vJpaYtgnzDrKYRSqf3OO6Rfa93xsRg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/has-symbols": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/has-symbols/-/has-symbols-1.1.0.tgz",
      "integrity": "sha512-1cDNdwJ2Jaohmb3sg4OmKaMBwuC48sYni5HUw2DvsC8LjGTLK9h+eb1X6RyuOHe4hT0ULCW68iomhjUoKUqlPQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/hasown": {
      "version": "2.0.4",
      "resolved": "https://registry.npmjs.org/hasown/-/hasown-2.0.4.tgz",
      "integrity": "sha512-T2UbfbBEF32wiepXIsMlTW9+dDYC6wMh/t/vYA4tuOMKqWz/n3vr1NFSxQiyP+zk2mXsoMA/i/7qV6LKut1t1A==",
      "license": "MIT",
      "dependencies": {
        "function-bind": "^1.1.2"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/hono": {
      "version": "4.12.28",
      "resolved": "https://registry.npmjs.org/hono/-/hono-4.12.28.tgz",
      "integrity": "sha512-YwUvVpSF7m1yOblFPrU3Hbo8XhPheBoiyfGuII6z19LnOr6JpDnyyp7LFNrfV56wS8tpvtBFGRISHN02pDdLOA==",
      "license": "MIT",
      "engines": {
        "node": ">=16.9.0"
      }
    },
    "node_modules/http-errors": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/http-errors/-/http-errors-2.0.1.tgz",
      "integrity": "sha512-4FbRdAX+bSdmo4AUFuS0WNiPz8NgFt+r8ThgNWmlrjQjt1Q7ZR9+zTlce2859x4KSXrwIsaeTqDoKQmtP8pLmQ==",
      "license": "MIT",
      "dependencies": {
        "depd": "~2.0.0",
        "inherits": "~2.0.4",
        "setprototypeof": "~1.2.0",
        "statuses": "~2.0.2",
        "toidentifier": "~1.0.1"
      },
      "engines": {
        "node": ">= 0.8"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/iconv-lite": {
      "version": "0.7.3",
      "resolved": "https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.7.3.tgz",
      "integrity": "sha512-IKXpvIzjnC9XTAUbVBcMfGS0EPaIXtW6v+zr+RRp+hqULEpo0owZax6wyRwPOJbWbzjYspQwusTsfVr0ifh4uQ==",
      "license": "MIT",
      "dependencies": {
        "safer-buffer": ">= 2.1.2 < 3.0.0"
      },
      "engines": {
        "node": ">=0.10.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/inherits": {
      "version": "2.0.4",
      "resolved": "https://registry.npmjs.org/inherits/-/inherits-2.0.4.tgz",
      "integrity": "sha512-k/vGaX4/Yla3WzyMCvTQOXYeIHvqOKtnqBduzTHpzpQZzAskKMhZ2K+EnBiSM9zGSoIFeMpXKxa4dYeZIQqewQ==",
      "license": "ISC"
    },
    "node_modules/ip-address": {
      "version": "10.2.0",
      "resolved": "https://registry.npmjs.org/ip-address/-/ip-address-10.2.0.tgz",
      "integrity": "sha512-/+S6j4E9AHvW9SWMSEY9Xfy66O5PWvVEJ08O0y5JGyEKQpojb0K0GKpz/v5HJ/G0vi3D2sjGK78119oXZeE0qA==",
      "license": "MIT",
      "engines": {
        "node": ">= 12"
      }
    },
    "node_modules/ipaddr.js": {
      "version": "1.9.1",
      "resolved": "https://registry.npmjs.org/ipaddr.js/-/ipaddr.js-1.9.1.tgz",
      "integrity": "sha512-0KI/607xoxSToH7GjN1FfSbLoU0+btTicjsQSWQlh/hZykN8KpmMf7uYwPW3R+akZ6R/w18ZlXSHBYXiYUPO3g==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.10"
      }
    },
    "node_modules/is-promise": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/is-promise/-/is-promise-4.0.0.tgz",
      "integrity": "sha512-hvpoI6korhJMnej285dSg6nu1+e6uxs7zG3BYAm5byqDsgJNWwxzM6z6iZiAgQR4TJ30JmBTOwqZUw3WlyH3AQ==",
      "license": "MIT"
    },
    "node_modules/isexe": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/isexe/-/isexe-2.0.0.tgz",
      "integrity": "sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==",
      "license": "ISC"
    },
    "node_modules/jose": {
      "version": "6.2.3",
      "resolved": "https://registry.npmjs.org/jose/-/jose-6.2.3.tgz",
      "integrity": "sha512-YYVDInQKFJfR/xa3ojUTl8c2KoTwiL1R5Wg9YCydwH0x0B9grbzlg5HC7mMjCtUJjbQ/YnGEZIhI5tCgfTb4Hw==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/panva"
      }
    },
    "node_modules/json-schema-traverse": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/json-schema-traverse/-/json-schema-traverse-1.0.0.tgz",
      "integrity": "sha512-NM8/P9n3XjXhIZn1lLhkFaACTOURQXjWhV4BA/RnOv8xvgqtqpAX9IO4mRQxSx1Rlo4tqzeqb0sOlruaOy3dug==",
      "license": "MIT"
    },
    "node_modules/json-schema-typed": {
      "version": "8.0.2",
      "resolved": "https://registry.npmjs.org/json-schema-typed/-/json-schema-typed-8.0.2.tgz",
      "integrity": "sha512-fQhoXdcvc3V28x7C7BMs4P5+kNlgUURe2jmUT1T//oBRMDrqy1QPelJimwZGo7Hg9VPV3EQV5Bnq4hbFy2vetA==",
      "license": "BSD-2-Clause"
    },
    "node_modules/math-intrinsics": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/math-intrinsics/-/math-intrinsics-1.1.0.tgz",
      "integrity": "sha512-/IXtbwEk5HTPyEwyKX6hGkYXxM9nbj64B+ilVJnC/R6B0pH5G4V3b0pVbL7DBj4tkhBAppbQUlf6F6Xl9LHu1g==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/media-typer": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/media-typer/-/media-typer-1.1.0.tgz",
      "integrity": "sha512-aisnrDP4GNe06UcKFnV5bfMNPBUw4jsLGaWwWfnH3v02GnBuXX2MCVn5RbrWo0j3pczUilYblq7fQ7Nw2t5XKw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/merge-descriptors": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/merge-descriptors/-/merge-descriptors-2.0.0.tgz",
      "integrity": "sha512-Snk314V5ayFLhp3fkUREub6WtjBfPdCPY1Ln8/8munuLuiYhsABgBVWsozAG+MWMbVEvcdcpbi9R7ww22l9Q3g==",
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/mime-db": {
      "version": "1.54.0",
      "resolved": "https://registry.npmjs.org/mime-db/-/mime-db-1.54.0.tgz",
      "integrity": "sha512-aU5EJuIN2WDemCcAp2vFBfp/m4EAhWJnUNSSw0ixs7/kXbd6Pg64EmwJkNdFhB8aWt1sH2CTXrLxo/iAGV3oPQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/mime-types": {
      "version": "3.0.2",
      "resolved": "https://registry.npmjs.org/mime-types/-/mime-types-3.0.2.tgz",
      "integrity": "sha512-Lbgzdk0h4juoQ9fCKXW4by0UJqj+nOOrI9MJ1sSj4nI8aI2eo1qmvQEie4VD1glsS250n15LsWsYtCugiStS5A==",
      "license": "MIT",
      "dependencies": {
        "mime-db": "^1.54.0"
      },
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/ms": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "license": "MIT"
    },
    "node_modules/negotiator": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/negotiator/-/negotiator-1.0.0.tgz",
      "integrity": "sha512-8Ofs/AUQh8MaEcrlq5xOX0CQ9ypTF5dl78mjlMNfOK08fzpgTHQRQPBxcPlEtIw0yRpws+Zo/3r+5WRby7u3Gg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/object-assign": {
      "version": "4.1.1",
      "resolved": "https://registry.npmjs.org/object-assign/-/object-assign-4.1.1.tgz",
      "integrity": "sha512-rJgTQnkUnH1sFw8yT6VSU3zD3sWmu6sZhIseY8VX+GRu3P6F7Fu+JNDoXfklElbLJSnc3FUQHVe4cU5hj+BcUg==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/object-inspect": {
      "version": "1.13.4",
      "resolved": "https://registry.npmjs.org/object-inspect/-/object-inspect-1.13.4.tgz",
      "integrity": "sha512-W67iLl4J2EXEGTbfeHCffrjDfitvLANg0UlX3wFUUSTx92KXRFegMHUVgSqE+wvhAbi4WqjGg9czysTV2Epbew==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/on-finished": {
      "version": "2.4.1",
      "resolved": "https://registry.npmjs.org/on-finished/-/on-finished-2.4.1.tgz",
      "integrity": "sha512-oVlzkg3ENAhCk2zdv7IJwd/QUD4z2RxRwpkcGY8psCVcCYZNq4wYnVWALHM+brtuJjePWiYF/ClmuDr8Ch5+kg==",
      "license": "MIT",
      "dependencies": {
        "ee-first": "1.1.1"
      },
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/once": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/once/-/once-1.4.0.tgz",
      "integrity": "sha512-lNaJgI+2Q5URQBkccEKHTQOPaXdUxnZZElQTZY0MFUAuaEqe1E+Nyvgdz/aIyNi6Z9MzO5dv1H8n58/GELp3+w==",
      "license": "ISC",
      "dependencies": {
        "wrappy": "1"
      }
    },
    "node_modules/parseurl": {
      "version": "1.3.3",
      "resolved": "https://registry.npmjs.org/parseurl/-/parseurl-1.3.3.tgz",
      "integrity": "sha512-CiyeOxFT/JZyN5m0z9PfXw4SCBJ6Sygz1Dpl0wqjlhDEGGBP1GnsUVEL0p63hoG1fcj3fHynXi9NYO4nWOL+qQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/path-key": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/path-key/-/path-key-3.1.1.tgz",
      "integrity": "sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==",
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/path-to-regexp": {
      "version": "8.4.2",
      "resolved": "https://registry.npmjs.org/path-to-regexp/-/path-to-regexp-8.4.2.tgz",
      "integrity": "sha512-qRcuIdP69NPm4qbACK+aDogI5CBDMi1jKe0ry5rSQJz8JVLsC7jV8XpiJjGRLLol3N+R5ihGYcrPLTno6pAdBA==",
      "license": "MIT",
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/pkce-challenge": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/pkce-challenge/-/pkce-challenge-5.0.1.tgz",
      "integrity": "sha512-wQ0b/W4Fr01qtpHlqSqspcj3EhBvimsdh0KlHhH8HRZnMsEa0ea2fTULOXOS9ccQr3om+GcGRk4e+isrZWV8qQ==",
      "license": "MIT",
      "engines": {
        "node": ">=16.20.0"
      }
    },
    "node_modules/playwright-core": {
      "version": "1.61.1",
      "resolved": "https://registry.npmjs.org/playwright-core/-/playwright-core-1.61.1.tgz",
      "integrity": "sha512-h7Qlt6m4REp25qvIdvbDtVmD4LqVXfpRxhORv9L0jzETM05p4fuPJ3dKyuSXQxDSbXnmS79HAgi9589lGSpLkg==",
      "license": "Apache-2.0",
      "bin": {
        "playwright-core": "cli.js"
      },
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/proxy-addr": {
      "version": "2.0.7",
      "resolved": "https://registry.npmjs.org/proxy-addr/-/proxy-addr-2.0.7.tgz",
      "integrity": "sha512-llQsMLSUDUPT44jdrU/O37qlnifitDP+ZwrmmZcoSKyLKvtZxpyV0n2/bD/N4tBAAZ/gJEdZU7KMraoK1+XYAg==",
      "license": "MIT",
      "dependencies": {
        "forwarded": "0.2.0",
        "ipaddr.js": "1.9.1"
      },
      "engines": {
        "node": ">= 0.10"
      }
    },
    "node_modules/qs": {
      "version": "6.15.3",
      "resolved": "https://registry.npmjs.org/qs/-/qs-6.15.3.tgz",
      "integrity": "sha512-O9gl3zCl5h5blw1KGUzQKhA5oUXSl8rwUIM5o0S3nCXMliSvy5Dzx7/DJcI+SwgICv+IneSZwhBh1oSyEHA71A==",
      "license": "BSD-3-Clause",
      "dependencies": {
        "es-define-property": "^1.0.1",
        "side-channel": "^1.1.1"
      },
      "engines": {
        "node": ">=0.6"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/range-parser": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/range-parser/-/range-parser-1.3.0.tgz",
      "integrity": "sha512-hek2mFQpPuI4E1BBKrSto+BU3e3x4xuarsbiwr3+lf7p44juvFMV0XFWQAP3xUyqXA4RrXLIoaSUGbSt056ZMw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/raw-body": {
      "version": "3.0.2",
      "resolved": "https://registry.npmjs.org/raw-body/-/raw-body-3.0.2.tgz",
      "integrity": "sha512-K5zQjDllxWkf7Z5xJdV0/B0WTNqx6vxG70zJE4N0kBs4LovmEYWJzQGxC9bS9RAKu3bgM40lrd5zoLJ12MQ5BA==",
      "license": "MIT",
      "dependencies": {
        "bytes": "~3.1.2",
        "http-errors": "~2.0.1",
        "iconv-lite": "~0.7.0",
        "unpipe": "~1.0.0"
      },
      "engines": {
        "node": ">= 0.10"
      }
    },
    "node_modules/require-from-string": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/require-from-string/-/require-from-string-2.0.2.tgz",
      "integrity": "sha512-Xf0nWe6RseziFMu+Ap9biiUbmplq6S9/p+7w7YXP/JBHhrUDDUhwa+vANyubuqfZWTveU//DYVGsDG7RKL/vEw==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/router": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/router/-/router-2.2.0.tgz",
      "integrity": "sha512-nLTrUKm2UyiL7rlhapu/Zl45FwNgkZGaCpZbIHajDYgwlJCOzLSk+cIPAnsEqV955GjILJnKbdQC1nVPz+gAYQ==",
      "license": "MIT",
      "dependencies": {
        "debug": "^4.4.0",
        "depd": "^2.0.0",
        "is-promise": "^4.0.0",
        "parseurl": "^1.3.3",
        "path-to-regexp": "^8.0.0"
      },
      "engines": {
        "node": ">= 18"
      }
    },
    "node_modules/safer-buffer": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/safer-buffer/-/safer-buffer-2.1.2.tgz",
      "integrity": "sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1XXXevb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg==",
      "license": "MIT"
    },
    "node_modules/send": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/send/-/send-1.2.1.tgz",
      "integrity": "sha512-1gnZf7DFcoIcajTjTwjwuDjzuz4PPcY2StKPlsGAQ1+YH20IRVrBaXSWmdjowTJ6u8Rc01PoYOGHXfP1mYcZNQ==",
      "license": "MIT",
      "dependencies": {
        "debug": "^4.4.3",
        "encodeurl": "^2.0.0",
        "escape-html": "^1.0.3",
        "etag": "^1.8.1",
        "fresh": "^2.0.0",
        "http-errors": "^2.0.1",
        "mime-types": "^3.0.2",
        "ms": "^2.1.3",
        "on-finished": "^2.4.1",
        "range-parser": "^1.2.1",
        "statuses": "^2.0.2"
      },
      "engines": {
        "node": ">= 18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/serve-static": {
      "version": "2.2.1",
      "resolved": "https://registry.npmjs.org/serve-static/-/serve-static-2.2.1.tgz",
      "integrity": "sha512-xRXBn0pPqQTVQiC8wyQrKs2MOlX24zQ0POGaj0kultvoOCstBQM5yvOhAVSUwOMjQtTvsPWoNCHfPGwaaQJhTw==",
      "license": "MIT",
      "dependencies": {
        "encodeurl": "^2.0.0",
        "escape-html": "^1.0.3",
        "parseurl": "^1.3.3",
        "send": "^1.2.0"
      },
      "engines": {
        "node": ">= 18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/setprototypeof": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/setprototypeof/-/setprototypeof-1.2.0.tgz",
      "integrity": "sha512-E5LDX7Wrp85Kil5bhZv46j8jOeboKq5JMmYM3gVGdGH8xFpPWXUMsNrlODCrkoxMEeNi/XZIwuRvY4XNwYMJpw==",
      "license": "ISC"
    },
    "node_modules/shebang-command": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/shebang-command/-/shebang-command-2.0.0.tgz",
      "integrity": "sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==",
      "license": "MIT",
      "dependencies": {
        "shebang-regex": "^3.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/shebang-regex": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/shebang-regex/-/shebang-regex-3.0.0.tgz",
      "integrity": "sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==",
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/side-channel": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/side-channel/-/side-channel-1.1.1.tgz",
      "integrity": "sha512-6x6dK6zJdpTzF4sQeNYxwtvBzf6Eg4GtlesS94HOvTudUeyK2WXAaIfmDgsyslYrRBeFIlsi54AYsFGUuhmvrQ==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "object-inspect": "^1.13.4",
        "side-channel-list": "^1.0.1",
        "side-channel-map": "^1.0.1",
        "side-channel-weakmap": "^1.0.2"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/side-channel-list": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/side-channel-list/-/side-channel-list-1.0.1.tgz",
      "integrity": "sha512-mjn/0bi/oUURjc5Xl7IaWi/OJJJumuoJFQJfDDyO46+hBWsfaVM65TBHq2eoZBhzl9EchxOijpkbRC8SVBQU0w==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "object-inspect": "^1.13.4"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/side-channel-map": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/side-channel-map/-/side-channel-map-1.0.1.tgz",
      "integrity": "sha512-VCjCNfgMsby3tTdo02nbjtM/ewra6jPHmpThenkTYh8pG9ucZ/1P8So4u4FGBek/BjpOVsDCMoLA/iuBKIFXRA==",
      "license": "MIT",
      "dependencies": {
        "call-bound": "^1.0.2",
        "es-errors": "^1.3.0",
        "get-intrinsic": "^1.2.5",
        "object-inspect": "^1.13.3"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/side-channel-weakmap": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/side-channel-weakmap/-/side-channel-weakmap-1.0.2.tgz",
      "integrity": "sha512-WPS/HvHQTYnHisLo9McqBHOJk2FkHO/tlpvldyrnem4aeQp4hai3gythswg6p01oSoTl58rcpiFAjF2br2Ak2A==",
      "license": "MIT",
      "dependencies": {
        "call-bound": "^1.0.2",
        "es-errors": "^1.3.0",
        "get-intrinsic": "^1.2.5",
        "object-inspect": "^1.13.3",
        "side-channel-map": "^1.0.1"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/statuses": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/statuses/-/statuses-2.0.2.tgz",
      "integrity": "sha512-DvEy55V3DB7uknRo+4iOGT5fP1slR8wQohVdknigZPMpMstaKJQWhwiYBACJE3Ul2pTnATihhBYnRhZQHGBiRw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/toidentifier": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/toidentifier/-/toidentifier-1.0.1.tgz",
      "integrity": "sha512-o5sSPKEkg/DIQNmH43V0/uerLrpzVedkUh8tGNvaeXpfpuwjKenlSox/2O/BTlZUtEe+JG7s5YhEz608PlAHRA==",
      "license": "MIT",
      "engines": {
        "node": ">=0.6"
      }
    },
    "node_modules/type-is": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/type-is/-/type-is-2.1.0.tgz",
      "integrity": "sha512-faYHw0anBbc/kWF3zFTEnxSFOAGUX9GFbOBthvDdLsIlEoWOFOtS0zgCiQYwIskL9iGXZL3kAXD8OoZ4GmMATA==",
      "license": "MIT",
      "dependencies": {
        "content-type": "^2.0.0",
        "media-typer": "^1.1.0",
        "mime-types": "^3.0.0"
      },
      "engines": {
        "node": ">= 18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/type-is/node_modules/content-type": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/content-type/-/content-type-2.0.0.tgz",
      "integrity": "sha512-j/O/d7GcZCyNl7/hwZAb606rzqkyvaDctLmckbxLzHvFBzTJHuGEdodATcP3yIRoDrLHkIATJuvzbFlp/ki2cQ==",
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/typescript": {
      "version": "6.0.3",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz",
      "integrity": "sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=14.17"
      }
    },
    "node_modules/undici-types": {
      "version": "8.3.0",
      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-8.3.0.tgz",
      "integrity": "sha512-j375ScV60dom+YkPFIfTLcOiPxkN/buHz5GobjLhixFuANaNs3C9l4GmrWqejgXWJ7BbJcFYpTEUkS1Ge8bpZQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/unpipe": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/unpipe/-/unpipe-1.0.0.tgz",
      "integrity": "sha512-pjy2bYhSsufwWlKwPc+l3cN7+wuJlK6uz0YdJEOlQDbl6jo/YlPi4mb8agUkVC8BF7V8NuzeyPNqRksA3hztKQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/vary": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/vary/-/vary-1.1.2.tgz",
      "integrity": "sha512-BNGbWLfd0eUPabhkXUVm0j8uuvREyTh5ovRa/dyow/BqAbZJyC+5fU+IzQOzmAKzYqYRAISoRhdQr3eIZ/PXqg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/which": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/which/-/which-2.0.2.tgz",
      "integrity": "sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==",
      "license": "ISC",
      "dependencies": {
        "isexe": "^2.0.0"
      },
      "bin": {
        "node-which": "bin/node-which"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/wrappy": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/wrappy/-/wrappy-1.0.2.tgz",
      "integrity": "sha512-l4Sp/DRseor9wL6EvV2+TuQn63dMkPjZ/sp9XkghTEbV9KlPS1xUsZ3u7/IQO4wxtcFB4bgpQPRcR3QCvezPcQ==",
      "license": "ISC"
    },
    "node_modules/zod": {
      "version": "4.4.3",
      "resolved": "https://registry.npmjs.org/zod/-/zod-4.4.3.tgz",
      "integrity": "sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/colinhacks"
      }
    },
    "node_modules/zod-to-json-schema": {
      "version": "3.25.2",
      "resolved": "https://registry.npmjs.org/zod-to-json-schema/-/zod-to-json-schema-3.25.2.tgz",
      "integrity": "sha512-O/PgfnpT1xKSDeQYSCfRI5Gy3hPf91mKVDuYLUHZJMiDFptvP41MSnWofm8dnCm0256ZNfZIM7DSzuSMAFnjHA==",
      "license": "ISC",
      "peerDependencies": {
        "zod": "^3.25.28 || ^4"
      }
    }
  }
}
~~~~~

### Embedded source: `tsconfig.json`

- Bytes: `513`
- Lines: `20`
- SHA-256: `5777b2839bf300397f84e5e85fc12743a362b47b64f43659964b1ef1137e9897`

~~~~~json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
~~~~~

### Embedded source: `LICENSE`

- Bytes: `1071`
- Lines: `21`
- SHA-256: `2d69eab09385ed19112c2338c5e1ab27d5f4dbff3a04569df38201e03c2cd26a`

~~~~~text
MIT License

Copyright (c) 2026 Aashutosh Vyas

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~~

### Embedded source: `NOTICE`

- Bytes: `1103`
- Lines: `19`
- SHA-256: `406e2befe8ef0d8493f4309922e7303b2ef030074b91a300e551aa3b9f37666d`

~~~~~text
Loom
Copyright (c) 2026 Aashutosh Vyas

Loom is licensed under the MIT License. See LICENSE.

This distribution includes or depends on third-party open-source software, including:

- @modelcontextprotocol/sdk, licensed by its respective contributors
- Express, licensed under the MIT License
- Zod, licensed under the MIT License
- Playwright Core, licensed under the Apache License 2.0

The exact dependency graph and versions are recorded in package-lock.json. Each third-party component remains subject to its own license and notices.

Loom can explicitly download a pinned Chromium build from the official Playwright distribution service. Chromium is a separate third-party work and is not relicensed by Loom.

Loom can explicitly download a pinned Cloudflared binary from official Cloudflare release hosting. Cloudflared is a separate third-party work and is not relicensed by Loom.

Cloudflare, Chromium, Chrome, Playwright, ChatGPT, and OpenAI are trademarks or product names of their respective owners. Their inclusion in documentation does not imply endorsement, affiliation, or certification.
~~~~~

### Embedded source: `.gitignore`

- Bytes: `66`
- Lines: `6`
- SHA-256: `844fc62152e4f94e2438711eedd8f2c37b1e99999adbc408451a9b3bc521e055`

~~~~~text
node_modules/
dist/
*.tgz
.DS_Store
coverage/
skill-observations/
~~~~~

## Dossier assembly note

The narrative portion was authored against the implementation and governance state. The ledger, path/hash table, source/export index, test-name inventory, and embedded document snapshots were generated from repository files. Final verification and the dossier’s resulting line count, byte count, and SHA-256 are recorded outside the self-referential body in the T15.2 commit evidence and chat handoff.
