import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, parseIterationScope } from "../../common/index.js";
import type { ReactorGlobals, SessionContext } from "./context.js";

/**
 * Are all of this iteration's tool calls answered yet?
 *
 * This is the join, and there is no coordinator in it. When the model asked for
 * N commands, `tool.completed` arrives N times and this reactor wakes N times.
 * Every time it asks the database the same question and only the last one finds
 * the counts equal — the counting is done by state, not by anyone in charge.
 *
 * It does not know that an inference call follows. It records that the
 * iteration is ready and stops.
 */
export async function joinTools(
  _globals: ReactorGlobals,
  session: SessionContext,
  event: EventEnvelope,
  emit: WorkerEmit,
): Promise<{ turnKey: string; requested: number; completed: number; ready: boolean }> {
  const scope = parseIterationScope(event.payload);
  if (!scope) throw new Error(`${VIBE_ACTIONS.toolCompleted} requires turnKey and iterationIndex`);

  const { requested, completed } = await session.store.toolProgress(session.sessionKey, scope.turnKey, scope.iterationIndex);
  if (!requested || completed < requested) {
    return { turnKey: scope.turnKey, requested, completed, ready: false };
  }

  emit({
    action: VIBE_ACTIONS.iterationReady, seq: session.sequence.next(),
    turnKey: scope.turnKey, iterationIndex: scope.iterationIndex + 1,
    toolCalls: requested,
    audience: "worker",
  });
  return { turnKey: scope.turnKey, requested, completed, ready: true };
}
