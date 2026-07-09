import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';

import {
  MAX_BROWSER_SNAPSHOT_BYTES,
  MAX_EDIT_WINDOW_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_TERMINAL_COMMAND_BYTES,
  MAX_TERMINAL_ENVIRONMENT_ENTRIES,
  MAX_TERMINAL_ENVIRONMENT_KEY_BYTES,
  MAX_TERMINAL_ENVIRONMENT_VALUE_BYTES,
  MAX_TERMINAL_JOB_ID_BYTES,
  MAX_TERMINAL_POLL_BYTES,
  MAX_TERMINAL_TIMEOUT_MS,
  MAX_TERMINAL_WAIT_MS,
  MAX_WRITE_BYTES,
} from '../limits.js';

export const LOOM_TOOL_NAMES = [
  'loom_terminal',
  'loom_read',
  'loom_write',
  'loom_edit',
  'loom_skills',
  'loom_memory',
  'loom_browser',
] as const;

export type LoomToolName = (typeof LOOM_TOOL_NAMES)[number];
export type LoomToolDispatcher = (
  name: LoomToolName,
  arguments_: Record<string, unknown>,
) => Promise<CallToolResult>;

const absoluteOrHomePath = z.string().min(1).max(4096).refine(
  (value) => value.startsWith('/') || value.startsWith('~/'),
  'Path must be absolute or start with ~/.',
);
const sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/);
const jobId = z.string().min(1).max(MAX_TERMINAL_JOB_ID_BYTES);
const tabId = z.string().min(1).max(128);
const selector = z.string().min(1).max(4096);
const safeUrl = z.string().url().max(8192);

const terminalSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    command: z.string().min(1).max(MAX_TERMINAL_COMMAND_BYTES),
    cwd: absoluteOrHomePath.optional(),
    environment: z.record(
      z.string().min(1).max(MAX_TERMINAL_ENVIRONMENT_KEY_BYTES),
      z.string().max(MAX_TERMINAL_ENVIRONMENT_VALUE_BYTES),
    ).refine(
      (value) => Object.keys(value).length <= MAX_TERMINAL_ENVIRONMENT_ENTRIES,
      `Environment exceeds ${MAX_TERMINAL_ENVIRONMENT_ENTRIES} entries.`,
    ).optional(),
    timeoutMs: z.number().int().positive().max(MAX_TERMINAL_TIMEOUT_MS).optional(),
  }).strict(),
  z.object({
    action: z.literal('poll'),
    jobId,
    cursor: z.number().int().nonnegative().optional(),
    maxBytes: z.number().int().positive().max(MAX_TERMINAL_POLL_BYTES).optional(),
    waitMs: z.number().int().nonnegative().max(MAX_TERMINAL_WAIT_MS).optional(),
  }).strict(),
  z.object({
    action: z.literal('cancel'),
    jobId,
  }).strict(),
]);

const readSchema = z.object({
  path: absoluteOrHomePath,
  offset: z.number().int().nonnegative().optional(),
  length: z.number().int().positive().max(MAX_WRITE_BYTES).optional(),
  encoding: z.enum(['utf8', 'base64']).optional(),
}).strict();

const writeSchema = z.object({
  path: absoluteOrHomePath,
  content: z.string().max(MAX_WRITE_BYTES),
  createParents: z.boolean().optional(),
  expectedSha256: sha256.optional(),
}).strict();

const editSchema = z.object({
  path: absoluteOrHomePath,
  oldText: z.string().min(1).max(MAX_EDIT_WINDOW_BYTES),
  newText: z.string().max(MAX_EDIT_WINDOW_BYTES),
  replaceAll: z.boolean().optional(),
  expectedSha256: sha256.optional(),
}).strict();

const skillsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({
    action: z.literal('search'),
    query: z.string().min(1).max(4096),
    limit: z.number().int().positive().max(100).optional(),
  }).strict(),
  z.object({
    action: z.literal('read'),
    id: z.string().min(1).max(512),
  }).strict(),
  z.object({ action: z.literal('rescan') }).strict(),
]);

const memorySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({
    action: z.literal('search'),
    query: z.string().min(1).max(4096),
    limit: z.number().int().positive().max(100).optional(),
  }).strict(),
  z.object({
    action: z.literal('read'),
    id: z.string().min(1).max(512),
  }).strict(),
  z.object({
    action: z.literal('save'),
    title: z.string().min(1).max(512),
    content: z.string().max(MAX_WRITE_BYTES),
  }).strict(),
  z.object({
    action: z.literal('delete'),
    id: z.string().min(1).max(512),
  }).strict(),
  z.object({ action: z.literal('rescan') }).strict(),
]);

const browserSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('tabs') }).strict(),
  z.object({
    action: z.literal('open'),
    url: safeUrl.optional(),
  }).strict(),
  z.object({
    action: z.literal('navigate'),
    tabId,
    url: safeUrl,
  }).strict(),
  z.object({
    action: z.literal('snapshot'),
    tabId,
    maxBytes: z.number().int().positive().max(MAX_BROWSER_SNAPSHOT_BYTES).optional(),
  }).strict(),
  z.object({
    action: z.literal('click'),
    tabId,
    selector,
  }).strict(),
  z.object({
    action: z.literal('type'),
    tabId,
    selector,
    text: z.string().max(1024 * 1024),
    submit: z.boolean().optional(),
  }).strict(),
  z.object({
    action: z.literal('evaluate'),
    tabId,
    expression: z.string().min(1).max(65_536),
  }).strict(),
  z.object({
    action: z.literal('screenshot'),
    tabId,
    fullPage: z.boolean().optional(),
    maxBytes: z.number().int().positive().max(MAX_SCREENSHOT_BYTES).optional(),
  }).strict(),
  z.object({
    action: z.literal('close'),
    tabId,
  }).strict(),
  z.object({
    action: z.literal('grant_permissions'),
    origin: safeUrl,
    permissions: z.array(z.string().min(1).max(128)).min(1).max(32),
  }).strict(),
  z.object({
    action: z.literal('clear_permissions'),
    origin: safeUrl.optional(),
  }).strict(),
  z.object({
    action: z.literal('set_geolocation'),
    origin: safeUrl,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().positive().max(100_000).optional(),
  }).strict(),
]);

function register(
  server: McpServer,
  name: LoomToolName,
  description: string,
  inputSchema: z.ZodType,
  dispatcher: LoomToolDispatcher,
): void {
  server.registerTool(
    name,
    { description, inputSchema },
    async (arguments_) => dispatcher(name, arguments_ as Record<string, unknown>),
  );
}

export function registerLoomTools(server: McpServer, dispatcher: LoomToolDispatcher): void {
  register(
    server,
    'loom_terminal',
    'Start, poll, or cancel a noninteractive command running as the local macOS user.',
    terminalSchema,
    dispatcher,
  );
  register(
    server,
    'loom_read',
    'Read bounded text or supported local image content from an absolute or home-relative path.',
    readSchema,
    dispatcher,
  );
  register(
    server,
    'loom_write',
    'Atomically write bounded content with optional optimistic SHA-256 conflict detection.',
    writeSchema,
    dispatcher,
  );
  register(
    server,
    'loom_edit',
    'Exactly replace text in a bounded file with optional optimistic SHA-256 conflict detection.',
    editSchema,
    dispatcher,
  );
  register(
    server,
    'loom_skills',
    'List, search, read, or rescan the read-only local skills catalog.',
    skillsSchema,
    dispatcher,
  );
  register(
    server,
    'loom_memory',
    'List, search, read, save, delete, or rescan Loom memory using stable Loom-owned IDs.',
    memorySchema,
    dispatcher,
  );
  register(
    server,
    'loom_browser',
    'Control Loom’s dedicated persistent browser profile with bounded output and explicit permissions.',
    browserSchema,
    dispatcher,
  );
}
