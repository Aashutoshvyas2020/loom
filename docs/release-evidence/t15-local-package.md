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
