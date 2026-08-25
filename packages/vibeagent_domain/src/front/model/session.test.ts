import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventEnvelope } from "agent/common";
import { VibeSessionModel } from "./session.js";
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
  const tool = instance.getSnapshot().turns[0]!.tools[0]!;
  assert.equal(tool.command, "ls");
  assert.equal(tool.stdout, "one\ntwo\n");
});

test("a redelivered event is absorbed instead of doubling the transcript", () => {
  const instance = model();
  const chunk = progress(VIBE_ACTIONS.toolStdout, { turnKey: "t1", toolCallKey: "c1", chunk: "once\n" }, "same-id");
  instance.apply(chunk);
  instance.apply(chunk);
  assert.equal(instance.getSnapshot().turns[0]!.tools[0]!.stdout, "once\n");
});

test("an event without a turn key is dropped rather than guessed at", () => {
  const instance = model();
  instance.apply(progress(VIBE_ACTIONS.toolStdout, { toolCallKey: "c1", chunk: "orphan" }));
  assert.equal(instance.getSnapshot().turns[0]!.tools.length, 0);
});

test("only the terminal result closes a turn", () => {
  const instance = model();
  instance.apply(progress(VIBE_ACTIONS.turnFinal, { turnKey: "t1", answer: "done" }));
  assert.equal(instance.getSnapshot().turns[0]!.phase, "running");
  instance.apply(terminal(true, { answer: "done" }));
  assert.equal(instance.getSnapshot().turns[0]!.phase, "done");
});

test("a failed terminal keeps the error visible", () => {
  const instance = model();
  instance.apply(terminal(false, undefined, "worker_failed"));
  const turn = instance.getSnapshot().turns[0]!;
  assert.equal(turn.phase, "failed");
  assert.equal(turn.error, "worker_failed");
});
