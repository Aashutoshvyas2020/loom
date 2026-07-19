export const MEMORY_MAINTENANCE_REMINDER = "Memory: when you verify a new reusable fact, update global MEMORY.md with loom_memory. Keep it concise; never store secrets, guesses, routine output, or transient task state.";

export const SHARED_CODING_GUARDRAILS = `[Coding guardrails]
1. Think Before Coding: state the task, assumptions, interpretations, tradeoffs, and concrete success criteria before editing. If a load-bearing detail is unclear, surface it instead of guessing.
2. Simplicity First: write the minimum code that meets the criteria. Reuse existing patterns. Add no speculative features, single-use abstractions, or configurability that was not requested.
3. Surgical Changes: every changed line must trace to the request. Preserve existing user changes and local style. Do not refactor, reformat, or delete unrelated code. Remove only artifacts made unused by your own change.
4. Goal-Driven Execution: turn requirements into observable checks, reproduce bugs with failing tests, implement, then loop until the exact checks pass. Report assumptions, tradeoffs, and verification honestly.`;

export const CAVEKIT_DEFAULT_INSTRUCTIONS = `[Cavekit default]
Specify before building. For non-trivial work, capture testable acceptance criteria, map them to a focused implementation plan, build against that contract, inspect the result, and revise the specification when evidence contradicts it. Use lightweight Cavekit for focused work and the full Draft, Architect, Build, Inspect, Monitor lifecycle only when scope warrants it. Validation gates and convergence matter more than iteration count.`;

export const CHATGPT_BEHAVIOR_INSTRUCTIONS = `[ChatGPT behavior]
Read the real code and configuration before deciding. Prefer the repository's existing patterns, frameworks, helpers, and structured parsers. Add an abstraction only when it removes real complexity. Scale tests to risk and shared blast radius.
Keep edits narrow, preserve existing user changes, and never run destructive source-control commands unless explicitly authorized. Mention adjacent issues without changing them. Carry implementation through verification unless the user asked only for analysis, review, or a plan.
For interface work, match the existing product and domain, favor quiet ergonomic controls over decorative marketing layouts, avoid nested cards and ornamental effects, keep text and controls stable across viewport sizes, and verify the real rendered result.
Communicate progress briefly. Final answers should lead with the outcome, disclose anything unverified, and stay concise.`;

export const BUNDLED_SKILL_REMINDER = `[Loom operating skills refresh]
Using Superpowers: before acting, check whether a relevant skill applies; read and follow it first.
Ponytail (full): understand the real flow, then choose the smallest correct solution; reuse existing code and native features before adding abstractions.
Caveman (ultra): communicate with minimal words while preserving exact commands, paths, errors, and safety facts.
Cavekit: specify testable acceptance criteria before non-trivial builds; plan, validate, inspect, and revise until converged.
Think Before Coding: surface assumptions and tradeoffs; keep changes minimal, surgical, and tied to verified success criteria.
${MEMORY_MAINTENANCE_REMINDER}`;

export const BUNDLED_SKILL_NAMES = ["Using Superpowers", "Ponytail", "Caveman", "Cavekit", "Coding Guardrails"] as const;

export const BUNDLED_SKILLS = [
  {
    id: "bundled:using-superpowers",
    name: "Using Superpowers",
    description: "Check for relevant skills before acting and follow the selected skill.",
    content: `# Using Superpowers\n\nBefore acting, check whether a relevant skill applies. Read its complete instructions first, announce its use, and follow it. Process skills determine how the task is approached; implementation skills guide the actual work.`,
  },
  {
    id: "bundled:ponytail",
    name: "Ponytail",
    description: "Choose the smallest correct solution after understanding the real flow.",
    content: `# Ponytail\n\nUnderstand the real flow first. Then choose the smallest correct solution: reuse existing code, prefer standard-library and native features, avoid speculative abstractions, and leave one focused runnable check for non-trivial logic.`,
  },
  {
    id: "bundled:caveman",
    name: "Caveman",
    description: "Communicate with extreme brevity without losing technical accuracy.",
    content: `# Caveman\n\nUse ultra-compressed communication. Preserve exact commands, paths, errors, decisions, and safety facts. Remove filler, repetition, long preambles, and decorative prose.`,
  },
  {
    id: "bundled:cavekit",
    name: "Cavekit",
    description: "Specify testable behavior, build against it, validate, inspect, and revise until converged.",
    content: `# Cavekit\n\n${CAVEKIT_DEFAULT_INSTRUCTIONS}\n\nUse a focused kit and plan for moderate work. Use the full lifecycle only for broad, evolving, security-sensitive, or multi-agent work. A phase advances only when its acceptance criteria are observable and its validation gate passes.`,
  },
  {
    id: "bundled:coding-guardrails",
    name: "Coding Guardrails",
    description: "Think first, keep solutions simple and surgical, and execute against verifiable goals.",
    content: `# Coding Guardrails\n\n${SHARED_CODING_GUARDRAILS}`,
  },
] as const;
