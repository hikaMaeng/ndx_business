import { VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION } from "vibeagent_domain/common";

/**
 * The queues, and the one decision the broker makes about them.
 *
 * A queue name is an address, not a topic: it says which reactor a copy is for.
 * That is why the same fact can be delivered twice, to two queues, and mean two
 * different jobs.
 */
export const QUEUES = {
  /** Client commands. The broker writes here; nothing else does. */
  intake: "vibe_intake",
  model: "vibe_model",
  decide: "vibe_decide",
  tool: "vibe_tool",
  join: "vibe_join",
  /** The read model. Reacts to what the others record and answers nobody. */
  view: "vibe_view",
} as const;

/** Where an accepted client command goes. Both open a session's work, so both intake. */
export function ingressQueueFor(action: string): string {
  return action === VIBE_SESSION_OPEN_ACTION || action === VIBE_TURN_ACTION ? QUEUES.intake : QUEUES.intake;
}
