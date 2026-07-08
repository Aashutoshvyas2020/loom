# Loom Implementation Handoff

**Date and local time:** 2026-07-08 16:18:39 PDT
**Checkout path:** `/Users/aashu/loom`
**Branch:** `planning/loom-v1-cavekit`
**HEAD SHA before pending commit:** `894249e276000dcf6075bd35dccb363c07adcd03`
**Repository state:** dirty only with completed T10 Cloudflared implementation and same-commit governance
**Current task:** T10 — Cloudflared acquisition and validation
**Last completed gate:** deterministic typecheck/full tests/build and real official arm64 HTTPS install are green
**Pushed or published:** no

## Required startup command

```bash
cd /Users/aashu/loom && npm ci && npm run typecheck && npm test && npm run build && git status --short
```

## Completed work

- Pinned Cloudflared `2026.7.0` for macOS arm64 and x64 with exact official archive URLs, byte counts, archive SHA-256 values, and extracted executable SHA-256 values.
- Added credential-free HTTPS download with manual redirects capped at five, a bounded 30-minute total transfer deadline, exact streamed size/hash verification, private exclusive staging, and complete failure cleanup.
- Added strict single-file tar extraction, private executable permissions, exact executable hash/version verification, stable identity checks, atomic promotion, directory fsync, and preservation of a prior binary when verification fails before promotion.
- Added normal PATH symlink canonicalization with current-user ownership, regular-file/executable mode, stable identity, exact hash/version, and fail-closed first-match semantics.
- Added direct ProcessManager launch with fixed `tunnel --no-autoupdate --metrics 127.0.0.1:0` argv and reserved-option rejection. No shell or terminal-tool routing exists.
- Kept Quick Tunnel parsing, named credentials, endpoint binding, retries, and orchestration out of T10; they remain T11–T14.

## Exact commands and results

```text
npm ci
PASS — 106 packages, zero vulnerabilities

node --test dist/test/cloudflare.test.js
PASS — 9/9

npm run typecheck
PASS

npm test
PASS — 129/129

npm run build
PASS
```

## Real Cloudflared evidence

```text
Pinned version: 2026.7.0

macOS arm64 archive
bytes: 18957597
sha256: 276f4ae3119c88d1708b0f884a35a1c87d9ae459b0dab6313f2daddbddab2bec
executable bytes: 38388400
executable sha256: cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04
version probe: 2026.7.0

macOS x64 archive
bytes: 20841929
sha256: dd1fb6a914a21dc52c64bad96987bbbc72d6c65553a2cfee1dd5bc886742ddfb
executable bytes: 41181376
executable sha256: c0c65579c6f11b1381cf5ffd1614f5094bf140e18938eae4ad16931da9f69499
version probe under Rosetta: 2026.7.0

Production official-HTTPS arm64 install
result: success
installed path: /private/tmp/loom-t10-network-single/cloudflared/cloudflared
installed mode: 0700
installed sha256: cd33944f6ce65e240942d986932bc96bde8641ecefcd52c1ae5dc21f0bcffb04
installed version: 2026.7.0
staging residue: none
installer/Cloudflared process residue: none
```

The first real transfer proved a 60-second and then 10-minute whole-download deadline was insufficient on this connection while cleanup remained correct. The final bounded default is 30 minutes; the same production downloader then completed successfully.

## Known failures

None in T0–T10 deterministic validation or completed real T10 acquisition/verification evidence.

## Real blockers

None for T10. Quick Tunnel behavior is T12, named-tunnel behavior is T13, and integrated readiness/orchestration remains T11/T14.

## Files changed

- `CHANGELOG.md`
- `HANDOFF.md`
- `REPO_MAP.md`
- `SPEC.md`
- `docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt`
- `src/cloudflare.ts`
- `test/cloudflare.test.ts`

## Exact next command

```bash
git add CHANGELOG.md HANDOFF.md REPO_MAP.md SPEC.md docs/plans/2026-07-08-loom-v1-cavekit-implementation-plan.txt src/cloudflare.ts test/cloudflare.test.ts && git diff --cached --check && git commit -m "feat: add cloudflared acquisition"
```

## Next expected result

Commit T10 with a clean working tree, record the resulting SHA, then begin T11 tunnel-independent runtime readiness without importing Quick or Named tunnel scope early.
