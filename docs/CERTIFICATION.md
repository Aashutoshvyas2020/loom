# Loom Certification Guide

Loom's deterministic tests do not certify production. Certification requires recorded evidence from the exact release commit on the supported macOS host and eligible external accounts.

The canonical plan defines the authoritative gate wording. This guide describes the evidence operators must retain for G4, G5, G6, and G7.

## G4 — Integrated local runtime

From a clean checkout and private temporary or real state root:

- Run typecheck, every test, and build.
- Start the concrete foreground runtime with all seven dispatchers.
- Verify local MCP and dashboard bind only to loopback.
- Exercise file read/write/edit, `loom_terminal`, skill listing/reading, memory, and browser behavior.
- Confirm missing browser state degrades to `Browser: unavailable` without disabling the connector.
- Test normal stop, startup failure, SIGINT/SIGTERM, stop during startup, absolute shutdown deadline, replaced `current.json`, replaced `loom.lock`, and audit failure.
- Retain a delayed process-residue scan proving zero wrapper, target, and grandchild processes.

## G5 — Real managed components and tunnel

On the supported Mac:

- Install or verify the pinned Chromium and managed Cloudflared release from the exact build.
- Run a real Quick Tunnel and record that it is labeled non-production.
- Run a real named tunnel using current private certificate and credential files.
- Record the exact stable public `/mcp` endpoint, registration evidence, and no Quick fallback.
- Restart the same named endpoint and prove OAuth generation is unchanged.
- Change the endpoint in a controlled test and prove OAuth generation changes while the owner password remains valid.
- Stop Loom and prove public access is gone, the tunnel process group is gone, and ownership files are removed only after cleanup.

A real named tunnel is mandatory for stable-path certification. Simulated Cloudflared output is not G5 evidence.

## G6 — ChatGPT OAuth and tool use

Using an eligible ChatGPT account or workspace and the current official custom MCP/app connector flow:

- Add the exact HTTPS endpoint ending in `/mcp`.
- Complete OAuth against Loom and record the endpoint/hostname used.
- Verify unauthorized requests fail and revoked credentials stop working.
- Invoke every tool from ChatGPT, including `loom_terminal` and `loom_browser` when browser support is available.
- For mutating tools, correlate the action with secret-minimized audit start/finish records.
- Verify command text, environment values, terminal output, owner password, OAuth secrets, tunnel credentials, and file contents are absent from audit.
- Stop Loom and prove ChatGPT can no longer reach the MCP endpoint.

Do not paste the owner password into the conversation or certification notes. Evidence should show success/failure and redacted identifiers, not credentials.

## G7 — Release evidence and supportability

Before a release candidate is called certified:

- The release commit is clean, tagged or otherwise immutable, and the exact SHA is recorded.
- `SPEC.md`, canonical plan, `CHANGELOG.md`, `REPO_MAP.md`, `HANDOFF.md`, README, operator guide, security model, development guide, and this certification guide agree.
- Dependency lockfile and built package contents are inspected.
- Install from the produced package on a clean supported Mac, not only from the working tree.
- Repeat the full deterministic gate and the required real G5/G6 flows.
- Retain timestamps, commands, redacted logs, endpoint status, OAuth/tool results, process residue, and public access termination evidence.
- Record every skipped or unavailable check as a blocker, not a pass.

## Evidence template

For each check record:

```text
Gate/check:
Release SHA:
Host/macOS/architecture:
Date and timezone:
Exact command or UI action:
Expected result:
Actual result:
Evidence location:
Secrets redacted:
Cleanup verification:
Pass/fail/blocker:
```

A deterministic suite, mocked tunnel, unavailable external reviewer, or untested ChatGPT account must never be converted into a production claim. Public access and process residue must be checked after every real failure and shutdown path.
