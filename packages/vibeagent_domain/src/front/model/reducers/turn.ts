import type { VibeTurnFinal, VibeTurnStarted } from "../../../common/index.js";
import type { VibeSnapshot } from "../state.js";
import { patchTurn } from "./helpers.js";

/** The only event carrying the prompt, so a replayed turn gets its title here. */
export function turnStarted(snapshot: VibeSnapshot, event: VibeTurnStarted): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => ({ ...turn, prompt: turn.prompt || event.prompt }));
}

/**
 * The turn is over, and this is what says so.
 *
 * It used to be the broker's terminal result that closed a turn, which worked
 * while one worker ran the whole thing. Now a turn is a chain of reactions and
 * each has its own terminal, so none of them means "the turn ended" — only the
 * domain knows that, and this is the domain saying it.
 */
export function turnFinal(snapshot: VibeSnapshot, event: VibeTurnFinal): VibeSnapshot {
  return patchTurn(snapshot, event.turnKey, (turn) => ({
    ...turn,
    answer: event.answer,
    phase: event.stoppedBy === "error" ? "failed" : "done",
  }));
}
