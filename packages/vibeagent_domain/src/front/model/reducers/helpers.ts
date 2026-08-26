import { emptyTool, emptyTurn, type TextBlock, type ToolBlock, type TurnBlock, type TurnView, type VibeSnapshot } from "../state.js";

/**
 * Upserts, because a turn can appear two ways.
 *
 * Submitting one creates it locally first. Replaying a past session does not:
 * the events arrive for turns this model has never seen, and a replay does not
 * promise `turn.started` comes first. Dropping events whose turn is absent
 * would make history invisible, which is exactly what reopening a session is for.
 */
export function patchTurn(snapshot: VibeSnapshot, turnKey: string, patch: (turn: TurnView) => TurnView): VibeSnapshot {
  const existing = snapshot.turns.find((turn) => turn.turnKey === turnKey);
  if (!existing) return { ...snapshot, turns: [...snapshot.turns, patch(emptyTurn(turnKey))] };
  return { ...snapshot, turns: snapshot.turns.map((turn) => (turn.turnKey === turnKey ? patch(turn) : turn)) };
}

/** A block starts at the lowest position any of its events carried. */
function earliest(current: number, seq: number): number {
  return seq < current ? seq : current;
}

/**
 * Files a streamed slice under the block it belongs to.
 *
 * Blocks are identified by kind and iteration, not by position, so a delta that
 * arrives after the next block already opened still lands in the right one. The
 * slice keeps its own `seq` and the text is assembled in that order when read —
 * which is what makes a late arrival a non-event rather than a corruption.
 */
export function appendText(turn: TurnView, kind: TextBlock["kind"], iterationIndex: number, seq: number, text: string): TurnView {
  if (!text) return turn;
  const index = turn.blocks.findIndex((block) => block.kind === kind && block.iterationIndex === iterationIndex);
  if (index < 0) {
    return { ...turn, blocks: [...turn.blocks, { kind, seq, iterationIndex, slices: [{ seq, text }] }] };
  }
  const existing = turn.blocks[index] as TextBlock;
  const next: TurnBlock[] = [...turn.blocks];
  next[index] = { ...existing, seq: earliest(existing.seq, seq), slices: [...existing.slices, { seq, text }] };
  return { ...turn, blocks: next };
}

/**
 * Same reasoning as `patchTurn`, one level down: a chunk may arrive before its
 * `tool.started`, so the block is created by whichever event gets there first.
 */
export function patchTool(turn: TurnView, toolCallKey: string, seq: number, mutate: (tool: ToolBlock) => ToolBlock): TurnView {
  const index = turn.blocks.findIndex((block) => block.kind === "tool" && block.toolCallKey === toolCallKey);
  if (index < 0) return { ...turn, blocks: [...turn.blocks, mutate(emptyTool(toolCallKey, seq))] };
  const existing = turn.blocks[index] as ToolBlock;
  const next: TurnBlock[] = [...turn.blocks];
  next[index] = { ...mutate(existing), seq: earliest(existing.seq, seq) };
  return { ...turn, blocks: next };
}
