import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { parseVibeTurnRequest, VIBE_TURN_ACTION } from "../../common/index.js";
import { runTurn, type LoopConfig } from "../loop/index.js";
import { readLoopConfig } from "../config/index.js";

/**
 * The action registry this app binds into the broker's worker thread.
 *
 * It holds exactly one action. Anything else is rejected rather than silently
 * acknowledged: a coding agent that pretends to have run an unknown action is
 * worse than one that fails loudly.
 */
export async function executeHandler(event: EventEnvelope, signal: AbortSignal, emit: WorkerEmit): Promise<unknown> {
  if (event.action !== VIBE_TURN_ACTION) throw new Error(`No worker handler for ${event.action}`);

  const request = parseVibeTurnRequest({
    sessionKey: event.sessionId ?? (event.payload as Record<string, unknown>).sessionKey,
    turnKey: event.turnId ?? event.transactionKey,
    userId: (event.payload as Record<string, unknown>).userId,
    prompt: (event.payload as Record<string, unknown>).prompt,
  });
  if (!request) throw new Error("vibe.turn.run requires sessionKey, turnKey, userId and prompt");

  const config: LoopConfig = readLoopConfig();
  return runTurn(request, config, emit, signal);
}
