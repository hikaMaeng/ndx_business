/**
 * The screen's truth, as models rather than as a snapshot.
 *
 * | file | holds |
 * | --- | --- |
 * | `Emitter.ts` | the render trigger. Copied verbatim; do not regenerate |
 * | `SliceModel.ts` | one value plus its own trigger. Every slice is one |
 * | `TurnModel.ts` | one turn, with the trigger a streaming turn needs |
 * | `VibeSessionModel.ts` | the session, decomposed into slices |
 * | `state.ts` | block shapes, and reading text back in emitter order |
 * | `reducers/` | one function per event, mutating the slice it belongs to |
 */
export { Emitter, type Unsubscribe } from "./Emitter.js";
export { SliceModel, type ModelUpdate } from "./SliceModel.js";
export { TurnModel } from "./TurnModel.js";
export { VibeSessionModel, type TurnDigest } from "./VibeSessionModel.js";
export {
  emptyTurn, emptyTool, textOf, blocksOf, toolsOf,
  type TurnView, type TurnBlock, type ToolBlock, type TextBlock, type TextSlice, type TurnPhase,
} from "./state.js";
export { REDUCERS, type Reducer } from "./reducers/index.js";
