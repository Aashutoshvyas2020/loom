import { chmod, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = fileURLToPath(new URL("../dist", import.meta.url));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["src/cli.ts"],
  outdir: dist,
  entryNames: "cli",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  alias: {
    "@loom-local/loom-v2": fileURLToPath(new URL("../packages/loom-v2/src/index.ts", import.meta.url)),
  },
  legalComments: "none",
  logLevel: "warning",
});
await chmod(fileURLToPath(new URL("../dist/cli.js", import.meta.url)), 0o755);
