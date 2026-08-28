import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventEnvelope } from "agent/common";
import { VIBE_ACTIONS, VIBE_TURN_ACTION } from "../../common/index.js";
import { VibeSessionModel } from "./VibeSessionModel.js";
import { textOf, toolsOf } from "./state.js";

/**
 * The point of slicing the model is that a change reaches the components that
 * read it and no others. That is not visible by looking at the screen — a
 * wasteful render and a correct one show the same pixels — so it is asserted
 * here, by counting who was told.
 */

const envelope = (over: Partial<EventEnvelope> & { action: string; payload: Record<string, unknown> }): EventEnvelope => ({
  eventId: `e-${Math.random()}`, eventVersion: 1, streamId: "s", sequence: "1",
  transactionKey: "t", correlationId: "t", kind: "progress", channel: "vibe.s",
  source: "worker", createdAt: new Date().toISOString(),
  ...over,
} as unknown as EventEnvelope);

const reasoning = (turnKey: string, seq: number, text: string) => envelope({
  action: VIBE_ACTIONS.iterationReasoning,
  payload: { turnKey, seq, iterationIndex: 0, reasoning: text },
});

/** Counts notifications on a slice without touching what it holds. */
function counter(slice: { subscribe(fn: () => void): () => void }): () => number {
  let seen = 0;
  slice.subscribe(() => { seen += 1; });
  return () => seen;
}

test("a streamed delta wakes its own turn and nothing else", () => {
  const model = new VibeSessionModel();
  model.startTurn("t1", "first");
  model.startTurn("t2", "second");

  const turns = counter(model.turns);
  const workspace = counter(model.workspace);
  const other = counter(model.turn("t2")!);
  const mine = counter(model.turn("t1")!);

  for (let i = 0; i < 20; i += 1) model.apply(reasoning("t1", i, "x"));

  assert.equal(mine(), 20, "the turn being streamed is the one that re-renders");
  assert.equal(other(), 0, "another turn on the same screen is not woken");
  assert.equal(turns(), 0, "the turn list did not change, so the transcript is not rebuilt");
  assert.equal(workspace(), 0, "nor is anything reading the session's folder");
});

test("adding a turn wakes the list, not the turns already in it", () => {
  const model = new VibeSessionModel();
  model.startTurn("t1", "first");
  const first = counter(model.turn("t1")!);
  const turns = counter(model.turns);

  model.startTurn("t2", "second");

  assert.equal(turns(), 1);
  assert.equal(first(), 0, "an existing turn has not changed just because a new one appeared");
});

test("text is assembled in the emitter's order, whatever order it arrived in", () => {
  const model = new VibeSessionModel();
  model.startTurn("t1");
  model.apply(reasoning("t1", 2, "third"));
  model.apply(reasoning("t1", 0, "first "));
  model.apply(reasoning("t1", 1, "second "));

  const block = model.turn("t1")!.blocks[0]!;
  assert.equal(block.kind === "tool" ? "" : textOf(block.slices), "first second third");
});

test("a repeated delivery is not applied twice", () => {
  const model = new VibeSessionModel();
  model.startTurn("t1");
  const once = reasoning("t1", 0, "hello");
  model.apply(once);
  model.apply(once);

  const block = model.turn("t1")!.blocks[0]!;
  assert.equal(block.kind === "tool" ? "" : textOf(block.slices), "hello");
});

test("an event for a turn the model never saw creates it, so replay is visible", () => {
  const model = new VibeSessionModel();
  model.apply(reasoning("unseen", 0, "from history"));
  assert.equal(model.turns.value.length, 1);
  assert.equal(model.turn("unseen")?.turnKey, "unseen");
});

test("a tool block is created by whichever of its events arrives first", () => {
  const model = new VibeSessionModel();
  model.startTurn("t1");
  // The chunk lands before `tool.started`, which is legal: they are one
  // reactor's burst, not a causal chain.
  model.apply(envelope({ action: VIBE_ACTIONS.toolStdout, payload: { turnKey: "t1", seq: 5, toolCallKey: "c1", chunk: "out" } }));
  model.apply(envelope({ action: VIBE_ACTIONS.toolStarted, payload: { turnKey: "t1", seq: 4, toolCallKey: "c1", command: "ls" } }));

  const tool = toolsOf(model.turn("t1")!)[0]!;
  assert.equal(tool.command, "ls");
  assert.equal(textOf(tool.stdout), "out");
  assert.equal(tool.seq, 4, "the block keeps the lowest position any of its events carried");
});

test("a refused session open surfaces on the session, not on a turn", () => {
  const model = new VibeSessionModel();
  const failure = envelope({
    action: `${VIBE_TURN_ACTION}.result`, kind: "result",
    payload: { ok: false, error: { message: "folder is not usable" } },
  });
  model.apply(failure);

  assert.equal(model.sessionError.value, "folder is not usable");
  assert.equal(model.turns.value.length, 0, "there is no turn to blame it on");
});

test("a failed reaction marks its turn failed rather than leaving it running", () => {
  const model = new VibeSessionModel();
  model.startTurn("t1", "prompt");
  model.apply(envelope({
    action: `${VIBE_ACTIONS.turnStarted}.result`, kind: "result", turnId: "t1",
    payload: { ok: false, error: { message: "inference endpoint returned no choices" } },
  }));

  const turn = model.turn("t1")!;
  assert.equal(turn.phase, "failed");
  assert.equal(turn.error, "inference endpoint returned no choices");
});

test("hydrating keeps a live turn and does not replace it with a stale digest", () => {
  const model = new VibeSessionModel();
  model.startTurn("live", "still going");
  model.apply(reasoning("live", 0, "thinking"));

  model.hydrate([{ turnKey: "old", prompt: "earlier", phase: "done", answer: "a", error: "", iterations: 2, toolCalls: 1 }]);

  assert.deepEqual(model.turns.value.map((turn) => turn.turnKey), ["old", "live"]);
  assert.equal(model.turn("old")!.bodiesLoaded, false, "a digest carries no bodies");
  assert.equal(model.turn("live")!.blocks.length, 1, "the live turn kept what it had streamed");
});

test("a running turn refuses to drop its bodies", () => {
  const model = new VibeSessionModel();
  model.startTurn("t1");
  model.apply(reasoning("t1", 0, "mid-flight"));

  model.dropBlocks("t1");

  assert.equal(model.turn("t1")!.blocks.length, 1, "they are arriving; there is nothing to fetch them back from");
});
