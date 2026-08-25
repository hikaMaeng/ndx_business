import assert from "node:assert/strict";
import { test } from "node:test";
import { VibeSessionModel } from "./session.js";
import { VIBE_PROGRESS_ACTIONS } from "../../common/index.js";

function model(): VibeSessionModel {
  const instance = new VibeSessionModel();
  instance.startTurn("t1", "build a calculator");
  return instance;
}

test("tool output accumulates across streamed chunks", () => {
  const instance = model();
  instance.applyEvent("e1", VIBE_PROGRESS_ACTIONS.toolStarted, { turnKey: "t1", toolCallKey: "c1", command: "ls" });
  instance.applyEvent("e2", VIBE_PROGRESS_ACTIONS.toolStdout, { turnKey: "t1", toolCallKey: "c1", chunk: "one\n" });
  instance.applyEvent("e3", VIBE_PROGRESS_ACTIONS.toolStdout, { turnKey: "t1", toolCallKey: "c1", chunk: "two\n" });
  const tool = instance.getSnapshot().turns[0]!.tools[0]!;
  assert.equal(tool.command, "ls");
  assert.equal(tool.stdout, "one\ntwo\n");
});

test("a redelivered event is absorbed instead of doubling the transcript", () => {
  const instance = model();
  instance.applyEvent("e1", VIBE_PROGRESS_ACTIONS.toolStarted, { turnKey: "t1", toolCallKey: "c1", command: "ls" });
  instance.applyEvent("e2", VIBE_PROGRESS_ACTIONS.toolStdout, { turnKey: "t1", toolCallKey: "c1", chunk: "once\n" });
  instance.applyEvent("e2", VIBE_PROGRESS_ACTIONS.toolStdout, { turnKey: "t1", toolCallKey: "c1", chunk: "once\n" });
  assert.equal(instance.getSnapshot().turns[0]!.tools[0]!.stdout, "once\n");
});

test("only the terminal result closes a turn", () => {
  const instance = model();
  instance.applyEvent("e1", VIBE_PROGRESS_ACTIONS.turnFinal, { turnKey: "t1", answer: "done" });
  assert.equal(instance.getSnapshot().turns[0]!.phase, "running");
  instance.applyTerminal("t1", true, { answer: "done" }, "");
  assert.equal(instance.getSnapshot().turns[0]!.phase, "done");
});

test("a failed terminal keeps the error visible", () => {
  const instance = model();
  instance.applyTerminal("t1", false, undefined, "worker_failed");
  const turn = instance.getSnapshot().turns[0]!;
  assert.equal(turn.phase, "failed");
  assert.equal(turn.error, "worker_failed");
});
