export type JsonSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
};

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  securitySchemes: [{ type: "oauth2"; scopes: string[] }];
  annotations: { readOnlyHint: boolean; openWorldHint: boolean; destructiveHint: boolean };
}

const text = (description: string, maxLength = 4_096) => ({ type: "string", description, maxLength });
const action = (...values: string[]) => ({ type: "string", enum: values });
const object = (properties: JsonSchema["properties"], required: string[]): JsonSchema =>
  ({ type: "object", properties, required, additionalProperties: false });
const descriptor = (
  name: string,
  title: string,
  description: string,
  inputSchema: JsonSchema,
  outputSchema: JsonSchema,
  scopes: string[],
  annotations: ToolDescriptor["annotations"],
): ToolDescriptor => ({
  name,
  title,
  description,
  inputSchema,
  outputSchema,
  securitySchemes: [{ type: "oauth2", scopes }],
  annotations,
});

const path = text("Absolute path or ~/ path inside a configured Loom root.");
const hash = { type: "string", pattern: "^[a-fA-F0-9]{64}$" };
const result = object({
  ok: { type: "boolean" },
  action: text("Completed Loom operation.", 64),
  message: text("Short bounded result summary.", 512),
  data: { type: "object", additionalProperties: true },
  loomVersion: text("Loom runtime version.", 64),
  toolCallCount: { type: "integer", minimum: 1 },
}, ["ok", "action", "message", "data", "loomVersion", "toolCallCount"]);

export const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  descriptor(
    "loom_terminal",
    "Terminal",
    "Start, interact with, poll, cancel, or inspect repository state for one bounded process inside an owner-configured local root. Interactive jobs accept stdin, output is cleaned by default, repository checks are structured, and blocked commands identify the exact safety rule.",
    object({
      action: action("start", "poll", "input", "cancel", "repo"),
      command: text("Command for start.", 16_384), cwd: path,
      interactive: { type: "boolean", description: "Run start inside a pseudo-terminal so prompts behave like a real terminal." },
      jobId: text("Job identifier for poll, input, or cancel.", 128),
      text: text("Text to send to a running job's stdin.", 100_000), closeStdin: { type: "boolean" },
      cursor: { type: "integer", minimum: 0 }, maxBytes: { type: "integer", minimum: 1, maximum: 262_144 },
      waitMs: { type: "integer", minimum: 0, maximum: 60_000 }, timeoutMs: { type: "integer", minimum: 100, maximum: 300_000 },
      finalOnly: { type: "boolean", description: "Withhold process output until the job exits." },
      rawOutput: { type: "boolean", description: "Return raw ANSI/control sequences instead of cleaned terminal text." },
      repoAction: action("status", "diff", "branches", "release_check"),
      baseRef: text("Optional Git ref used by repo diff.", 256),
    }, ["action"]),
    result,
    ["loom"],
    { readOnlyHint: false, openWorldHint: true, destructiveHint: true },
  ),
  descriptor(
    "loom_read",
    "Read",
    "Read bounded UTF-8, explicit base64, or a visible PNG/JPEG/GIF/WebP from an owner-configured local root. Set asArtifact to return a downloadable MCP resource link for the complete file. An unchanged repeat within ten project tool calls returns only an unchanged notice. Path and symlink escapes are rejected.",
    object({ path, offset: { type: "integer", minimum: 0 }, length: { type: "integer", minimum: 1, maximum: 10_485_760 }, encoding: { type: "string", enum: ["utf8", "base64"] }, asArtifact: { type: "boolean" } }, ["path"]),
    result,
    ["loom"],
    { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
  ),
  descriptor(
    "loom_write",
    "Write",
    "Atomically create or replace one bounded UTF-8 file inside an owner-configured local root, with optional SHA-256 conflict detection.",
    object({ path, content: text("Complete UTF-8 content.", 1_048_576), createParents: { type: "boolean" }, expectedSha256: hash }, ["path", "content"]),
    result,
    ["loom"],
    { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
  ),
  descriptor(
    "loom_edit",
    "Edit",
    "Replace exact bounded text inside one authorized local file, rejecting ambiguous matches unless replaceAll is explicit and supporting SHA-256 conflict detection.",
    object({ path, oldText: text("Exact text to replace.", 262_144), newText: text("Replacement text.", 262_144), replaceAll: { type: "boolean" }, expectedSha256: hash }, ["path", "oldText", "newText"]),
    result,
    ["loom"],
    { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
  ),
  descriptor(
    "loom_skills",
    "Skills",
    "List, search, read, activate, rescan, or diagnose Loom's bounded local skill catalog. This does not execute skill text.",
    object({ action: action("list", "search", "read", "activate", "rescan", "diagnostics"), query: text("Search query."), id: text("Skill identifier.", 512), limit: { type: "integer", minimum: 1, maximum: 100 } }, ["action"]),
    result,
    ["loom"],
    { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  ),
  descriptor(
    "loom_memory",
    "Memory",
    "List, search, read, save, or delete bounded Loom memory.",
    object({ action: action("list", "search", "read", "save", "delete"), query: text("Search query."), id: text("Memory identifier.", 512), title: text("Memory title.", 512), content: text("Memory content.", 1_048_576), limit: { type: "integer", minimum: 1, maximum: 100 } }, ["action"]),
    result,
    ["loom"],
    { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
  ),
  descriptor(
    "loom_browser",
    "Browser",
    "Control Loom's dedicated Playwright Chromium profile on public HTTP(S) pages without arbitrary JavaScript, private-network access, user-profile attachment, or automatic form submission.",
    object({
      action: action("status", "tabs", "open", "navigate", "snapshot", "click", "type", "screenshot", "close", "prepare", "commit"),
      tabId: text("Loom tab identifier.", 128), url: text("HTTP(S) URL or about:blank.", 2_048),
      ref: text("Accessibility reference returned by a Loom snapshot.", 512), text: text("Text to type.", 100_000),
      actionId: text("Short-lived single-use prepared browser action identifier.", 128),
      fullPage: { type: "boolean" }, maxCharacters: { type: "integer", minimum: 1, maximum: 200_000 },
    }, ["action"]),
    result,
    ["loom"],
    { readOnlyHint: false, openWorldHint: true, destructiveHint: true },
  ),
] as const;
