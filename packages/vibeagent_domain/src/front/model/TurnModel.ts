import { Emitter } from "./Emitter.js";
import { emptyTool, type TextBlock, type ToolBlock, type TurnBlock, type TurnPhase } from "./state.js";

/**
 * One turn, and its own render trigger.
 *
 * This is where the tearing contract earns its keep. A turn arrives as
 * thousands of streamed deltas, and every one of them used to bump a single
 * model that the whole screen subscribed to — so a token of reasoning
 * re-rendered the project list, the session list and every other turn on the
 * page. Giving each turn its own Emitter means a delta reaches exactly the
 * component showing that turn.
 *
 * Fields are mutated in place and followed by `emit()`. There are no immutable
 * copies here: a spread existed only to make a stale equality check notice a
 * change, and the version counter does that job without allocating the tree
 * again on every token.
 */
export class TurnModel extends Emitter {
  blocks: TurnBlock[] = [];
  phase: TurnPhase = "running";
  answer = "";
  error = "";

  /**
   * What the turn did, known without holding what it said.
   *
   * These survive `blocks` being dropped, so a collapsed turn can still be
   * described — "4 iterations, 3 commands" — while costing nothing to keep.
   */
  iterations = 0;
  toolCalls = 0;

  /**
   * Whether `blocks` is this turn's content or an empty placeholder.
   *
   * A finished turn's bodies are dropped once it scrolls out of the way and
   * fetched again if it is reopened. Without this flag an emptied turn and a
   * turn that genuinely did nothing look identical.
   */
  bodiesLoaded = true;

  constructor(readonly turnKey: string, public prompt = "") {
    super();
  }

  /** Every mutation goes through here, so no caller can forget the trigger. */
  change(mutate: (turn: this) => void): void {
    mutate(this);
    this.emit();
  }

  /** A block starts at the lowest position any of its events carried. */
  private static earliest(current: number, seq: number): number {
    return seq < current ? seq : current;
  }

  /**
   * Files a streamed slice under the block it belongs to.
   *
   * Blocks are identified by kind and iteration, not by position, so a delta
   * that arrives after the next block already opened still lands in the right
   * one. The slice keeps its own `seq` and the text is assembled in that order
   * when read — which is what makes a late arrival a non-event rather than a
   * corruption.
   */
  appendText(kind: TextBlock["kind"], iterationIndex: number, seq: number, text: string): void {
    if (!text) return;
    const existing = this.blocks.find(
      (block): block is TextBlock => block.kind === kind && block.iterationIndex === iterationIndex,
    );
    if (!existing) {
      this.blocks.push({ kind, seq, iterationIndex, slices: [{ seq, text }] });
    } else {
      existing.seq = TurnModel.earliest(existing.seq, seq);
      existing.slices.push({ seq, text });
    }
    this.emit();
  }

  /**
   * Same reasoning one level down: a chunk may arrive before its `tool.started`,
   * so the block is created by whichever event gets there first.
   */
  patchTool(toolCallKey: string, seq: number, mutate: (tool: ToolBlock) => void): void {
    let tool = this.blocks.find((block): block is ToolBlock => block.kind === "tool" && block.toolCallKey === toolCallKey);
    if (!tool) {
      tool = emptyTool(toolCallKey, seq);
      this.blocks.push(tool);
    } else {
      tool.seq = TurnModel.earliest(tool.seq, seq);
    }
    mutate(tool);
    this.emit();
  }

  /** Replaces the bodies with what the read model returned. */
  loadBlocks(blocks: readonly TurnBlock[]): void {
    this.change((turn) => {
      turn.blocks = [...blocks];
      turn.bodiesLoaded = true;
    });
  }

  /**
   * Throws the bodies away.
   *
   * This is the point of folding a turn: a long session's cost is the
   * transcript it holds, and a turn nobody is looking at should not be one. The
   * facts are still in the log and the fold is still in the read model, so
   * reopening costs one request.
   *
   * A running turn is never dropped — its bodies are arriving, and there is
   * nothing to fetch them back from yet.
   */
  dropBlocks(): void {
    if (this.phase === "running" || !this.bodiesLoaded) return;
    this.change((turn) => {
      turn.blocks = [];
      turn.bodiesLoaded = false;
    });
  }
}
