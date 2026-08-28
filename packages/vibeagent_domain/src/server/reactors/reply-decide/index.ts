import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, parseIterationScope } from "../../../common/index.js";
import type { ReactorGlobals, SessionContext } from "../context/index.js";

/**
 * Was that the answer, or a request to run something?
 *
 * The only judgement in the machine, and it is deliberately alone in a file.
 * It reads the model's message back out of the history rather than being handed
 * it, because the fact that woke it carries a count and not content.
 *
 * When there are tool calls it records one `tool.requested` per call. It does
 * not run them, does not wait for them, and does not know who does.
 */
export async function decideReply(
  globals: ReactorGlobals,
  session: SessionContext,
  event: EventEnvelope,
  emit: WorkerEmit,
): Promise<{ turnKey: string; toolCalls: number; final: boolean }> {
  const scope = parseIterationScope(event.payload);
  if (!scope) throw new Error(`${VIBE_ACTIONS.modelReplied} requires turnKey and iterationIndex`);

  const reply = await session.store.lastAssistantMessage(session.sessionKey, scope.turnKey, scope.iterationIndex);
  const toolCalls = reply?.toolCalls ?? [];

  if (!toolCalls.length) {
    const answer = (reply?.content ?? "").trim();
    emit({
      action: VIBE_ACTIONS.turnFinal, seq: session.sequence.next(),
      key: `turn.final:${scope.turnKey}`,
      turnKey: scope.turnKey, answer, stoppedBy: "final",
    });
    return { turnKey: scope.turnKey, toolCalls: 0, final: true };
  }

  // The budget belongs here too: "is this turn over" is the same question.
  if (scope.iterationIndex + 1 >= globals.config.maxIterations) {
    emit({
      action: VIBE_ACTIONS.turnFinal, seq: session.sequence.next(), turnKey: scope.turnKey,
      key: `turn.final:${scope.turnKey}`,
      answer: "Stopped: reached the iteration budget before the model produced a final answer.",
      stoppedBy: "iteration_budget",
    });
    return { turnKey: scope.turnKey, toolCalls: 0, final: true };
  }

  toolCalls.forEach((call, index) => {
    let command = "";
    try {
      const parsed = JSON.parse(call.function.arguments || "{}") as { command?: unknown };
      command = typeof parsed.command === "string" ? parsed.command : "";
    } catch { command = ""; }

    emit({
      action: VIBE_ACTIONS.toolRequested, seq: session.sequence.next(),
      // Derived from the call's own position, so a repeated decision asks for
      // the same N commands rather than for N more.
      key: `tool.requested:${scope.turnKey}:${scope.iterationIndex}:${index}`,
      turnKey: scope.turnKey, iterationIndex: scope.iterationIndex,
      // Deterministic so a replayed decision addresses the same logical call.
      toolCallKey: `${scope.turnKey}:${scope.iterationIndex}:${index}`,
      toolCallId: call.id, command,
      audience: "worker",
    });
  });

  return { turnKey: scope.turnKey, toolCalls: toolCalls.length, final: false };
}
