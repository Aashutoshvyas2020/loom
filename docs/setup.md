# Setup Guide

This guide is for users who want ChatGPT or another MCP host to work in local
projects through Loom.

## Requirements

- Node `>=22 <27`
- npm
- Git
- Bash (`bash` on `PATH`)
- Cloudflare CLI (`cloudflared`) for `loom launch`
- macOS `pbcopy` for dashboard copy shortcuts; optional elsewhere
- a public HTTPS URL that forwards to the local Loom server

`loom init` checks these external dependencies, shows missing install guidance,
and continues configuration.

`loom launch` starts Loom with its named Cloudflare Tunnel. `loom serve` can
instead run behind your own HTTPS reverse proxy.

## Install And Configure

Run:

```bash
loom init
```

The setup flow asks one question at a time.

### Project Roots

Choose the folders ChatGPT is allowed to open through Loom. Keep this
narrow.

Examples:

```text
~/personal,~/work
```

```text
/Users/alice/dev,/Users/alice/work
```

```text
C:\Users\alice\dev,C:\Users\alice\work
```

### Local Port

The default is `7676`.

The local MCP URL is:

```text
http://127.0.0.1:7676/mcp
```

### Public Base URL

Start your tunnel or reverse proxy before entering this value. Point the tunnel
at:

```text
http://127.0.0.1:7676
```

Enter the public origin without `/mcp`:

```text
https://your-tunnel-host.example.com
```

Configure the MCP client with the full MCP endpoint:

```text
https://your-tunnel-host.example.com/mcp
```

## Start Loom

Run:

```bash
loom launch
```

If your tunnel URL changes for one run, override it without rewriting config:

```bash
LOOM_PUBLIC_BASE_URL="https://new-tunnel.example.com" loom launch
```

For a stable public URL, persist it:

```bash
loom config set publicBaseUrl https://loom.example.com
loom launch
```

## Approve The Client

When ChatGPT, Claude, or another MCP client connects, Loom shows an Owner
password approval page. Enter the Owner password printed during setup.

The default config files are:

```text
~/.loom/config.json
~/.loom/auth.json
```

Keep `auth.json` private.

## Check Your Setup

Run:

```bash
loom doctor
```

The doctor command reports the resolved config, Node version, Node ABI, platform,
Git, Bash, public URL, allowed hosts, and SQLite native dependency status.

## Running From A Local Checkout

If you are developing Loom itself instead of using the published package:

```bash
npm install --include=dev
npm run dev
```

The same setup rules apply.
