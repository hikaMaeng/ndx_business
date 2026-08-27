import { VIBE_ACTIONS, VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION } from "vibeagent_domain/common";
import { VIBE_REACTOR_GROUPS, type ReactorGroup } from "vibeagent_domain/server";
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
  /** The read model. Reacts to what the others record and answers nobody. */
  view: "vibe_view",
} as const;

/** Where an accepted client command goes. Both open a session's work, so both intake. */
export function ingressQueueFor(action: string): string {
  return action === VIBE_SESSION_OPEN_ACTION || action === VIBE_TURN_ACTION ? QUEUES.intake : QUEUES.intake;
}

/**
 * Fan-out, not competition.
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

/**
 * Which reactors answer on which queue.
 *
 * The pairing is the routing key. `turn.started` means "call the model" on one
 * queue and "write a view row" on another, and only the queue name can say
 * which copy this is.
 */
export const GROUPS: Readonly<Record<string, ReactorGroup>> = {
  [QUEUES.intake]: VIBE_REACTOR_GROUPS.intake!,
  [QUEUES.model]: VIBE_REACTOR_GROUPS.model!,
  [QUEUES.decide]: VIBE_REACTOR_GROUPS.decide!,
  [QUEUES.tool]: VIBE_REACTOR_GROUPS.tool!,
  [QUEUES.join]: VIBE_REACTOR_GROUPS.join!,
  [QUEUES.view]: VIBE_REACTOR_GROUPS.view!,
};

/** Every queue a worker server may be asked to watch. */
export const REACTOR_QUEUES: readonly string[] = Object.keys(GROUPS);
