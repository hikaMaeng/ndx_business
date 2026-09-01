import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, parseIterationScope } from "../../../common/index.js";
import { chat } from "../../llm/index.js";
import type { ChatMessage } from "../../llm/index.js";
import { BASH_TOOL_SCHEMA } from "../../tools/bash/index.js";
import type { LoopConfig } from "../../config/index.js";
import type { ReactorGlobals, SessionContext, SessionInference } from "../context/index.js";

/**
 * The resolved model over the container's, without the container's credential
 * following it to somebody else's host.
 *
 * Merged rather than substituted because a resolution answers which model and
 * how to sample it and nothing else: the timeouts, the token budget and the
 * flush interval are still the deployment's, and replacing the whole object
 * would leave a session with none of them.
 *
 * The key is the exception. An endpoint that registered no header wants no
 * authorization, and spreading a resolution without one over a configuration
 * that has one would send the deployment's bearer token to whatever host an
 * organisation nominated. Kept only when the endpoint has not moved.
 *
 * Exported for its own test. The call around it cannot be tested — `chat` talks
 * to a real endpoint — and this is the part of it that can be got wrong quietly.
 */
export function withInference(config: LoopConfig, chosen: SessionInference): LoopConfig {
  const merged = { ...config, ...chosen };
  if (!chosen.apiKey && chosen.baseUrl !== config.baseUrl) delete merged.apiKey;
  return merged;
}

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

  /**
   * Which model, asked now rather than remembered.
   *
   * The container's configuration is a fallback, not the answer: it is the same
   * for every session on the machine, and which model an agent runs on is a
   * decision an organisation makes. Asked immediately before the call so the
   * decision that applies is the one in force at the call — a request carries
   * no model, and the session does not hold one either.
   *
   * No resolver, or nothing resolved, means the deployment registered no models
   * and the container's own endpoint is all there is. That is a fresh install,
   * not a failure, and it should still be able to answer.
   */
  const chosen = await globals.inference?.(session.workspace) ?? null;
  const config = chosen ? withInference(globals.config, chosen) : globals.config;

  /**
   * The fact says which model, and who chose it.
   *
   * Per iteration rather than per session, because the resolution is per call
   * now: an organisation that changes its model mid-session changes it for the
   * next iteration, and a transcript claiming one model for a whole turn would
   * describe something that did not happen.
   *
   * "Which model wrote this" is the question that follows every surprise, and
   * with the resolution stored nowhere there is nothing else left to ask.
   * `modelOrganizationId` comes along because a model name does not say which
   * level of an org chart supplied it, and that is the half nobody can work out
   * for themselves.
   */
  emit({
    action: VIBE_ACTIONS.iterationStarted, seq: session.sequence.next(),
    key: `iteration.started:${scope.turnKey}:${scope.iterationIndex}`,
    turnKey: scope.turnKey, iterationIndex: scope.iterationIndex,
    model: config.model,
    ...(chosen ? { modelOrganizationId: chosen.organizationId } : {}),
  });

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
