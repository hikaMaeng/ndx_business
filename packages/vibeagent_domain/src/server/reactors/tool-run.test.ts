import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventEnvelope } from "agent/common";
import { VIBE_ACTIONS } from "../../common/index.js";
import { Sequencer, SessionContext, type ReactorGlobals } from "./context.js";
import { runTool } from "./tool-run.js";

/**
 * A command is the one effect in this machine that a key cannot make
 * idempotent. Every other duplicate is a duplicate record and collapses; a
 * duplicated `cat > file` is two writes, and no amount of deduplication
 * afterwards un-writes the first.
 *
 * So the question has to be asked before spawning. These cover that it is.
 */

function stubSession(answer: { content: string; exitCode: number | null } | null, spawned: string[]): SessionContext {
  const store = {
    async toolAnswer() { return answer; },
    async appendMessages(_key: string, messages: readonly { content?: string }[]) { spawned.push(`append:${messages[0]?.content ?? ""}`); },
  };
  return new SessionContext("s1", "proj", store as unknown as SessionContext["store"], new Sequencer(1, 64));
}

const requestEvent = (command: string): EventEnvelope => ({
  eventId: "e1", eventVersion: 1, streamId: "vibe.s1", sequence: "1",
  transactionKey: "t", correlationId: "t", kind: "command", channel: "vibe.s1",
  action: VIBE_ACTIONS.toolRequested, source: "worker", createdAt: new Date().toISOString(),
  payload: { turnKey: "turn-1", iterationIndex: 0, toolCallKey: "turn-1:0:0", toolCallId: "call-a", command },
} as unknown as EventEnvelope);

const globals = { config: { workspaceRoot: "/tmp", toolTimeoutMs: 1_000, maxToolOutputBytes: 1024 } } as unknown as ReactorGlobals;

test("a command that already has a recorded answer is not run again", async () => {
  const effects: string[] = [];
  const emitted: Record<string, unknown>[] = [];
  const answered = { content: "exit_code=0\nstdout:\nhello", exitCode: 0 };

  const result = await runTool(globals, stubSession(answered, effects), requestEvent("echo hello"), (p) => emitted.push(p), new AbortController().signal);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(effects, [], "nothing was appended, so nothing was executed");
  assert.equal(emitted.length, 1, "only the completion is recorded; the command did not start again");
  assert.equal(emitted[0]!.action, VIBE_ACTIONS.toolCompleted);
  assert.equal(emitted[0]!.replayed, true);
});

test("the replayed completion carries the exit code that actually happened", async () => {
  const emitted: Record<string, unknown>[] = [];
  const answered = { content: "exit_code=127\nstderr:\nnot found", exitCode: 127 };

  await runTool(globals, stubSession(answered, []), requestEvent("nope"), (p) => emitted.push(p), new AbortController().signal);

  assert.equal(emitted[0]!.exitCode, 127, "reporting 0 for a command that failed would be a lie the join acts on");
});

test("the completion keeps its identity when replayed, so it collapses with the original", async () => {
  const first: Record<string, unknown>[] = [];
  const second: Record<string, unknown>[] = [];

  await runTool(globals, stubSession({ content: "exit_code=0", exitCode: 0 }, []), requestEvent("ls"), (p) => first.push(p), new AbortController().signal);
  await runTool(globals, stubSession({ content: "exit_code=0", exitCode: 0 }, []), requestEvent("ls"), (p) => second.push(p), new AbortController().signal);

  assert.equal(first[0]!.key, "tool.completed:turn-1:0:0");
  assert.equal(second[0]!.key, first[0]!.key, "the same key means the event store keeps one, not two");
});

test("an empty command is refused without spawning, and still answers the join", async () => {
  const effects: string[] = [];
  const emitted: Record<string, unknown>[] = [];

  await runTool(globals, stubSession(null, effects), requestEvent(""), (p) => emitted.push(p), new AbortController().signal);

  assert.deepEqual(emitted.map((e) => e.action), [VIBE_ACTIONS.toolFailed, VIBE_ACTIONS.toolCompleted]);
  assert.equal(effects.length, 1, "a refusal is still written to the history, or the join waits for ever");
});
