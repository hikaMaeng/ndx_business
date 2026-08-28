/** What a screen shows. Every field here is produced by folding events, nothing else. */

export type TurnPhase = "idle" | "running" | "done" | "failed";

/**
 * A piece of streamed text with the position the worker gave it.
 *
 * Arrival order is not trusted anywhere here. A burst of deltas from one
 * handler is not a causal chain — nothing was received and processed to produce
 * the next one — so the only thing that can order them is a number the emitter
 * put in the event. Everything is placed by `seq`, never by when it showed up.
 */
export interface TextSlice { seq: number; text: string }

/**
 * One thing the agent did.
 *
 * A single list rather than parallel arrays of reasoning, messages and tools,
 * because the shape of a turn — think, run, look, think again — is the thing
 * that explains it. `kind` is what the screen labels, so a reader can tell the
 * model's private reasoning from what it said to them from what it asked the
 * machine to run: three very different claims that look alike as plain text.
 */
export type TurnBlock =
  | { kind: "reasoning" | "message"; seq: number; iterationIndex: number; slices: TextSlice[] }
  | {
      kind: "tool";
      seq: number;
      toolCallKey: string;
      command: string;
      stdout: TextSlice[];
      stderr: TextSlice[];
      exitCode: number | null;
      timedOut: boolean;
      durationMs: number;
      done: boolean;
      failure: string;
    };

export type ToolBlock = Extract<TurnBlock, { kind: "tool" }>;
export type TextBlock = Extract<TurnBlock, { kind: "reasoning" | "message" }>;

/**
 * What a turn holds, as data.
 *
 * `TurnModel` implements this and adds the render trigger. The interface exists
 * so pure readers — `blocksOf`, `toolsOf`, a renderer — can take a turn without
 * taking a dependency on the Emitter machinery.
 */
export interface TurnView {
  turnKey: string;
  prompt: string;
  phase: TurnPhase;
  blocks: TurnBlock[];
  answer: string;
  error: string;
  /**
   * What the turn did, known without holding what it said.
   *
   * These come from the read model and survive `blocks` being thrown away, so a
   * collapsed turn can still be described — "4 iterations, 3 commands" — while
   * costing nothing to keep. They are counts of the same facts the blocks are
   * folded from, not a second opinion about them.
   */
  iterations: number;
  toolCalls: number;
  /**
   * Whether `blocks` is the turn's content or an empty placeholder.
   *
   * A finished turn's bodies are dropped once it scrolls out of the way and
   * fetched again if it is reopened. Without this flag an emptied turn and a
   * turn that genuinely did nothing look identical.
   */
  bodiesLoaded: boolean;
}

export function emptyTurn(turnKey: string, prompt = ""): TurnView {
  return { turnKey, prompt, phase: "running", blocks: [], answer: "", error: "", iterations: 0, toolCalls: 0, bodiesLoaded: true };
}

export function emptyTool(toolCallKey: string, seq: number): ToolBlock {
  return { kind: "tool", seq, toolCallKey, command: "", stdout: [], stderr: [], exitCode: null, timedOut: false, durationMs: 0, done: false, failure: "" };
}

/** Slices joined in the emitter's order, whatever order they arrived in. */
export function textOf(slices: readonly TextSlice[]): string {
  return [...slices].sort((left, right) => left.seq - right.seq).map((slice) => slice.text).join("");
}

/** Blocks in the emitter's order. */
export function blocksOf(turn: TurnView): TurnBlock[] {
  return [...turn.blocks].sort((left, right) => left.seq - right.seq);
}

/** Convenience for callers that only care about the commands a turn ran. */
export function toolsOf(turn: TurnView): ToolBlock[] {
  return blocksOf(turn).filter((block): block is ToolBlock => block.kind === "tool");
}
