import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVibeTurnRequest, isVibeAction, parseVibeProgressEvent, VIBE_ACTIONS } from "./index.js";

test("a turn request needs every identity field the worker cannot invent", () => {
  const complete = { sessionKey: "s", turnKey: "t", userId: "u", prompt: "build it" };
  assert.deepEqual(parseVibeTurnRequest(complete), complete);
  for (const missing of ["sessionKey", "turnKey", "userId", "prompt"]) {
    assert.equal(parseVibeTurnRequest({ ...complete, [missing]: "" }), null, `${missing} must be required`);
    const without: Record<string, unknown> = { ...complete };
    delete without[missing];
    assert.equal(parseVibeTurnRequest(without), null, `${missing} must be required`);
  }
  assert.equal(parseVibeTurnRequest(null), null);
});

test("progress actions are recognised and unrelated actions are not", () => {
  assert.ok(isVibeAction(VIBE_ACTIONS.toolStdout));
  assert.ok(isVibeAction(VIBE_ACTIONS.turnFinal));
  assert.equal(isVibeAction("vibe.turn.run.result"), false);
});

test("a progress event without a turn key cannot be placed and is rejected", () => {
  assert.ok(parseVibeProgressEvent(VIBE_ACTIONS.toolStdout, { turnKey: "t1", toolCallKey: "c", chunk: "x" }));
  assert.equal(parseVibeProgressEvent(VIBE_ACTIONS.toolStdout, { toolCallKey: "c", chunk: "x" }), null);
  assert.equal(parseVibeProgressEvent("some.other.action", { turnKey: "t1" }), null);
});
