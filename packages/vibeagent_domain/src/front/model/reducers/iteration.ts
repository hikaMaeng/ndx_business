import type { VibeIterationMessage, VibeIterationReasoning, VibeIterationStarted } from "../../../common/index.js";
import type { VibeSessionModel } from "../VibeSessionModel.js";

/**
 * Nothing to show yet — the first delta opens the block — but something to count.
 *
 * The count is what a folded turn shows once its bodies have been dropped, and
 * a turn folded while the reader was watching it never passes through the read
 * model. So the same tally is kept here, from the same facts. `max` rather than
 * `+ 1` because a redelivered fact must not inflate it.
 */
export function iterationStarted(model: VibeSessionModel, event: VibeIterationStarted): void {
  model.ensureTurn(event.turnKey).change((turn) => {
    turn.iterations = Math.max(turn.iterations, event.iterationIndex + 1);
  });
}

export function iterationReasoning(model: VibeSessionModel, event: VibeIterationReasoning): void {
  model.ensureTurn(event.turnKey).appendText("reasoning", event.iterationIndex, event.seq, event.reasoning);
}

export function iterationMessage(model: VibeSessionModel, event: VibeIterationMessage): void {
  model.ensureTurn(event.turnKey).appendText("message", event.iterationIndex, event.seq, event.message);
}
