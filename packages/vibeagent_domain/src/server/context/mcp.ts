import { parseMcpServer, splitList, type McpServer } from "admin_domain/common";
import type { ResolvedSkill } from "./loader.js";

/**
 * Which MCP servers a session may reach, and under which skill.
 *
 * **None of this goes in the prompt.** A session is shown skills; an MCP server
 * listed beside the skill that wraps it would show one capability under two
 * names, and the choice between them is a choice with no right answer. It also
 * belongs to the part of a session that may change — a server can be
 * reconfigured mid-session — and anything mutable in the prefix costs the cache
 * for the whole transcript.
 *
 * So this produces session *data*: something the tool side reads when a skill
 * asks it to, and the model never sees as a list of options.
 */

/** One MCP entry as Admin resolved it, before its transport has been settled. */
export interface ResolvedMcp {
  name: string;
  enabled: boolean;
  value: Record<string, unknown>;
}

export interface McpBinding {
  /** The skill that asked for it. */
  skill: string;
  name: string;
  server: McpServer;
}

/** What could not be bound, and why — kept because a silent absence is unreadable. */
export interface McpProblem {
  skill: string;
  name: string;
  reason: "unknown" | "disabled" | "unusable";
}

export interface McpResolution {
  bindings: McpBinding[];
  problems: McpProblem[];
}

/**
 * Binds each skill's declared servers to the entries that define them.
 *
 * The binding is the skill's: a skill says what it needs, and the deployment
 * says what those are. An MCP entry nothing declares is configured and unused,
 * which is a fine thing to be — it is not an error, and it is not reachable.
 *
 * Problems are collected rather than thrown. One skill naming a server that was
 * never configured should not stop a session from opening with the other four,
 * and the reason has to survive to somewhere a person can read it: "the skill
 * did nothing" is the same symptom for a missing entry, a disabled one, and one
 * whose URL was mistyped.
 */
export function resolveMcpBindings(
  skills: readonly ResolvedSkill[],
  entries: readonly ResolvedMcp[],
): McpResolution {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const bindings: McpBinding[] = [];
  const problems: McpProblem[] = [];

  for (const skill of skills) {
    if (!skill.enabled) continue;
    for (const name of splitList(skill.value.mcp)) {
      const entry = byName.get(name);
      if (!entry) { problems.push({ skill: skill.name, name, reason: "unknown" }); continue; }
      if (!entry.enabled) { problems.push({ skill: skill.name, name, reason: "disabled" }); continue; }
      const server = parseMcpServer(entry.value);
      if (!server) { problems.push({ skill: skill.name, name, reason: "unusable" }); continue; }
      bindings.push({ skill: skill.name, name, server });
    }
  }

  // One server named by two skills is one server. Deduplicated on the name
  // rather than on the skill, because connecting twice would give the same
  // process two sessions and the session two answers to the same question.
  const seen = new Set<string>();
  return {
    bindings: bindings.filter((binding) => (seen.has(binding.name) ? false : seen.add(binding.name))),
    problems,
  };
}

/**
 * What the tool side is handed.
 *
 * Keyed by server name because that is what a skill's instructions will say,
 * and flat because whichever skill asked for it, it is the same server.
 */
export function mcpSessionData(resolution: McpResolution): Record<string, McpServer> {
  return Object.fromEntries(resolution.bindings.map((binding) => [binding.name, binding.server]));
}
