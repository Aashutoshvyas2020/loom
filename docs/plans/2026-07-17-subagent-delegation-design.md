# Loom Subagent Delegation Design

**Status:** Approved for implementation

## Goal

Add one authenticated `loom_agents` MCP tool and a TUI-configured OpenAI-compatible provider so Loom can run explicit, child-free local coding subagents without changing the stable terminal, file, browser, OAuth, or root-boundary behavior.

## Architecture

The user configures one provider endpoint, API key, and default model from the launch TUI. Loom stores that secret in a private `0600` provider file under its existing state directory. `LoomAgentService` owns a bounded in-process queue, durable job records, provider calls, transcript/output cursors, retries, and shutdown cancellation.

Each subagent receives Loom's existing coding tools except `loom_agents`, so delegation cannot recurse. Tool calls are validated against the same flat schemas used by MCP and execute through the existing `LoomToolRuntime`; configured roots and existing terminal process-group cleanup remain the authority.

## Contract

- Provider endpoint: HTTPS, or HTTP on loopback only; base URL or `/v1`; no embedded credentials/query/fragment.
- Provider config: endpoint, API key, and model; never expose the API key through status, logs, or tool results.
- `loom_agents` actions: `status`, `start`, `poll`, `message`, `cancel`, `list`, `read`, `delete`.
- `start` accepts only an explicit task, optional model/cwd/timeout/maxTurns; it has no parent, detached, or child fields.
- Empty assistant responses retry a bounded number of times and then fail as `empty_model_response`; they never become successful completion.
- Active jobs are marked `interrupted` on runtime restart. No automatic replay of side-effecting work.
- Output, transcript, tool calls, queue size, concurrency, turns, and timeout are bounded.

## TUI

The launch dashboard gets an `e` action that pauses the dashboard, prompts for endpoint/API key/model, writes the private provider file, and resumes. Dashboard stats show provider readiness and active/queued agents without revealing secrets.

## Verification

Focused tests cover provider validation/retry/parsing, empty completion failure, tool execution, child-tool absence, persistence/restart, MCP schema/dispatch, TUI configuration, and shutdown. The full verification loop then runs build, typecheck, lint, tests, security checks, package verification, and a live local health/MCP smoke test.
