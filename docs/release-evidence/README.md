# Loom Release Evidence Index

This directory indexes sanitized evidence for release gates. It must never contain owner passwords, OAuth tokens, Cloudflare API tokens, tunnel secrets, authorization headers, browser typed secrets, or private file content.

## Deterministic local evidence

Current local implementation evidence is recorded in `CHANGELOG.md` and `HANDOFF.md` for each task. T14 records the integrated runtime and stress gates. T15/T15.1 record the 204-test full suite, fail-closed certification boundary, 90-file public-only package, clean-prefix installation, installed CLI behavior, and empty delayed Loom-owned process scan.

- `t15-local-package.md` — candidate tarball hash, environment, package contents, clean-prefix install, installed executable checks, and fail-closed launch evidence.

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
