# Security Model

Loom gives an authenticated MCP client powerful local access. Trust every approved client.

- File tools stay inside configured roots. Prefer project directories; avoid `~` and `/`.
- Terminal commands run as your local user. Explicit-disaster blocking is an accident rail, not a sandbox.
- Public origins require HTTPS. Plain HTTP is accepted only on loopback.
- OAuth uses PKCE, hashed tokens, short-lived authorization codes, refresh rotation, replay-family revocation, and an anti-clickjacking approval page.
- Browser uses a dedicated Chromium profile and blocks private-network destinations.
- `q` waits for server, browser, terminal process groups, and tunnel shutdown before displaying `TERMINATED`.

Owner password lives at `~/.loom/auth.json`. Keep it private. Use narrow roots and connect only clients you trust.
