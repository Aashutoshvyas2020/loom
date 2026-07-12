import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_RETAINED_ARTIFACTS = 32;

export interface LoomArtifact {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  bytes: number;
  path: string;
}

type StoredArtifact = LoomArtifact & { dataPath: string };

export class LoomArtifacts {
  readonly #directory: string;
  readonly #artifacts = new Map<string, StoredArtifact>();

  constructor(directory: string) {
    this.#directory = directory;
  }

  async save(name: string, data: Buffer, mimeType?: string): Promise<LoomArtifact> {
    if (data.length > MAX_ARTIFACT_BYTES) throw new Error(`Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    while (this.#artifacts.size >= MAX_RETAINED_ARTIFACTS) {
      const oldest = this.#artifacts.entries().next().value as [string, StoredArtifact] | undefined;
      if (!oldest) break;
      this.#artifacts.delete(oldest[0]);
      await rm(oldest[1].dataPath, { force: true });
    }
    const id = randomUUID();
    const safeName = sanitizeName(name);
    const dataPath = join(this.#directory, `${id}-${safeName}`);
    const handle = await open(dataPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const artifact: StoredArtifact = {
      id,
      uri: `loom-artifact://artifact/${id}`,
      name: safeName,
      mimeType: mimeType ?? inferMimeType(safeName),
      bytes: data.length,
      path: dataPath,
      dataPath,
    };
    this.#artifacts.set(id, artifact);
    return publicArtifact(artifact);
  }

  async read(id: string): Promise<{ artifact: LoomArtifact; data: Buffer }> {
    const artifact = this.#artifacts.get(id);
    if (!artifact) throw new Error(`Unknown or expired Loom artifact: ${id}`);
    const data = await readFile(artifact.dataPath);
    if (data.length > MAX_ARTIFACT_BYTES) throw new Error(`Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`);
    return { artifact: publicArtifact(artifact), data };
  }
}

function sanitizeName(input: string): string {
  const name = basename(input).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (name || "artifact.bin").slice(0, 160);
}

function inferMimeType(name: string): string {
  switch (extname(name).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".pdf": return "application/pdf";
    case ".json": return "application/json";
    case ".html": return "text/html";
    case ".md": return "text/markdown";
    case ".txt":
    case ".log":
    case ".csv": return "text/plain";
    case ".zip": return "application/zip";
    default: return "application/octet-stream";
  }
}

function publicArtifact(artifact: StoredArtifact): LoomArtifact {
  const { dataPath: _dataPath, ...publicValue } = artifact;
  return publicValue;
}
