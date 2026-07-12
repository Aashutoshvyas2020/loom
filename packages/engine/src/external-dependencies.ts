export interface ExternalDependencyStatus {
  command: "bash" | "cloudflared" | "pbcopy";
  found: boolean;
  path?: string;
  purpose: string;
  install: string;
}

const dependencies: Array<Omit<ExternalDependencyStatus, "found" | "path">> = [
  { command: "bash", purpose: "terminal shell compatibility", install: "Install Bash and ensure `bash` is on PATH." },
  { command: "cloudflared", purpose: "the named HTTPS tunnel used by `loom launch`", install: "Install with `brew install cloudflared` or from developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/." },
  { command: "pbcopy", purpose: "terminal dashboard clipboard shortcuts", install: "Built into macOS. On other platforms, copy endpoint and password manually." },
];

export function inspectExternalDependencies(env: NodeJS.ProcessEnv = process.env): ExternalDependencyStatus[] {
  return dependencies.map((dependency) => {
    const path = findExecutable(dependency.command, env);
    return { ...dependency, found: path !== undefined, ...(path ? { path } : {}) };
  });
}

function findExecutable(command: string, env: NodeJS.ProcessEnv): string | undefined {
  const extensions = process.platform === "win32"
    ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")]
    : [""];
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const path = join(directory, `${command}${extension.toLowerCase()}`);
      try {
        accessSync(path, constants.X_OK);
        return path;
      } catch { /* try next PATH entry */ }
    }
  }
  return undefined;
}
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
