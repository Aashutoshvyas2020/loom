# Loom

Loom is a foreground-only, single-owner remote MCP server for macOS. The repository is under active implementation from the approved Cavekit plan.

Current branch: `planning/loom-v1-cavekit`

Do not treat this checkout as production-ready until Gate G7 is recorded as passing in `HANDOFF.md` and `REPO_MAP.md`.

## Loom v1 operator and developer entrypoint

Loom is a foreground-only macOS MCP runtime that exposes unrestricted local file, terminal, skill, memory, and browser capabilities to an authenticated remote connector. It is **not production-certified**. Running the YOLO path is equivalent to granting the authorized client full access to your macOS account.

From a source checkout:

```bash
npm ci
npm run build
npm link
loom setup
loom setup --with-browser
loom launch
loom launch --yolo
loom status
loom reset --confirm
```

`loom launch` is side-effect free. Only `loom launch --yolo` starts the unrestricted foreground runtime, and it requires a controlling local terminal for the warning and newly generated owner password.

Documentation:

- [Operator guide](docs/OPERATOR.md): installation, tunnel modes, ChatGPT connection, status, shutdown, and troubleshooting.
- [Security model](docs/SECURITY.md): unrestricted trust boundary, process ownership, OAuth, audit, browser, and incident response.
- [Development guide](docs/DEVELOPMENT.md): architecture, RED/GREEN workflow, validation, governance, and handoff rules.
- [Certification guide](docs/CERTIFICATION.md): deterministic gates versus real Cloudflare/ChatGPT release evidence.

The source of truth for implementation requirements remains `SPEC.md` and the canonical plan under `docs/plans/`. Current resumable state is in `HANDOFF.md`.
