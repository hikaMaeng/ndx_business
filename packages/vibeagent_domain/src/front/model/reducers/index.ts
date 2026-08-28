import { VIBE_ACTIONS, type VibeClientAction, type VibeProgressMap } from "../../../common/index.js";
import type { VibeSessionModel } from "../VibeSessionModel.js";
import { sessionOpened } from "./session.js";
import { turnFinal, turnStarted } from "./turn.js";
import { iterationMessage, iterationReasoning, iterationStarted } from "./iteration.js";
import { toolCompleted, toolFailed, toolStarted, toolStderr, toolStdout } from "./tool.js";

/**
 * One reducer per event, and nothing else.
 *
 * The client is the same shape as the worker: a table keyed by action, looked
 * up and applied. Every entry is a function of (model, event) with no socket,
 * no storage and no clock — the impure parts live in the model that owns this
 * table and are never reachable from a reducer, which is what makes each one
 * testable with a single literal event.
 *
 * A reducer mutates the one slice its event belongs to and returns nothing.
 * They used to rebuild the whole snapshot immutably, which meant a token of
 * streamed reasoning allocated a new turn list, a new turn, and a new block
 * array — and then told every subscriber on the page that something changed.
 *
 * | file | holds |
 * | --- | --- |
 * | `session.ts` | the session's folder |
 * | `turn.ts` | prompt and final answer |
 * | `iteration.ts` | streamed reasoning and messages |
 * | `tool.ts` | one bash call from start to exit code |
 */
export type Reducer<K extends VibeClientAction> = (model: VibeSessionModel, event: VibeProgressMap[K]) => void;

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
