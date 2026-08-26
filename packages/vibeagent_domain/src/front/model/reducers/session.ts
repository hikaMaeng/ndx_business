import type { VibeSessionOpened } from "../../../common/index.js";
import type { VibeSnapshot } from "../state.js";

/**
 * The session's folder, learned from the log rather than assumed.
 *
 * The client proposed it when opening the session, but what it renders is the
 * fact the worker recorded — so a reopened session shows the folder it actually
 * works in even in a browser that never opened it.
 */
export function sessionOpened(snapshot: VibeSnapshot, event: VibeSessionOpened): VibeSnapshot {
  return { ...snapshot, workspace: event.workspace };
}
