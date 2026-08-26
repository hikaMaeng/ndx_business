import type { Pool } from "pg";
import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION } from "../../common/index.js";
import { readLoopConfig } from "../config/index.js";
import { SessionStore, ensureSessionSchema } from "../session/index.js";
import { loadSession, sessionKeyOf, type ReactorGlobals, type SessionContext } from "./context.js";
import { openSession } from "./session-open.js";
import { openTurn } from "./turn-open.js";
import { callModel } from "./model-call.js";
import { decideReply } from "./reply-decide.js";
import { runTool } from "./tool-run.js";
import { joinTools } from "./tool-join.js";

/**
 * One reactor per event, and nothing that spans them.
 *
 * ```
 * worker(event) {
 *   reactors[event.action](globals, session, event, emit)
 * }
 * ```
 *
 * There is no loop and no branch across these. Read the table and you will not
 * find the agent's cycle in it: `turn.final` does not follow `model.replied`
 * here, and nothing points back at the model. The cycle exists only in the
 * reaction table the deployment configures, which is why no reactor knows what
 * reacts to what it records.
 *
 * | file | reacts to | records |
 * | --- | --- | --- |
 * | `session-open.ts` | `session.open` | `session.opened` |
 * | `turn-open.ts` | `turn.run` | `turn.started` |
 * | `model-call.ts` | `turn.started`, `iteration.ready` | deltas, `model.replied` |
 * | `reply-decide.ts` | `model.replied` | `turn.final` or `tool.requested` × N |
 * | `tool-run.ts` | `tool.requested` | `tool.started/stdout/completed` |
 * | `tool-join.ts` | `tool.completed` | `iteration.ready`, once all are in |
 */
export interface ReactorInput {
  globals: ReactorGlobals;
  session: SessionContext;
  event: EventEnvelope;
  emit: WorkerEmit;
  signal: AbortSignal;
}

export type Reactor = (input: ReactorInput) => Promise<unknown>;

/** Reactors that run before a session has a folder, and so are handed no session handle. */
const UNSCOPED: Readonly<Record<string, (globals: ReactorGlobals, event: EventEnvelope, emit: WorkerEmit) => Promise<unknown>>> = {
  [VIBE_SESSION_OPEN_ACTION]: openSession,
};

export const REACTORS: Readonly<Record<string, Reactor>> = {
  [VIBE_TURN_ACTION]: ({ globals, session, event, emit }) => openTurn(globals, session, event, emit),
  [VIBE_ACTIONS.turnStarted]: ({ globals, session, event, emit, signal }) => callModel(globals, session, event, emit, signal),
  [VIBE_ACTIONS.iterationReady]: ({ globals, session, event, emit, signal }) => callModel(globals, session, event, emit, signal),
  [VIBE_ACTIONS.modelReplied]: ({ globals, session, event, emit }) => decideReply(globals, session, event, emit),
  [VIBE_ACTIONS.toolRequested]: ({ globals, session, event, emit, signal }) => runTool(globals, session, event, emit, signal),
  [VIBE_ACTIONS.toolCompleted]: ({ globals, session, event, emit }) => joinTools(globals, session, event, emit),
};

/**
 * The worker, as a lookup.
 *
 * An event arrives, its reactor is looked up, it is handed the state it needs,
 * it runs once and it is done. Nothing here knows what comes next.
 */
export function createVibeWorker(pool: Pool): (event: EventEnvelope, signal: AbortSignal, emit: WorkerEmit) => Promise<unknown> {
  const globals: ReactorGlobals = { pool, config: readLoopConfig(), sessions: new SessionStore(pool) };
  const schema = ensureSessionSchema(pool);

  return async (event, signal, emit) => {
    await schema;

    const unscoped = UNSCOPED[event.action];
    if (unscoped) return unscoped(globals, event, emit);

    const react = REACTORS[event.action];
    // A worker that pretends to have handled an unknown action is worse than
    // one that fails loudly.
    if (!react) throw new Error(`No reactor for ${event.action}`);

    const sessionKey = sessionKeyOf(event);
    const session = await loadSession(globals, sessionKey);
    if (!session) throw new Error(`session ${sessionKey} has no working folder; open it with ${VIBE_SESSION_OPEN_ACTION} first`);

    return react({ globals, session, event, emit, signal });
  };
}

export { loadSession, sessionKeyOf, SessionContext, Sequencer, type ReactorGlobals } from "./context.js";
