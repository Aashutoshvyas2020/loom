# Loom Global Agent Memory Design

**Status:** Approved for implementation

## Goal

Give every Loom agent one durable, agent-maintained `MEMORY.md`, following Hermes Agent's small curated-memory model.

## Architecture

Keep one global file at `<stateDirectory>/memory/MEMORY.md`. Rework the existing `LoomMemory` class as the sole reader and atomic writer; do not add another store or dependency. Existing JSON memories migrate once into Markdown, then `memory.json` is no longer written.

Each subagent receives a frozen snapshot in its system prompt when the job starts. Writes persist immediately but affect prompt context only for later jobs. ChatGPT and subagents receive a short memory-maintenance reminder every ten Loom tool calls.

## Contract

- `loom_memory` supports `read`, `add`, `replace`, and `remove` against the global document.
- `add` appends one concise durable fact; `replace` and `remove` require exact text to avoid accidental edits.
- Agents store stable environment facts, project conventions, verified workarounds, and reusable lessons.
- Agents do not store secrets, guesses, routine outputs, transient task state, or raw conversation logs.
- Memory writes keep private `0700` directory and `0600` file modes, use atomic rename, reject obvious secrets, and enforce a small hard size limit.
- Concurrent writes serialize through the existing write chain.
- A missing file reads as an empty memory document.

## Verification

Focused tests cover empty reads, add/replace/remove, exact-match conflicts, secret and size rejection, file permissions, JSON migration, frozen subagent prompt injection, and ten-call reminders. Full repository verification runs after focused tests pass.
