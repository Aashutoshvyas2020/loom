<p align="center">
  <img src="docs/assets/loom-logo.png" alt="Loom" width="140">
</p>

<h1 align="center">Loom</h1>

<p align="center">A secure local MCP runtime for ChatGPT and OpenAI-compatible clients.</p>

Loom exposes eight bounded tools for terminal jobs, delegated agents, files, skills,
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
npm install -g ./loommcp-cli-2.0.5.tgz
loom init
loom launch
```

`loom launch` starts the local server, named tunnel, and terminal dashboard.
The dashboard prints the public `/mcp` endpoint and owner password, shows exact
provider-reported subagent tokens, and keeps the six most recent tool calls.
Press `l` to open the runtime and Cloudflare logs separately.

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

## Eight tools

- `loom_terminal` — bounded shell jobs, real PTY/stdin interaction, cleaned output, repository checks, and explicit-danger blocking.
- `loom_agents` — explicit child-free coding subagents through a configured OpenAI-compatible endpoint; press `e` in the launch dashboard to configure it.
- `loom_read` — bounded text, binary, and model-visible image reads with unchanged-repeat suppression.
- `loom_write` — atomic writes inside approved roots.
- `loom_edit` — exact-match edits inside approved roots.
- `loom_skills` — discover and activate bundled or local skills.
- `loom_memory` — one global private agent-maintained `MEMORY.md`.
- `loom_browser` — dedicated Chromium snapshot and ref-based interaction.

All tool contracts use strict input/output schemas, owner OAuth, accurate safety
annotations, bounded model-visible results, and per-session skill-hook counters.
Consequential browser clicks require a short-lived prepare/commit approval.

Interactive terminal jobs start with `action: "start"` and `interactive: true`; send input with `action: "input"`. Polling strips ANSI and spinner noise by default, while `finalOnly: true` waits for the completed result and `rawOutput: true` preserves the original stream.

Image reads and browser screenshots are returned inline for model vision. Loom does not return file attachments or trigger file-materialization approval.

Use `loom_terminal` with `action: "repo"` and `repoAction: "status"`, `"diff"`, `"branches"`, or `"release_check"` for structured Git and release context.

Subagents use Loom's existing coding tools, persist bounded transcripts and output,
retry transient provider failures, reject repeated empty completions, and cannot
call `loom_agents` themselves.

ChatGPT and subagents receive the same Think Before Coding, Simplicity First,
Surgical Changes, and Goal-Driven Execution guardrails plus Cavekit's
specify-plan-build-inspect loop. ChatGPT alone receives Loom's adapted engineering,
editing, interface, persistence, and communication behavior instructions.

## Durable memory

`loom_memory` maintains `~/.local/share/loom/memory/MEMORY.md`; setting
`LOOM_STATE_DIR` replaces the `~/.local/share/loom` prefix. Its exact actions are
`read`, `add`, `replace`, and `remove`.

Agents should add only verified reusable environment facts, project conventions,
tool quirks or workarounds, and durable lessons. Never store secrets, guesses,
routine output, transient task state, or raw logs. Memory has a hard 16 KiB bound;
replace or remove stale facts to make room.

Memory updates are atomic and coordinated across concurrent Loom runtimes. Private
state, agent jobs, and provider credentials reject unsafe path ancestors and links.

Each new subagent receives one frozen memory snapshot. Writes persist immediately
but enter prompt context only for new subagent sessions; resuming the same agent keeps
its original snapshot. ChatGPT receives the memory-maintenance reminder through
the existing every-tenth MCP call refresh. Subagents receive guidance in their
system prompt and every tenth subagent tool result.

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
- Every tenth tool call refreshes the bundled operating-skill reminder for
  that authenticated MCP session.

This is powerful local access. Only connect clients you trust.

## Development

```bash
npm ci
npm run verify
```

See [CHANGELOG.md](CHANGELOG.md) for the minimal file map and implementation log.
