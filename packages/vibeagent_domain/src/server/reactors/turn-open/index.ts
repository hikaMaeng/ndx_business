import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, VIBE_TURN_ACTION, parseVibeTurnRequest } from "../../../common/index.js";
import type { ReactorGlobals, SessionContext } from "../context/index.js";

/**
 * The turn begins.
 *
 * It puts the prompt in the session's history and records that a turn started.
 * That is all. It does not call anything, decide anything, or say what should
 * happen next — something reacts to `turn.started`, and this reactor has no
 * idea what.
 */
export async function openTurn(
  globals: ReactorGlobals,
  session: SessionContext,
  event: EventEnvelope,
  emit: WorkerEmit,
): Promise<{ turnKey: string; workspace: string }> {
  const payload = event.payload as Record<string, unknown>;
  const request = parseVibeTurnRequest({
    sessionKey: session.sessionKey,
    turnKey: event.turnId ?? event.transactionKey,
    userId: payload.userId,
    prompt: payload.prompt,
  });
  if (!request) throw new Error(`${VIBE_TURN_ACTION} requires sessionKey, turnKey, userId and prompt`);

  // The system prompt belongs to the session, not to a turn, so it is written
  // once when the history is still empty.
  const history = await session.store.history(session.sessionKey);
  const opening = history.length ? [] : [{ role: "system" as const, content: globals.config.systemPrompt }];

  await session.store.appendMessages(session.sessionKey, [
    ...opening,
    { turnKey: request.turnKey, iterationIndex: 0, role: "user", content: request.prompt },
  ]);

  emit({
    action: VIBE_ACTIONS.turnStarted,
    // One turn starts once, however many times this reactor runs.
    key: `turn.started:${request.turnKey}`,
    seq: session.sequence.next(),
    sessionKey: session.sessionKey,
    turnKey: request.turnKey,
    iterationIndex: 0,
    prompt: request.prompt,
  });

  return { turnKey: request.turnKey, workspace: session.workspace };
}
