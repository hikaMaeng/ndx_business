import { VIBE_REACTOR_GROUPS, type ReactorGroup } from "vibeagent_domain/server";
import { QUEUES } from "./queues.js";

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
