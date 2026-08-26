import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION } from "../../common/index.js";
import type { SessionContext, WorkerGlobals } from "./context.js";
import { handleSessionOpen } from "./handlers/session-open.js";
import { handleTurnRun } from "./handlers/turn-run.js";

/**
 * One entry per action. The worker itself owns no control flow — it looks up
 * the handler for the event it was given, hands it its memory, and is done.
 *
 * Every handler has the same shape and the same discipline: it may change the
 * `session` it received and nothing else. Adding a capability means adding a
 * row here and a file under `handlers/`, not editing a branch inside something
 * that already exists.
 */
export interface HandlerInput {
  globals: WorkerGlobals;
  session: SessionContext;
  event: EventEnvelope;
  emit: WorkerEmit;
  signal: AbortSignal;
}

export type Handler = (input: HandlerInput) => Promise<unknown>;

export const ROUTER: Readonly<Record<string, Handler>> = {
  [VIBE_SESSION_OPEN_ACTION]: ({ globals, session, event, emit }) => handleSessionOpen(globals, session, event, emit),
  [VIBE_TURN_ACTION]: ({ globals, session, event, emit, signal }) => handleTurnRun(globals, session, event, emit, signal),
};
