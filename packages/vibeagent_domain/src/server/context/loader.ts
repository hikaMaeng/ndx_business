import { composeSuffix, type SkillEntry } from "./index.js";

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
export function skillIndex(resolved: readonly ResolvedSkill[]): SkillEntry[] {
  return resolved
    .filter((skill) => skill.enabled)
    .flatMap((skill) => {
      const description = typeof skill.value.description === "string" ? skill.value.description.trim() : "";
      return description ? [{ name: skill.name, description }] : [];
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
export function renderSkillIndex(resolved: readonly ResolvedSkill[]): string {
  return composeSuffix(skillIndex(resolved));
}
