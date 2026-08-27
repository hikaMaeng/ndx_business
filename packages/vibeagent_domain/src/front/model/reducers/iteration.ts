import type { VibeIterationMessage, VibeIterationReasoning, VibeIterationStarted } from "../../../common/index.js";
import type { VibeSnapshot } from "../state.js";
import { appendText, patchTurn } from "./helpers.js";

/**
 * Nothing to show yet — the first delta opens the block — but something to count.
 *
 * The count is what a folded turn shows once its bodies have been dropped, and
 * a turn folded while the reader was watching it never passes through the read
 * model. So the same tally is kept here, from the same facts. `max` rather than
 * `+ 1` because a redelivered fact must not inflate it.
 */
export function iterationStarted(snapshot: VibeSnapshot, event: VibeIterationStarted): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => ({ ...turn, iterations: Math.max(turn.iterations, event.iterationIndex + 1) }));
}

export function iterationReasoning(snapshot: VibeSnapshot, event: VibeIterationReasoning): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => appendText(turn, "reasoning", event.iterationIndex, event.seq, event.reasoning));
}

export function iterationMessage(snapshot: VibeSnapshot, event: VibeIterationMessage): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => appendText(turn, "message", event.iterationIndex, event.seq, event.message));
}
