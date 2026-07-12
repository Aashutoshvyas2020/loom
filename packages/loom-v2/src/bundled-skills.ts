export const BUNDLED_SKILL_REMINDER = `[Loom operating skills refresh]
Using Superpowers: before acting, check whether a relevant skill applies; read and follow it first.
Ponytail (full): understand the real flow, then choose the smallest correct solution; reuse existing code and native features before adding abstractions.
Caveman (ultra): communicate with minimal words while preserving exact commands, paths, errors, and safety facts.`;

export const BUNDLED_SKILL_NAMES = ["Using Superpowers", "Ponytail", "Caveman"] as const;

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
] as const;
