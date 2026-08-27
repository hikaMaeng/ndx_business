/**
 * Events folded into what a screen shows.
 *
 * | file | holds |
 * | --- | --- |
 * | `state.ts` | the snapshot types, and reading text back in emitter order |
 * | `reducers/` | one pure function per event |
 * | `session.ts` | the impure context those reducers run in |
 */
export { VibeSessionModel, type TurnDigest } from "./session.js";
export {
  EMPTY_SNAPSHOT, emptyTurn, emptyTool, textOf, blocksOf, toolsOf,
  type VibeSnapshot, type TurnView, type TurnBlock, type ToolBlock, type TextBlock, type TextSlice, type TurnPhase,
} from "./state.js";
export { REDUCERS, type Reducer } from "./reducers/index.js";
