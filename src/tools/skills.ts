import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  open,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { AuditLogger } from '../audit.js';
import {
  MAX_CATALOG_DEPTH,
  MAX_FILES_PER_ROOT,
  MAX_FILE_BYTES_PER_ROOT,
  MAX_SCAN_SECONDS,
  MAX_TOTAL_INDEXED_BYTES,
} from '../limits.js';
import {
  PathPolicyError,
  assertNoSymlinkComponents,
  resolveUserPath,
} from '../paths.js';
import type {
  LoomToolDispatcher,
  LoomToolName,
} from './register.js';

export class SkillCatalogConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SkillCatalogConfigError';
  }
}

export class SkillCatalogLimitError extends SkillCatalogConfigError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SkillCatalogLimitError';
  }
}

export interface SkillRoot {
  namespace: string;
  path: string;
}

export interface SkillCatalogLimits {
  maxEntriesPerRoot: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  scanDeadlineMs: number;
}

export interface SkillDiagnostic {
  code:
    | 'root_missing'
    | 'symlink_skipped'
    | 'depth_skipped'
    | 'oversized_skill_skipped'
    | 'invalid_utf8_skipped'
    | 'malformed_frontmatter_skipped';
  namespace: string;
  path: string;
  message: string;
}

export interface SkillSummary {
  id: string;
  namespace: string;
  relativePath: string;
  name: string;
  description: string;
  bytes: number;
  sha256: string;
  duplicateName: boolean;
  duplicateCount: number;
}

export interface SkillCatalogSnapshot {
  generation: number;
  scannedAt: string | null;
  skills: SkillSummary[];
  diagnostics: SkillDiagnostic[];
  totalBytes: number;
}

export interface SkillCatalogServiceOptions {
  roots: SkillRoot[];
  limits?: Partial<SkillCatalogLimits>;
  now?: () => number;
  audit?: AuditLogger;
}

export interface SearchSkillsInput {
  query: string;
  limit?: number;
}

export interface ReadSkillInput {
  id: string;
}

interface InternalSkill extends SkillSummary {
  absolutePath: string;
  content: string;
  normalizedName: string;
  normalizedDescription: string;
  normalizedContent: string;
}

interface ScanContext {
  startedAt: number;
  totalBytes: number;
  skills: InternalSkill[];
  diagnostics: SkillDiagnostic[];
  ids: Set<string>;
}

const DEFAULT_LIMITS: SkillCatalogLimits = {
  maxEntriesPerRoot: MAX_FILES_PER_ROOT,
  maxFileBytes: MAX_FILE_BYTES_PER_ROOT,
  maxTotalBytes: MAX_TOTAL_INDEXED_BYTES,
  maxDepth: MAX_CATALOG_DEPTH,
  scanDeadlineMs: MAX_SCAN_SECONDS * 1_000,
};

const NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function nestedErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && typeof current.code === 'string') {
      return current.code;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

function cleanMetadata(value: string, maximum: number): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maximum);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseSkillMetadata(
  content: string,
  fallbackName: string,
): { name: string; description: string } | null {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  let frontmatterEnd = -1;
  let name = '';
  let description = '';

  if (lines[0] === '---') {
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index] === '---') {
        frontmatterEnd = index;
        break;
      }
      const separator = lines[index]!.indexOf(':');
      if (separator <= 0) {
        continue;
      }
      const key = lines[index]!.slice(0, separator).trim().toLowerCase();
      const value = unquote(lines[index]!.slice(separator + 1));
      if (key === 'name' && name === '') {
        name = cleanMetadata(value, 256);
      } else if (key === 'description' && description === '') {
        description = cleanMetadata(value, 1_024);
      }
    }
    if (frontmatterEnd < 0) {
      return null;
    }
  }

  const bodyStart = frontmatterEnd >= 0 ? frontmatterEnd + 1 : 0;
  if (name === '') {
    const heading = lines
      .slice(bodyStart)
      .find((line) => /^#\s+\S/.test(line));
    if (heading !== undefined) {
      name = cleanMetadata(heading.replace(/^#\s+/, ''), 256);
    }
  }
  if (description === '') {
    const bodyLine = lines
      .slice(bodyStart)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('#'));
    if (bodyLine !== undefined) {
      description = cleanMetadata(bodyLine, 1_024);
    }
  }

  return {
    name: name || cleanMetadata(fallbackName, 256) || 'Unnamed Skill',
    description,
  };
}

function validateLimit(
  name: keyof SkillCatalogLimits,
  value: number,
  maximum: number,
  allowZero = false,
): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SkillCatalogConfigError(
      `${name} must be a safe integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function normalizeLimits(input: Partial<SkillCatalogLimits> | undefined): SkillCatalogLimits {
  const limits = { ...DEFAULT_LIMITS, ...input };
  return {
    maxEntriesPerRoot: validateLimit(
      'maxEntriesPerRoot',
      limits.maxEntriesPerRoot,
      MAX_FILES_PER_ROOT,
    ),
    maxFileBytes: validateLimit(
      'maxFileBytes',
      limits.maxFileBytes,
      MAX_FILE_BYTES_PER_ROOT,
    ),
    maxTotalBytes: validateLimit(
      'maxTotalBytes',
      limits.maxTotalBytes,
      MAX_TOTAL_INDEXED_BYTES,
    ),
    maxDepth: validateLimit(
      'maxDepth',
      limits.maxDepth,
      MAX_CATALOG_DEPTH,
      true,
    ),
    scanDeadlineMs: validateLimit(
      'scanDeadlineMs',
      limits.scanDeadlineMs,
      MAX_SCAN_SECONDS * 1_000,
    ),
  };
}

function normalizeRoots(roots: SkillRoot[]): SkillRoot[] {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new SkillCatalogConfigError('At least one skill root is required.');
  }

  const namespaces = new Set<string>();
  const paths = new Set<string>();
  const normalized = roots.map((root) => {
    const namespace = root.namespace.trim().toLowerCase();
    if (!NAMESPACE_PATTERN.test(namespace)) {
      throw new SkillCatalogConfigError(
        `Invalid skill namespace ${JSON.stringify(root.namespace)}.`,
      );
    }
    if (namespaces.has(namespace)) {
      throw new SkillCatalogConfigError(`Duplicate skill namespace: ${namespace}`);
    }
    namespaces.add(namespace);

    let resolvedPath: string;
    try {
      resolvedPath = resolveUserPath(root.path);
    } catch (error) {
      throw new SkillCatalogConfigError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      );
    }
    if (paths.has(resolvedPath)) {
      throw new SkillCatalogConfigError(`Duplicate skill root path: ${resolvedPath}`);
    }
    paths.add(resolvedPath);
    return { namespace, path: resolvedPath };
  });

  return normalized.sort((left, right) => lexicalCompare(left.namespace, right.namespace));
}

function immutableSnapshot(snapshot: SkillCatalogSnapshot): SkillCatalogSnapshot {
  for (const skill of snapshot.skills) {
    Object.freeze(skill);
  }
  for (const diagnostic of snapshot.diagnostics) {
    Object.freeze(diagnostic);
  }
  Object.freeze(snapshot.skills);
  Object.freeze(snapshot.diagnostics);
  return Object.freeze(snapshot);
}

function sameFileIdentity(
  left: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint },
  right: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint },
): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function skillResult(
  text: string,
  structuredContent: Record<string, unknown>,
): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

export class SkillCatalogService {
  private roots: SkillRoot[];
  private readonly limits: SkillCatalogLimits;
  private readonly now: () => number;
  private readonly audit: AuditLogger | undefined;
  private currentSnapshot: SkillCatalogSnapshot = immutableSnapshot({
    generation: 0,
    scannedAt: null,
    skills: [],
    diagnostics: [],
    totalBytes: 0,
  });
  private currentSkills = new Map<string, InternalSkill>();
  private scanChain: Promise<void> = Promise.resolve();

  constructor(options: SkillCatalogServiceOptions) {
    this.roots = normalizeRoots(options.roots);
    this.limits = normalizeLimits(options.limits);
    this.now = options.now ?? Date.now;
    this.audit = options.audit;
  }

  replaceRoots(roots: SkillRoot[]): void {
    this.roots = normalizeRoots(roots);
  }

  getSnapshot(): SkillCatalogSnapshot {
    return structuredClone(this.currentSnapshot);
  }

  async rescan(): Promise<CallToolResult> {
    let resolveScan!: () => void;
    const prior = this.scanChain;
    this.scanChain = new Promise<void>((resolve) => {
      resolveScan = resolve;
    });
    await prior;

    try {
      const context: ScanContext = {
        startedAt: this.now(),
        totalBytes: 0,
        skills: [],
        diagnostics: [],
        ids: new Set(),
      };
      for (const root of this.roots) {
        this.checkDeadline(context);
        await this.scanRoot(root, context);
      }
      this.checkDeadline(context);

      context.skills.sort((left, right) => lexicalCompare(left.id, right.id));
      context.diagnostics.sort((left, right) => {
        const namespace = lexicalCompare(left.namespace, right.namespace);
        if (namespace !== 0) {
          return namespace;
        }
        const targetPath = lexicalCompare(left.path, right.path);
        return targetPath !== 0 ? targetPath : lexicalCompare(left.code, right.code);
      });

      const duplicateCounts = new Map<string, number>();
      for (const skill of context.skills) {
        duplicateCounts.set(
          skill.normalizedName,
          (duplicateCounts.get(skill.normalizedName) ?? 0) + 1,
        );
      }
      for (const skill of context.skills) {
        const duplicateCount = duplicateCounts.get(skill.normalizedName) ?? 1;
        skill.duplicateCount = duplicateCount;
        skill.duplicateName = duplicateCount > 1;
      }

      const nextSkills = new Map(context.skills.map((skill) => [skill.id, skill]));
      const nextSnapshot = immutableSnapshot({
        generation: this.currentSnapshot.generation + 1,
        scannedAt: new Date(this.now()).toISOString(),
        skills: context.skills.map((skill) => ({
          id: skill.id,
          namespace: skill.namespace,
          relativePath: skill.relativePath,
          name: skill.name,
          description: skill.description,
          bytes: skill.bytes,
          sha256: skill.sha256,
          duplicateName: skill.duplicateName,
          duplicateCount: skill.duplicateCount,
        })),
        diagnostics: context.diagnostics,
        totalBytes: context.totalBytes,
      });

      this.currentSkills = nextSkills;
      this.currentSnapshot = nextSnapshot;
      await this.audit?.recordRead('skills.rescan', {
        generation: nextSnapshot.generation,
        roots: this.roots.length,
        skills: nextSnapshot.skills.length,
        diagnostics: nextSnapshot.diagnostics.length,
        totalBytes: nextSnapshot.totalBytes,
      });
      return skillResult('Skill catalog rescanned.', {
        generation: nextSnapshot.generation,
        skills: nextSnapshot.skills.length,
        diagnostics: nextSnapshot.diagnostics,
        totalBytes: nextSnapshot.totalBytes,
      });
    } finally {
      resolveScan();
    }
  }

  async list(): Promise<CallToolResult> {
    const snapshot = this.getSnapshot();
    await this.audit?.recordRead('skills.list', {
      generation: snapshot.generation,
      skills: snapshot.skills.length,
    });
    return skillResult(JSON.stringify(snapshot.skills, null, 2), {
      generation: snapshot.generation,
      scannedAt: snapshot.scannedAt,
      skills: snapshot.skills,
      diagnostics: snapshot.diagnostics,
      totalBytes: snapshot.totalBytes,
    });
  }

  async search(input: SearchSkillsInput): Promise<CallToolResult> {
    if (typeof input.query !== 'string' || input.query.trim() === '') {
      throw new SkillCatalogConfigError('Skill search query must not be empty.');
    }
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
      throw new SkillCatalogConfigError('Skill search limit must be an integer from 1 to 100.');
    }

    const normalizedQuery = input.query.toLocaleLowerCase('en-US').trim();
    const tokens = [...new Set(normalizedQuery.split(/\s+/).filter(Boolean))];
    const results = [...this.currentSkills.values()]
      .map((skill) => ({ skill, score: this.scoreSkill(skill, normalizedQuery, tokens) }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score || lexicalCompare(left.skill.id, right.skill.id))
      .slice(0, limit)
      .map(({ skill, score }) => ({
        id: skill.id,
        namespace: skill.namespace,
        relativePath: skill.relativePath,
        name: skill.name,
        description: skill.description,
        bytes: skill.bytes,
        sha256: skill.sha256,
        duplicateName: skill.duplicateName,
        duplicateCount: skill.duplicateCount,
        score,
      }));

    await this.audit?.recordRead('skills.search', {
      generation: this.currentSnapshot.generation,
      queryBytes: Buffer.byteLength(input.query),
      results: results.length,
    });
    return skillResult(JSON.stringify(results, null, 2), {
      generation: this.currentSnapshot.generation,
      skills: results,
    });
  }

  async read(input: ReadSkillInput): Promise<CallToolResult> {
    if (typeof input.id !== 'string' || input.id.length === 0) {
      throw new SkillCatalogConfigError('Skill ID must not be empty.');
    }
    const skill = this.currentSkills.get(input.id);
    if (skill === undefined) {
      throw new SkillCatalogConfigError(`Unknown skill ID: ${input.id}`);
    }
    await this.audit?.recordRead('skills.read', {
      generation: this.currentSnapshot.generation,
      id: skill.id,
      bytes: skill.bytes,
    });
    return skillResult(skill.content, {
      id: skill.id,
      namespace: skill.namespace,
      relativePath: skill.relativePath,
      name: skill.name,
      description: skill.description,
      bytes: skill.bytes,
      sha256: skill.sha256,
      duplicateName: skill.duplicateName,
      duplicateCount: skill.duplicateCount,
    });
  }

  private async scanRoot(root: SkillRoot, context: ScanContext): Promise<void> {
    try {
      await assertNoSymlinkComponents(root.path);
    } catch (error) {
      if (nestedErrorCode(error) === 'ENOENT') {
        context.diagnostics.push({
          code: 'root_missing',
          namespace: root.namespace,
          path: root.path,
          message: 'Configured skill root does not exist.',
        });
        return;
      }
      throw new SkillCatalogConfigError(
        error instanceof Error ? error.message : String(error),
        { cause: error instanceof Error ? error : undefined },
      );
    }

    let rootStats;
    try {
      rootStats = await lstat(root.path, { bigint: true });
    } catch (error) {
      if (nestedErrorCode(error) === 'ENOENT') {
        context.diagnostics.push({
          code: 'root_missing',
          namespace: root.namespace,
          path: root.path,
          message: 'Configured skill root does not exist.',
        });
        return;
      }
      throw new SkillCatalogConfigError(`Unable to inspect skill root ${root.path}: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new SkillCatalogConfigError(`Skill root must be a real directory: ${root.path}`);
    }

    const counter = { entries: 0 };
    await this.scanDirectory(root, root.path, '', 0, counter, context);
  }

  private async scanDirectory(
    root: SkillRoot,
    directoryPath: string,
    relativeDirectory: string,
    depth: number,
    counter: { entries: number },
    context: ScanContext,
  ): Promise<void> {
    this.checkDeadline(context);
    let before;
    let entries;
    try {
      before = await lstat(directoryPath, { bigint: true });
      if (before.isSymbolicLink() || !before.isDirectory()) {
        throw new SkillCatalogConfigError(`Catalog directory changed shape: ${directoryPath}`);
      }
      entries = await readdir(directoryPath, { withFileTypes: true });
      await assertNoSymlinkComponents(directoryPath);
      const after = await lstat(directoryPath, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || !after.isDirectory()) {
        throw new SkillCatalogConfigError(`Catalog directory changed during scan: ${directoryPath}`);
      }
    } catch (error) {
      if (error instanceof SkillCatalogConfigError) {
        throw error;
      }
      if (error instanceof PathPolicyError) {
        throw new SkillCatalogConfigError(error.message, { cause: error });
      }
      throw new SkillCatalogConfigError(`Unable to scan skill directory ${directoryPath}: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }

    entries.sort((left, right) => lexicalCompare(left.name, right.name));
    for (const entry of entries) {
      this.checkDeadline(context);
      counter.entries += 1;
      if (counter.entries > this.limits.maxEntriesPerRoot) {
        throw new SkillCatalogLimitError(
          `Skill root ${root.path} exceeds ${this.limits.maxEntriesPerRoot} entries.`,
        );
      }

      const entryPath = path.join(directoryPath, entry.name);
      const relativePath = relativeDirectory === ''
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      let stats;
      try {
        stats = await lstat(entryPath, { bigint: true });
      } catch (error) {
        throw new SkillCatalogConfigError(`Unable to inspect catalog entry ${entryPath}: ${String(error)}`, {
          cause: error instanceof Error ? error : undefined,
        });
      }

      if (stats.isSymbolicLink()) {
        context.diagnostics.push({
          code: 'symlink_skipped',
          namespace: root.namespace,
          path: relativePath,
          message: 'Symbolic-link catalog entry was not followed.',
        });
        continue;
      }
      if (stats.isDirectory()) {
        const childDepth = depth + 1;
        if (childDepth > this.limits.maxDepth) {
          context.diagnostics.push({
            code: 'depth_skipped',
            namespace: root.namespace,
            path: relativePath,
            message: `Directory exceeds maximum catalog depth ${this.limits.maxDepth}.`,
          });
          continue;
        }
        await this.scanDirectory(
          root,
          entryPath,
          relativePath,
          childDepth,
          counter,
          context,
        );
        continue;
      }
      if (!stats.isFile() || entry.name !== 'SKILL.md') {
        continue;
      }
      if (stats.size > BigInt(this.limits.maxFileBytes)) {
        context.diagnostics.push({
          code: 'oversized_skill_skipped',
          namespace: root.namespace,
          path: relativePath,
          message: `SKILL.md exceeds ${this.limits.maxFileBytes} bytes.`,
        });
        continue;
      }

      await this.indexSkill(root, entryPath, relativeDirectory, stats, context);
    }
  }

  private async indexSkill(
    root: SkillRoot,
    skillPath: string,
    relativeDirectory: string,
    discoveredStats: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint },
    context: ScanContext,
  ): Promise<void> {
    this.checkDeadline(context);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await assertNoSymlinkComponents(skillPath);
      handle = await open(skillPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()
        || before.dev !== discoveredStats.dev
        || before.ino !== discoveredStats.ino
        || before.size > BigInt(this.limits.maxFileBytes)) {
        throw new SkillCatalogConfigError(`SKILL.md changed before it could be indexed: ${skillPath}`);
      }
      const bytes = await handle.readFile();
      this.checkDeadline(context);
      const after = await handle.stat({ bigint: true });
      await assertNoSymlinkComponents(skillPath);
      const pathnameStats = await lstat(skillPath, { bigint: true });
      if (!pathnameStats.isFile()
        || !sameFileIdentity(before, after)
        || before.dev !== pathnameStats.dev
        || before.ino !== pathnameStats.ino
        || bytes.byteLength !== Number(before.size)) {
        throw new SkillCatalogConfigError(`SKILL.md changed while it was indexed: ${skillPath}`);
      }

      let content: string;
      try {
        content = fatalUtf8Decoder.decode(bytes);
      } catch {
        context.diagnostics.push({
          code: 'invalid_utf8_skipped',
          namespace: root.namespace,
          path: relativeDirectory === '' ? 'SKILL.md' : `${relativeDirectory}/SKILL.md`,
          message: 'SKILL.md is not valid UTF-8.',
        });
        return;
      }

      const fallbackName = relativeDirectory === ''
        ? root.namespace
        : path.basename(relativeDirectory);
      const metadata = parseSkillMetadata(content, fallbackName);
      if (metadata === null) {
        context.diagnostics.push({
          code: 'malformed_frontmatter_skipped',
          namespace: root.namespace,
          path: relativeDirectory === '' ? 'SKILL.md' : `${relativeDirectory}/SKILL.md`,
          message: 'SKILL.md frontmatter is not terminated by a closing delimiter.',
        });
        return;
      }
      if (context.totalBytes + bytes.byteLength > this.limits.maxTotalBytes) {
        throw new SkillCatalogLimitError(
          `Skill catalog exceeds ${this.limits.maxTotalBytes} indexed bytes.`,
        );
      }

      const idPath = relativeDirectory === '' ? '.' : relativeDirectory.split(path.sep).join('/');
      const id = `${root.namespace}:${idPath}`;
      if (context.ids.has(id)) {
        throw new SkillCatalogConfigError(`Duplicate stable skill ID discovered: ${id}`);
      }
      context.ids.add(id);

      const normalizedName = metadata.name.toLocaleLowerCase('en-US');
      context.totalBytes += bytes.byteLength;
      context.skills.push({
        id,
        namespace: root.namespace,
        relativePath: idPath,
        name: metadata.name,
        description: metadata.description,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        duplicateName: false,
        duplicateCount: 1,
        absolutePath: skillPath,
        content,
        normalizedName,
        normalizedDescription: metadata.description.toLocaleLowerCase('en-US'),
        normalizedContent: content.toLocaleLowerCase('en-US'),
      });
    } catch (error) {
      if (error instanceof SkillCatalogConfigError) {
        throw error;
      }
      if (error instanceof PathPolicyError) {
        throw new SkillCatalogConfigError(error.message, { cause: error });
      }
      throw new SkillCatalogConfigError(`Unable to index ${skillPath}: ${String(error)}`, {
        cause: error instanceof Error ? error : undefined,
      });
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private checkDeadline(context: ScanContext): void {
    if (this.now() - context.startedAt > this.limits.scanDeadlineMs) {
      throw new SkillCatalogLimitError(
        `Skill scan exceeded ${this.limits.scanDeadlineMs} ms.`,
      );
    }
  }

  private scoreSkill(skill: InternalSkill, query: string, tokens: string[]): number {
    let score = 0;
    if (skill.id.toLocaleLowerCase('en-US') === query) {
      score += 1_200;
    }
    if (skill.normalizedName === query) {
      score += 1_000;
    }
    for (const token of tokens) {
      if (skill.normalizedName.includes(token)) {
        score += 120;
      }
      if (skill.normalizedDescription.includes(token)) {
        score += 30;
      }
      if (skill.normalizedContent.includes(token)) {
        score += 5;
      }
      if (skill.id.toLocaleLowerCase('en-US').includes(token)) {
        score += 10;
      }
    }
    return score;
  }
}

export function createSkillToolDispatcher(
  service: SkillCatalogService,
  fallback: LoomToolDispatcher,
): LoomToolDispatcher {
  return async (name: LoomToolName, arguments_: Record<string, unknown>) => {
    if (name !== 'loom_skills') {
      return fallback(name, arguments_);
    }

    switch (arguments_.action) {
      case 'list':
        return service.list();
      case 'search':
        return service.search(arguments_ as unknown as SearchSkillsInput);
      case 'read':
        return service.read(arguments_ as unknown as ReadSkillInput);
      case 'rescan':
        return service.rescan();
      default:
        throw new SkillCatalogConfigError(`Unsupported loom_skills action: ${String(arguments_.action)}`);
    }
  };
}
