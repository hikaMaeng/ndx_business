import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventEnvelope } from "agent/common";
import { VibeSessionModel } from "./session.js";
import { textOf, toolsOf } from "./state.js";
import { VIBE_ACTIONS } from "../../common/index.js";

let seq = 0;
function progress(action: string, payload: Record<string, unknown>, eventId = `e${++seq}`): EventEnvelope {
  return { eventId, eventVersion: 1, kind: "progress", streamId: "session:s", sequence: String(seq), action, transactionKey: "t1", channel: "vibe.s", correlationId: "t1", source: "worker", createdAt: new Date().toISOString(), payload } as EventEnvelope;
}
function terminal(ok: boolean, value: unknown, error?: string): EventEnvelope {
  return { ...progress(ok ? "vibe.turn.run.result" : "vibe.turn.run.failure", { ok, ...(value ? { value } : {}), ...(error ? { error: { message: error } } : {}) }), kind: ok ? "result" : "failure" } as EventEnvelope;
}
function model(): VibeSessionModel {
  const instance = new VibeSessionModel();
  instance.startTurn("t1", "build a calculator");
  return instance;
}

test("tool output accumulates across streamed chunks", () => {
  const instance = model();
  instance.apply(progress(VIBE_ACTIONS.toolStarted, { turnKey: "t1", toolCallKey: "c1", command: "ls" }));
  instance.apply(progress(VIBE_ACTIONS.toolStdout, { turnKey: "t1", toolCallKey: "c1", chunk: "one\n" }));
  instance.apply(progress(VIBE_ACTIONS.toolStdout, { turnKey: "t1", toolCallKey: "c1", chunk: "two\n" }));
  const tool = toolsOf(instance.getSnapshot().turns[0]!)[0]!;
  assert.equal(tool.command, "ls");
  assert.equal(textOf(tool.stdout), "one\ntwo\n");
});

test("a redelivered event is absorbed instead of doubling the transcript", () => {
  const instance = model();
  const chunk = progress(VIBE_ACTIONS.toolStdout, { turnKey: "t1", toolCallKey: "c1", chunk: "once\n" }, "same-id");
  instance.apply(chunk);
  instance.apply(chunk);
  assert.equal(textOf(toolsOf(instance.getSnapshot().turns[0]!)[0]!.stdout), "once\n");
});

test("an event without a turn key is dropped rather than guessed at", () => {
  const instance = model();
  instance.apply(progress(VIBE_ACTIONS.toolStdout, { toolCallKey: "c1", chunk: "orphan" }));
  assert.equal(toolsOf(instance.getSnapshot().turns[0]!).length, 0);
});

test("the domain closes a turn, not a reaction's terminal", () => {
  const instance = model();
  // A turn is a chain of reactions and each has its own terminal, so a
  // successful one means that reaction finished — never that the turn did.
  instance.apply(terminal(true, { answer: "done" }));
  assert.equal(instance.getSnapshot().turns[0]!.phase, "running");

  instance.apply(progress(VIBE_ACTIONS.turnFinal, { turnKey: "t1", answer: "done", stoppedBy: "final" }));
  const turn = instance.getSnapshot().turns[0]!;
  assert.equal(turn.phase, "done");
  assert.equal(turn.answer, "done");
});

test("a failed reaction still surfaces, or the chain would stop silently", () => {
  const instance = model();
  instance.apply(terminal(false, undefined, "worker_failed"));
  const turn = instance.getSnapshot().turns[0]!;
  assert.equal(turn.phase, "failed");
  assert.equal(turn.error, "worker_failed");
});

test("the iteration budget closes a turn as done, not as a failure", () => {
  const instance = model();
  instance.apply(progress(VIBE_ACTIONS.turnFinal, { turnKey: "t1", answer: "gave up", stoppedBy: "iteration_budget" }));
  assert.equal(instance.getSnapshot().turns[0]!.phase, "done");
});

test("a replayed session materialises turns the model never submitted", () => {
  const instance = new VibeSessionModel();
  // No startTurn: this is history arriving for a turn this client never sent.
  instance.apply(progress(VIBE_ACTIONS.turnStarted, { turnKey: "old", sessionKey: "s", prompt: "build a calculator" }));
  instance.apply(progress(VIBE_ACTIONS.toolStarted, { turnKey: "old", toolCallKey: "c1", command: "cat > index.html" }));
  instance.apply(progress(VIBE_ACTIONS.toolCompleted, { turnKey: "old", toolCallKey: "c1", exitCode: 0, timedOut: false, durationMs: 12 }));
  const turn = instance.getSnapshot().turns[0]!;
  assert.equal(turn.turnKey, "old");
  assert.equal(turn.prompt, "build a calculator");
  assert.equal(toolsOf(turn)[0]!.exitCode, 0);
});

test("replayed events that arrive before turn.started still land on the right turn", () => {
  const instance = new VibeSessionModel();
  instance.apply(progress(VIBE_ACTIONS.toolStdout, { turnKey: "old", toolCallKey: "c1", chunk: "early\n" }));
  instance.apply(progress(VIBE_ACTIONS.turnStarted, { turnKey: "old", sessionKey: "s", prompt: "late title" }));
  const turn = instance.getSnapshot().turns[0]!;
  assert.equal(turn.prompt, "late title");
  assert.equal(textOf(toolsOf(turn)[0]!.stdout), "early\n");
});
