import { VIBE_ACTIONS, type VibeClientAction, type VibeProgressMap } from "../../../common/index.js";
import type { VibeSnapshot } from "../state.js";
import { sessionOpened } from "./session.js";
import { turnFinal, turnStarted } from "./turn.js";
import { iterationMessage, iterationReasoning, iterationStarted } from "./iteration.js";
import { toolCompleted, toolFailed, toolStarted, toolStderr, toolStdout } from "./tool.js";

/**
 * One reducer per event, and nothing else.
 *
 * The client is the same shape as the worker: a table keyed by action, looked
 * up and applied. Every entry here is a pure function of (state, event) — no
 * socket, no storage, no clock. The impure parts live in the model that owns
 * this table and are never reachable from a reducer, which is what makes each
 * one testable with a single literal event.
 *
 * | file | holds |
 * | --- | --- |
 * | `helpers.ts` | the upserts, and the block growing streamed deltas need |
 * | `session.ts` | the session's folder |
 * | `turn.ts` | prompt and final answer |
 * | `iteration.ts` | streamed reasoning and messages |
 * | `tool.ts` | one bash call from start to exit code |
 */
export type Reducer<K extends VibeClientAction> = (snapshot: VibeSnapshot, event: VibeProgressMap[K]) => VibeSnapshot;

export const REDUCERS: { [K in VibeClientAction]: Reducer<K> } = {
  [VIBE_ACTIONS.sessionOpened]: sessionOpened,
  [VIBE_ACTIONS.turnStarted]: turnStarted,
  [VIBE_ACTIONS.iterationStarted]: iterationStarted,
  [VIBE_ACTIONS.iterationReasoning]: iterationReasoning,
  [VIBE_ACTIONS.iterationMessage]: iterationMessage,
  [VIBE_ACTIONS.toolStarted]: toolStarted,
  [VIBE_ACTIONS.toolStdout]: toolStdout,
  [VIBE_ACTIONS.toolStderr]: toolStderr,
  [VIBE_ACTIONS.toolCompleted]: toolCompleted,
  [VIBE_ACTIONS.toolFailed]: toolFailed,
  [VIBE_ACTIONS.turnFinal]: turnFinal,
};

export { patchTurn, patchTool, appendText } from "./helpers.js";
