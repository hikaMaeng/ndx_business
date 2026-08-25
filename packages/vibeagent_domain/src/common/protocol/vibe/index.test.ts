import assert from "node:assert/strict";
import { test } from "node:test";
import { parseVibeTurnRequest, isVibeProgressAction, VIBE_PROGRESS_ACTIONS } from "./index.js";

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
  assert.ok(isVibeProgressAction(VIBE_PROGRESS_ACTIONS.toolStdout));
  assert.ok(isVibeProgressAction(VIBE_PROGRESS_ACTIONS.turnFinal));
  assert.equal(isVibeProgressAction("vibe.turn.run.result"), false);
});
