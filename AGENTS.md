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
