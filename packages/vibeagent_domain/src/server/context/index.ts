/**
 * What a session is told, and where each piece sits.
 *
 * The order is not presentation. Providers cache by token prefix, so anything
 * that changes invalidates everything after it — and the transcript is after
 * all of this. Two rules follow, and they decide the whole shape:
 *
 *   **Immutable goes first.** The prefix is composed once, when the session
 *   opens, and never again. Refreshing a directory listing into it every call
 *   would throw away the cache on every call, which is worse than the listing
 *   is worth. The agent runs `ls` when it needs to know.
 *
 *   **Most-shared goes first within that.** The cache is not per session: two
 *   sessions sharing leading tokens share the work. So the base prompt and the
 *   tool list — identical everywhere — come before the project's paths, which
 *   are identical only within one project.
 *
 * Anything that can change during a session goes *after* the transcript
 * instead, where rebuilding it costs only itself. That is where skills live:
 * they are loaded because of what is happening now, so they belong next to now.
 */

/** One line in the index of what this session can reach for. */
export interface SkillEntry {
  name: string;
  /** One line. The detail lives in the skill and is read when it is wanted. */
  description: string;
}

export interface ContextParts {
  /** Identical for every session everywhere. */
  basePrompt: string;
  /** The tools this deployment gives. Also identical everywhere. */
  tools: readonly string[];
  /** Where this project is, from the agent's side of the mount. */
  projectPath: string;
  projectName: string;
  /**
   * The cascading `AGENTS.md`, already merged.
   *
   * Merged elsewhere and handed over whole: what the merge decided is a policy
   * question, and composing a prompt should not also be answering it.
   */
  agents: string;
}

/**
 * The part that is frozen for the life of the session.
 *
 * Returned as one string because that is what gets hashed and stored. Changing
 * how it is built changes every session's cache lineage, so the pieces are
 * listed in `ContextParts` rather than assembled from whatever is to hand.
 */
export function composePrefix(parts: ContextParts): string {
  const sections = [
    parts.basePrompt.trim(),
    `# Tools\n\n${parts.tools.map((tool) => `- ${tool}`).join("\n")}`,
    `# Project\n\nname: ${parts.projectName}\npath: ${parts.projectPath}`,
  ];
  // Only if there is one. An empty heading reads as "there are no instructions"
  // when it means "nobody wrote any", and the two are worth telling apart.
  if (parts.agents.trim()) sections.push(`# Project instructions\n\n${parts.agents.trim()}`);
  return sections.join("\n\n---\n\n") + "\n";
}

/**
 * The part rebuilt on every call.
 *
 * Skills arrive as one line each. The full text of a skill is not here on
 * purpose: most turns need none of them, and a page of instructions for a skill
 * nobody reaches for is a page of instructions competing for attention with the
 * conversation.
 */
export function composeSuffix(skills: readonly SkillEntry[]): string {
  if (!skills.length) return "";
  const lines = skills.map((skill) => `- **${skill.name}** — ${skill.description}`);
  return [
    "# Available skills",
    "",
    "Each is a procedure this deployment has written down. When one covers the",
    "task, read it before starting: they carry specifics no summary can.",
    "",
    ...lines,
    "",
  ].join("\n");
}

/**
 * What was used, small enough to record as a fact.
 *
 * The composed text is a projection — rebuild it from these and the same
 * sources and you get the same bytes. Recording the text instead would put a
 * copy of every prompt in the event log, and answer a question nobody asks
 * ("what did it say") in place of the one they do ("what was it running").
 */
export interface ContextRecipe {
  baseVersion: string;
  skills: readonly string[];
  agentsDigest: string;
  toolCount: number;
}

export function describeContext(parts: ContextParts, skills: readonly SkillEntry[], baseVersion: string): ContextRecipe {
  return {
    baseVersion,
    skills: skills.map((skill) => skill.name),
    agentsDigest: digest(parts.agents),
    toolCount: parts.tools.length,
  };
}

/**
 * A short, stable fingerprint.
 *
 * Enough to notice that two sessions were given different instructions, which
 * is the question this answers. Not a security boundary and not trying to be.
 */
export function digest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
