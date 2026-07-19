import { BUNDLED_SKILL_REMINDER } from "./bundled-skills.js";

export interface SessionHookResult {
  callCount: number;
  reminder?: string;
}

export class SessionSkillHook {
  readonly #counts = new Map<string, number>();

  record(sessionId: string): SessionHookResult {
    if (!sessionId) throw new Error("Authenticated MCP session ID is required");
    const callCount = (this.#counts.get(sessionId) ?? 0) + 1;
    this.#counts.set(sessionId, callCount);
    return {
      callCount,
      reminder: callCount % 10 === 0 ? BUNDLED_SKILL_REMINDER : undefined,
    };
  }

  delete(sessionId: string): void {
    this.#counts.delete(sessionId);
  }
}
