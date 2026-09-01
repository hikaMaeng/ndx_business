import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, parseIterationScope } from "../../../common/index.js";
import { chat } from "../../llm/index.js";
import type { ChatMessage } from "../../llm/index.js";
import { BASH_TOOL_SCHEMA } from "../../tools/bash/index.js";
import type { ReactorGlobals, SessionContext } from "../context/index.js";

/**
 * One inference call. That is the whole job.
 *
 * The instruction that wakes it is tiny — which turn, which iteration — because
 * everything it needs to send is already in the database. It reads the history
 * functionally, hands the whole pile over, and streams what comes back into
 * facts as it arrives.
 *
 * Calling the model is not a conversation with anything. The endpoint remembers
 * nothing between requests, so "continuing" a turn means sending the accumulated
 * history again. There is no state here to carry.
 *
 * It stays alive for as long as the stream does, and that is correct: the stream
 * is its single task. What it does not do is decide anything about what came
 * back. It records that the model replied and stops.
 */
export async function callModel(
  globals: ReactorGlobals,
  session: SessionContext,
  event: EventEnvelope,
  emit: WorkerEmit,
  signal: AbortSignal,
): Promise<{ turnKey: string; iterationIndex: number; toolCalls: number }> {
  const scope = parseIterationScope(event.payload);
  if (!scope) throw new Error(`${VIBE_ACTIONS.turnStarted} requires turnKey and iterationIndex`);

  const history = await session.store.history(session.sessionKey);
  if (!history.length) throw new Error(`session ${session.sessionKey} has no history to send`);

  /**
   * Instructions in front, skills behind.
   *
   * The prefix is the same bytes on every call of this session, so the provider
   * can reuse everything up to the newest message. The skill index goes after
   * the history for the same reason in reverse: it changes, and putting it at
   * the front would invalidate the whole transcript each time it did.
   */
  const context = await session.store.readContext(session.sessionKey);
  const messages: ChatMessage[] = [
    ...(context.prefix ? [{ role: "system" as const, content: context.prefix }] : []),
    ...history,
    ...(context.suffix ? [{ role: "system" as const, content: context.suffix }] : []),
  ];

  emit({
    action: VIBE_ACTIONS.iterationStarted, seq: session.sequence.next(),
    key: `iteration.started:${scope.turnKey}:${scope.iterationIndex}`,
    turnKey: scope.turnKey, iterationIndex: scope.iterationIndex,
  });

  /**
   * The session's model, over the container's.
   *
   * The container's configuration is a fallback, not the answer: it is the same
   * for every session on the machine, and which model an agent runs on is a
   * decision an organisation makes. Merged rather than replaced so a deployment
   * that registered a model but no timeout still gets a timeout.
   */
  const chosen = await session.store.readInference(session.sessionKey) as Partial<typeof globals.config>;
  const config = Object.keys(chosen).length ? { ...globals.config, ...chosen } : globals.config;

  const reply = await chat(config, messages, [BASH_TOOL_SCHEMA], signal, (delta) => {
    if (delta.reasoning) {
      emit({
        action: VIBE_ACTIONS.iterationReasoning, seq: session.sequence.next(),
        turnKey: scope.turnKey, iterationIndex: scope.iterationIndex, reasoning: delta.reasoning,
      });
    }
    if (delta.content) {
      emit({
        action: VIBE_ACTIONS.iterationMessage, seq: session.sequence.next(),
        turnKey: scope.turnKey, iterationIndex: scope.iterationIndex, message: delta.content,
      });
    }
  });

  // An endpoint that ignored `stream` answered in one block; emit it whole so
  // the transcript is the same either way.
  if (!reply.streamed) {
    if (reply.reasoning.trim()) {
      emit({ action: VIBE_ACTIONS.iterationReasoning, seq: session.sequence.next(), turnKey: scope.turnKey, iterationIndex: scope.iterationIndex, reasoning: reply.reasoning });
    }
    if (reply.content.trim()) {
      emit({ action: VIBE_ACTIONS.iterationMessage, seq: session.sequence.next(), turnKey: scope.turnKey, iterationIndex: scope.iterationIndex, message: reply.content });
    }
  }

  // The reply goes into the history before the fact is recorded. Whoever reads
  // that fact will look the message up, so it has to be there first.
  await session.store.appendMessages(session.sessionKey, [{
    turnKey: scope.turnKey,
    iterationIndex: scope.iterationIndex,
    role: "assistant",
    content: reply.content,
    ...(reply.toolCalls.length ? { toolCalls: reply.toolCalls } : {}),
  }]);

  /**
   * A reply with nothing in it is not an answer.
   *
   * "No tool calls" used to be the whole test, so a model that returned empty
   * content and asked for nothing ended the turn as though it had finished.
   * What a person saw was a request, a pause, and then nothing — no result, no
   * error, no reason. The turn had "succeeded".
   *
   * A thinking model makes this reachable in a way the previous one did not: it
   * spends its budget on reasoning and can emit a couple of newlines as the
   * visible half. That is a model stopping, not a model answering, and the two
   * should not look the same from outside.
   *
   * Said out loud rather than retried. Retrying is a policy — how many times,
   * with what nudge, at whose cost — and inventing one here would bury the
   * behaviour under a workaround before anybody had seen it happen.
   */
  const empty = !reply.toolCalls.length && !reply.content.trim();
  if (empty) {
    emit({
      action: VIBE_ACTIONS.iterationMessage, seq: session.sequence.next(),
      turnKey: scope.turnKey, iterationIndex: scope.iterationIndex,
      message: "The model ended the turn without a reply and without asking for anything.",
    });
  }

  emit({
    action: VIBE_ACTIONS.modelReplied, seq: session.sequence.next(),
    // The decisive one. Two of these would run the decision twice and fan out
    // two sets of tool calls for one reply.
    key: `model.replied:${scope.turnKey}:${scope.iterationIndex}`,
    turnKey: scope.turnKey, iterationIndex: scope.iterationIndex,
    toolCalls: reply.toolCalls.length, answered: !reply.toolCalls.length,
    // Recorded separately from `answered` so the fact log can tell a turn that
    // finished from one that gave up, without changing what the loop does.
    ...(empty ? { empty: true } : {}),
    audience: "worker",
  });

  return { turnKey: scope.turnKey, iterationIndex: scope.iterationIndex, toolCalls: reply.toolCalls.length };
}
