<p align="center">
  <img src="docs/assets/loom-logo.png" alt="Loom" width="140">
</p>

<h1 align="center">Loom</h1>

<p align="center">A secure local MCP runtime for ChatGPT and OpenAI-compatible clients.</p>

Loom exposes exactly seven bounded tools for terminal jobs, files, skills,
memory, and a dedicated Playwright Chromium profile. It runs on your machine,
limits access to approved roots, and authenticates every remote MCP session.

## Install

Loom requires Node.js `>=22 <27`.

From a release tarball:

```bash
npm install -g loommcp-cli
loom init
loom launch
```

From this checkout:

```bash
npm ci
npm run build
npm pack --silent
npm install -g ./loommcp-cli-2.0.2.tgz
loom init
loom launch
```

`loom launch` starts the local server, named tunnel, and terminal dashboard.
The dashboard prints the public `/mcp` endpoint and owner password.

## Updates

Loom checks npm for a newer version when it starts, with a 12-hour local cache. By default it only prints the update command:

```bash
npm update -g loommcp-cli
```

You can also run `loom update`. To install updates automatically before launch, enable:

```bash
loom config set autoUpdate true
```

After an automatic update, Loom exits so the next launch runs the new version.

## Seven tools

- `loom_terminal` — bounded asynchronous shell jobs with explicit-danger blocking.
- `loom_read` — bounded text, binary, and image reads with unchanged-repeat suppression.
- `loom_write` — atomic writes inside approved roots.
- `loom_edit` — exact-match edits inside approved roots.
- `loom_skills` — discover and activate bundled or local skills.
- `loom_memory` — Loom-owned session memory operations.
- `loom_browser` — dedicated Chromium snapshot and ref-based interaction.

All tool contracts use strict input/output schemas, owner OAuth, accurate safety
annotations, bounded model-visible results, and per-session skill-hook counters.
Consequential browser clicks require a short-lived prepare/commit approval.

## Connect

Use the HTTPS endpoint shown by `loom launch`:

```text
https://your-host.example.com/mcp
```

Choose OAuth in the MCP client. Approve with the owner password shown in the
terminal dashboard. The local endpoint is `http://127.0.0.1:7676/mcp`.

Client display names are user-defined. Response `loomVersion` is the installed
Loom package version, independent of names such as “Loom v6” in ChatGPT.

## Security model

- Filesystem access is constrained to configured roots.
- Private-network and unsafe browser URLs are blocked.
- Browser actions use accessibility snapshot references, not arbitrary selectors.
- Terminal inputs have no caller-controlled environment injection.
- Explicitly dangerous terminal commands are rejected.
- Every twentieth tool call refreshes the bundled operating-skill reminder for
  that authenticated MCP session.

This is powerful local access. Only connect clients you trust.

## Development

```bash
npm ci
npm run verify
```

See [CHANGELOG.md](CHANGELOG.md) for the minimal file map and implementation log.
