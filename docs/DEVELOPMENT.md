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

## State and secret handling

Never place these in test output, fixtures committed to Git, audit metadata, screenshots, or documentation examples:

- real owner passwords
- OAuth access or refresh tokens
- Cloudflare API tokens or tunnel secrets
- real authorization headers
- browser typed secrets
- private file content

Use temporary directories and synthetic values. Tests that intentionally contain marker strings must assert those strings are absent from audit and structured metadata.

## Browser development

`npm install` must not download Chromium. Use:

```bash
loom setup browser
```

Browser tests use deterministic fake backends for public-tool policy and targeted real wrapper/CDP checks for executable verification and shutdown. Optional external smoke tests are not release gates unless the certification plan explicitly promotes them.

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

## Evidence discipline

Deterministic tests prove local behavior only. They do not prove:

- real Cloudflare DNS routing
- real Named Tunnel account state
- ChatGPT custom MCP availability
- real ChatGPT OAuth/reconnect/tool behavior
- sleep/wake connector persistence
- a clean supported-Mac installation

Those claims require the corresponding real evidence in `docs/RELEASE_CERTIFICATION.md` and `docs/release-evidence/`.
