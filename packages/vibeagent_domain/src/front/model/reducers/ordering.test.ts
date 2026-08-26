import assert from "node:assert/strict";
import { test } from "node:test";
import { VIBE_ACTIONS } from "../../../common/index.js";
import { REDUCERS } from "./index.js";
import { EMPTY_SNAPSHOT, blocksOf, emptyTurn, textOf, toolsOf, type VibeSnapshot } from "../state.js";

/**
 * Nothing here asks the transport for order.
 *
 * The events are applied deliberately out of order, the way a burst of parallel
 * appends actually lands, and the fold still produces the emitter's text. If
 * these pass only when applied in order, the client is relying on something the
 * architecture does not promise.
 */
function fold(events: Array<{ action: keyof typeof REDUCERS extends never ? never : string; payload: Record<string, unknown> }>): VibeSnapshot {
  let snapshot: VibeSnapshot = { ...EMPTY_SNAPSHOT, turns: [emptyTurn("t1", "prompt")] };
  for (const event of events) {
    const reduce = REDUCERS[event.action as keyof typeof REDUCERS] as (state: VibeSnapshot, payload: unknown) => VibeSnapshot;
    snapshot = reduce(snapshot, event.payload);
  }
  return snapshot;
}

const reasoning = (seq: number, text: string) => ({ action: VIBE_ACTIONS.iterationReasoning, payload: { turnKey: "t1", seq, iterationIndex: 0, reasoning: text } });
const stdout = (seq: number, text: string) => ({ action: VIBE_ACTIONS.toolStdout, payload: { turnKey: "t1", seq, toolCallKey: "c1", chunk: text } });

test("streamed reasoning is assembled by sequence, not by arrival", () => {
  const inOrder = fold([reasoning(0, "first "), reasoning(1, "second "), reasoning(2, "third")]);
  const shuffled = fold([reasoning(2, "third"), reasoning(0, "first "), reasoning(1, "second ")]);

  const read = (snapshot: VibeSnapshot): string => {
    const block = blocksOf(snapshot.turns[0]!)[0]!;
    return block.kind === "tool" ? "" : textOf(block.slices);
  };
  assert.equal(read(inOrder), "first second third");
  assert.equal(read(shuffled), "first second third");
});

test("stdout chunks that overtake each other still concatenate correctly", () => {
  const shuffled = fold([stdout(3, "c"), stdout(1, "a"), stdout(2, "b")]);
  assert.equal(textOf(toolsOf(shuffled.turns[0]!)[0]!.stdout), "abc");
});

test("a block keeps the earliest position any of its slices carried", () => {
  // The tool block is created by a chunk that arrived first but was emitted
  // second; the later `tool.started` carries the lower position and wins.
  const snapshot = fold([
    stdout(5, "output"),
    { action: VIBE_ACTIONS.toolStarted, payload: { turnKey: "t1", seq: 4, toolCallKey: "c1", command: "ls" } },
    reasoning(0, "thinking"),
  ]);
  const blocks = blocksOf(snapshot.turns[0]!);
  assert.equal(blocks[0]!.kind, "reasoning");
  assert.equal(blocks[1]!.kind, "tool");
  assert.equal(toolsOf(snapshot.turns[0]!)[0]!.command, "ls");
});

test("reasoning and message from the same iteration stay separate blocks", () => {
  const snapshot = fold([
    reasoning(0, "why"),
    { action: VIBE_ACTIONS.iterationMessage, payload: { turnKey: "t1", seq: 1, iterationIndex: 0, message: "what" } },
  ]);
  const blocks = blocksOf(snapshot.turns[0]!);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((block) => block.kind), ["reasoning", "message"]);
});
