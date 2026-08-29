import { composeSuffix, type SkillEntry } from "./index.js";

/**
 * Where the tool container sees the bundles.
 *
 * Its own mount, outside `/workspace`: `.ndx` is masked from that container, and
 * skills have to be readable. Read-only there, so a session cannot rewrite the
 * instructions it was given — which is a thing to enforce with a mount rather
 * than to request in a prompt.
 */
export const SKILLS_MOUNT = "/skills";

/** The same layout the admin writes, read from the other side of the mount. */
export function bundlePath(
  skillsRoot: string,
  origin: ResolvedSkill["origin"],
  name: string,
): string {
  const safe = (value: string | null | undefined): string => {
    if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`not usable as a folder: ${JSON.stringify(value)}`);
    return value;
  };
  const layer = origin.source === "organization"
    ? ["org", safe(origin.sourceId)]
    : origin.source === "account-project"
      ? ["project", safe(origin.projectId)]
      : ["account", safe(origin.sourceId)];
  return [skillsRoot, ...layer, safe(name)].join("/");
}

/**
 * A skill as Admin resolved it.
 *
 * `value` is whatever the entry carried; this reads one field out of it and
 * ignores the rest. Admin decides *which* skills a session gets and under whose
 * authority. What a skill is for is written in the skill.
 */
export interface ResolvedSkill {
  name: string;
  enabled: boolean;
  value: { description?: unknown; [key: string]: unknown };
  /**
   * Which layer's copy won the merge.
   *
   * Needed here because bundles are stored per layer: two layers may define one
   * name, and it is the winner's files that the session must be pointed at.
   * Reusing the origin rather than carrying a second description of the same
   * fact — a scope that disagreed with the origin would send an agent to read
   * one skill while the merge had chosen another.
   */
  origin: { source: "account-project" | "account" | "organization"; sourceId: string; projectId?: string | null };
}

/**
 * Turns the resolved set into the index a session is shown.
 *
 * Disabled entries are dropped rather than listed as unavailable: an agent
 * offered something it cannot use will try it, and the refusal costs a round
 * trip to teach what an absence teaches for free.
 *
 * A skill with no description is dropped too. One line is the entire contract
 * of this index — a name on its own says nothing about when to reach for it,
 * and an unexplained entry in a list of capabilities is worse than a shorter
 * list.
 */
export function skillIndex(resolved: readonly ResolvedSkill[], skillsRoot = SKILLS_MOUNT): SkillEntry[] {
  return resolved
    .filter((skill) => skill.enabled)
    .flatMap((skill) => {
      const description = typeof skill.value.description === "string" ? skill.value.description.trim() : "";
      if (!description) return [];
      // A path the agent cannot be handed is worse than an absent skill: it
      // reads as a capability and behaves as a dead end.
      try { return [{ name: skill.name, description, path: bundlePath(skillsRoot, skill.origin, skill.name) }]; }
      catch { return []; }
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The index as one message.
 *
 * Stored on the session rather than held in this process. A session's
 * reactions run wherever a worker picked them up, and there are four kinds of
 * worker now, each replicable — anything remembered in memory is remembered by
 * one of them and missing from the rest. The session row is the only place all
 * of them can see.
 *
 * It sits after the transcript, not before it. The resolved set is fixed for
 * the life of a session today, so the position buys nothing yet; it buys two
 * things shortly. Loading a skill mid-session will not disturb a byte of what
 * came before, and the set is per account and per project, so keeping it out of
 * the prefix leaves the prefix shared between everyone working on one project.
 */
export function renderSkillIndex(resolved: readonly ResolvedSkill[], skillsRoot = SKILLS_MOUNT): string {
  return composeSuffix(skillIndex(resolved, skillsRoot));
}
