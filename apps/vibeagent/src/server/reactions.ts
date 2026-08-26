import { VIBE_ACTIONS, VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION } from "vibeagent_domain/common";
import type { ReactionTable } from "agent/broker";

/**
 * The only place that knows the agent's cycle.
 *
 * No reactor names another and none of them could: each records what it did and
 * stops. This table is what turns "the model replied" into "somebody decide",
 * and it is configuration — the broker, the dispatcher and every worker read it
 * as opaque strings, or never read it at all.
 *
 * Read the loop off this table and you can see it plainly, which is the point.
 * It is not spread through five files where it has to be reassembled by hand.
 */
export const QUEUES = {
  /** Client commands. The broker writes here; nothing else does. */
  intake: "vibe_intake",
  model: "vibe_model",
  decide: "vibe_decide",
  tool: "vibe_tool",
  join: "vibe_join",
} as const;

/** Where an accepted client command goes. Both open a session's work, so both intake. */
export function ingressQueueFor(action: string): string {
  return action === VIBE_SESSION_OPEN_ACTION || action === VIBE_TURN_ACTION ? QUEUES.intake : QUEUES.intake;
}

export const REACTIONS: ReactionTable = {
  // A turn has begun → somebody call the model.
  [VIBE_ACTIONS.turnStarted]: [QUEUES.model],
  // Every tool call of an iteration is answered → call the model again.
  [VIBE_ACTIONS.iterationReady]: [QUEUES.model],
  // The model answered → somebody decide what that was.
  [VIBE_ACTIONS.modelReplied]: [QUEUES.decide],
  // The model asked for a command → somebody run it. N calls fan out to N.
  [VIBE_ACTIONS.toolRequested]: [QUEUES.tool],
  // A command finished → somebody check whether the iteration is done.
  [VIBE_ACTIONS.toolCompleted]: [QUEUES.join],
};

/** Every queue a worker server may be asked to watch. */
export const REACTOR_QUEUES: readonly string[] = [QUEUES.intake, QUEUES.model, QUEUES.decide, QUEUES.tool, QUEUES.join];
