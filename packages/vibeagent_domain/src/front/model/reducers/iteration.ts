import type { VibeIterationMessage, VibeIterationReasoning, VibeIterationStarted } from "../../../common/index.js";
import type { VibeSnapshot } from "../state.js";
import { appendText, patchTurn } from "./helpers.js";

/** Nothing to show yet. The first delta opens the block. */
export function iterationStarted(snapshot: VibeSnapshot, _event: VibeIterationStarted): VibeSnapshot {
  return snapshot;
}

export function iterationReasoning(snapshot: VibeSnapshot, event: VibeIterationReasoning): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => appendText(turn, "reasoning", event.iterationIndex, event.seq, event.reasoning));
}

export function iterationMessage(snapshot: VibeSnapshot, event: VibeIterationMessage): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => appendText(turn, "message", event.iterationIndex, event.seq, event.message));
}
