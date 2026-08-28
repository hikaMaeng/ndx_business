import { VIBE_ACTIONS } from "vibeagent_domain/common";
import type { ReactionTable } from "agent/broker";
import { QUEUES } from "./queues.js";

/**
 * The only place that knows the agent's cycle.
 *
 * No reactor names another and none of them could: each records what it did and
 * stops. This table is what turns "the model replied" into "somebody decide",
 * and it is configuration — the broker, the dispatcher and every worker read it
 * as opaque strings, or never read it at all.
 *
 * Read the loop off this table and you can see it plainly. It is not spread
 * through five files where it has to be reassembled by hand.
 *
 * Where two queues share a fact, both get their own copy on their own queue.
 * That is what makes the projection addable at all: the view worker reads the
 * same `model.replied` the decision does, and neither is delayed by, or aware
 * of, the other. Deleting the `view` entries would delete the read model and
 * change nothing else in the machine.
 */
export const REACTIONS: ReactionTable = {
  // A turn has begun → somebody call the model, and somebody write it down.
  [VIBE_ACTIONS.turnStarted]: [QUEUES.model, QUEUES.view],
  // Every tool call of an iteration is answered → call the model again.
  [VIBE_ACTIONS.iterationReady]: [QUEUES.model],
  // The model answered → somebody decide what that was, and fold the deltas.
  [VIBE_ACTIONS.modelReplied]: [QUEUES.decide, QUEUES.view],
  // The model asked for a command → somebody run it. N calls fan out to N.
  [VIBE_ACTIONS.toolRequested]: [QUEUES.tool],
  // A command finished → check whether the iteration is done, and fold its output.
  [VIBE_ACTIONS.toolCompleted]: [QUEUES.join, QUEUES.view],
  // The turn is over. Only the read model cares; the machine is already done.
  [VIBE_ACTIONS.turnFinal]: [QUEUES.view],
};
