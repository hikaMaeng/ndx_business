import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventEnvelope } from "agent/common";
import { VIBE_ACTIONS } from "../../common/index.js";
import { Sequencer, SessionContext, type ReactorGlobals } from "./context.js";
import { decideReply } from "./reply-decide.js";
import type { ChatToolCall } from "../llm/index.js";

/**
 * The only judgement in the machine: was that the answer, or a request to run
 * something? Everything else in the chain is bookkeeping, so this is the piece
 * whose mistakes change what the agent does rather than how it is recorded.
 */

function stubSession(reply: { content: string; toolCalls: ChatToolCall[] } | null): SessionContext {
  const store = { async lastAssistantMessage() { return reply; } };
  return new SessionContext("s1", "proj", store as unknown as SessionContext["store"], new Sequencer(1, 64));
}

const call = (id: string, command: unknown): ChatToolCall => ({
  id, type: "function", function: { name: "bash", arguments: JSON.stringify({ command }) },
} as ChatToolCall);

const repliedEvent = (iterationIndex: number): EventEnvelope => ({
  eventId: "e1", eventVersion: 1, streamId: "vibe.s1", sequence: "1",
  transactionKey: "t", correlationId: "t", kind: "progress", channel: "vibe.s1",
  action: VIBE_ACTIONS.modelReplied, source: "worker", createdAt: new Date().toISOString(),
  payload: { turnKey: "turn-1", iterationIndex },
} as unknown as EventEnvelope);

const globals = (maxIterations: number): ReactorGlobals => ({ config: { maxIterations } } as unknown as ReactorGlobals);

test("a reply with no tool calls ends the turn", async () => {
  const emitted: Record<string, unknown>[] = [];
  const result = await decideReply(globals(24), stubSession({ content: "  done  ", toolCalls: [] }), repliedEvent(0), (p) => emitted.push(p));

  assert.equal(result.final, true);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]!.action, VIBE_ACTIONS.turnFinal);
  assert.equal(emitted[0]!.answer, "done");
  assert.equal(emitted[0]!.stoppedBy, "final");
});

test("N tool calls become N separate facts, so they can be run by N workers", async () => {
  const emitted: Record<string, unknown>[] = [];
  const reply = { content: "", toolCalls: [call("a", "ls"), call("b", "pwd"), call("c", "whoami")] };
  const result = await decideReply(globals(24), stubSession(reply), repliedEvent(0), (p) => emitted.push(p));

  assert.equal(result.toolCalls, 3);
  assert.equal(emitted.length, 3);
  assert.ok(emitted.every((e) => e.action === VIBE_ACTIONS.toolRequested));
  assert.deepEqual(emitted.map((e) => e.command), ["ls", "pwd", "whoami"]);
  // Distinct and derived from position, so a replayed decision addresses the
  // same logical calls rather than inventing new ones.
  assert.deepEqual(emitted.map((e) => e.toolCallKey), ["turn-1:0:0", "turn-1:0:1", "turn-1:0:2"]);
  assert.deepEqual(emitted.map((e) => e.toolCallId), ["a", "b", "c"]);
});

test("each requested call gets its own position, so the client can order them", async () => {
  const emitted: Record<string, unknown>[] = [];
  await decideReply(globals(24), stubSession({ content: "", toolCalls: [call("a", "ls"), call("b", "pwd")] }), repliedEvent(0), (p) => emitted.push(p));

  const positions = emitted.map((e) => e.seq as number);
  assert.equal(new Set(positions).size, positions.length);
});

test("the iteration budget ends the turn instead of asking for more work", async () => {
  const emitted: Record<string, unknown>[] = [];
  const reply = { content: "", toolCalls: [call("a", "ls")] };
  const result = await decideReply(globals(3), stubSession(reply), repliedEvent(2), (p) => emitted.push(p));

  assert.equal(result.final, true);
  assert.equal(result.toolCalls, 0, "the budget stops the turn rather than requesting the call");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]!.action, VIBE_ACTIONS.turnFinal);
  assert.equal(emitted[0]!.stoppedBy, "iteration_budget");
});

test("unparseable tool arguments still produce a fact, so the join is not left waiting", async () => {
  const emitted: Record<string, unknown>[] = [];
  const broken = { id: "a", type: "function", function: { name: "bash", arguments: "{not json" } } as ChatToolCall;
  await decideReply(globals(24), stubSession({ content: "", toolCalls: [broken] }), repliedEvent(0), (p) => emitted.push(p));

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]!.command, "", "an empty command is refused downstream, and refusing still answers");
});

test("a missing assistant message is treated as an answer, not as silence", async () => {
  const emitted: Record<string, unknown>[] = [];
  const result = await decideReply(globals(24), stubSession(null), repliedEvent(0), (p) => emitted.push(p));

  assert.equal(result.final, true);
  assert.equal(emitted[0]!.action, VIBE_ACTIONS.turnFinal);
});
