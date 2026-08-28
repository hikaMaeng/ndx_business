import type { Pool } from "pg";
import type { EventEnvelope } from "agent/common";
import type { WorkerEmit, WorkerExecute } from "agent/broker/worker";
import { VIBE_ACTIONS, VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION } from "../../common/index.js";
import { readLoopConfig } from "../config/index.js";
import { SessionStore, ensureSessionSchema } from "../session/index.js";
import { ViewStore, ensureViewSchema } from "../view/index.js";
import { loadSession, sessionKeyOf, type ReactorGlobals, type SessionContext } from "./context/index.js";
import { openSession } from "./session-open/index.js";
import { openTurn } from "./turn-open/index.js";
import { callModel } from "./model-call/index.js";
import { decideReply } from "./reply-decide/index.js";
import { runTool } from "./tool-run/index.js";
import { joinTools } from "./tool-join/index.js";
import { projectView } from "./view-project/index.js";

/**
 * One reactor per event, and nothing that spans them.
 *
 * ```
 * worker(event, queue) {
 *   reactors[queue][event.action](globals, session, event, emit)
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
 * | `view-project.ts` | four of the above | nothing — it writes the read model |
 */
export interface ReactorInput {
  globals: ReactorGlobals;
  event: EventEnvelope;
  emit: WorkerEmit;
  signal: AbortSignal;
  queue: string;
  /**
   * Confirms this attempt still owns the execution, and renews it.
   *
   * Only worth asking before something that cannot be taken back. Everything
   * recorded here carries an identity and collapses if written twice, so for
   * those the answer changes nothing — but a command that has already run has
   * already run.
   */
  fence(): Promise<boolean>;
  /**
   * This session's handle, loaded on first ask and not before.
   *
   * Lazy because taking one costs a block of positions off the session row, and
   * a reactor that emits nothing — the projection — would otherwise spend a
   * block per event and contend on the row for no reason. Asking is the
   * declaration that you intend to emit.
   */
  session(): Promise<SessionContext>;
}

export type Reactor = (input: ReactorInput) => Promise<unknown>;

/** What one queue's consumer may be handed, keyed by action. The queue is the address. */
export type ReactorGroup = Readonly<Record<string, Reactor>>;

/**
 * The reactors, grouped the way queues divide them.
 *
 * The grouping matters because a fact can have two readers: `model.replied`
 * wakes the decision on one queue and the projection on another, and the action
 * alone cannot say which job this copy is for. The queue can, so it does.
 *
 * Queue *names* are not here. They belong to the deployment, next to the
 * reaction table that uses them, so this file stays a description of what the
 * domain can do rather than of how one installation is wired.
 */
export const VIBE_REACTOR_GROUPS: Readonly<Record<string, ReactorGroup>> = {
  /** Commands from clients. Nothing else writes to this one. */
  intake: {
    [VIBE_SESSION_OPEN_ACTION]: ({ globals, event, emit }) => openSession(globals, event, emit),
    [VIBE_TURN_ACTION]: async ({ globals, event, emit, session }) => openTurn(globals, await session(), event, emit),
  },
  model: {
    [VIBE_ACTIONS.turnStarted]: async ({ globals, event, emit, signal, session }) => callModel(globals, await session(), event, emit, signal),
    [VIBE_ACTIONS.iterationReady]: async ({ globals, event, emit, signal, session }) => callModel(globals, await session(), event, emit, signal),
  },
  decide: {
    [VIBE_ACTIONS.modelReplied]: async ({ globals, event, emit, session }) => decideReply(globals, await session(), event, emit),
  },
  tool: {
    [VIBE_ACTIONS.toolRequested]: async ({ globals, event, emit, signal, session, fence }) => runTool(globals, await session(), event, emit, signal, fence),
  },
  join: {
    [VIBE_ACTIONS.toolCompleted]: async ({ globals, event, emit, session }) => joinTools(globals, await session(), event, emit),
  },
  /** Reads the log, writes the screen's shape. Emits nothing, so it never asks for a session. */
  view: {
    [VIBE_ACTIONS.turnStarted]: ({ globals, event }) => projectView(globals.view, event),
    [VIBE_ACTIONS.modelReplied]: ({ globals, event }) => projectView(globals.view, event),
    [VIBE_ACTIONS.toolCompleted]: ({ globals, event }) => projectView(globals.view, event),
    [VIBE_ACTIONS.turnFinal]: ({ globals, event }) => projectView(globals.view, event),
  },
};

/**
 * The worker, as a lookup.
 *
 * An event arrives on a queue, its reactor is looked up by the pair, it is
 * handed the state it asks for, it runs once and it is done. Nothing here knows
 * what comes next.
 *
 * `groups` maps each queue this worker watches to the reactors that answer on
 * it. Watching one queue or all of them is the same code; splitting a busy kind
 * onto its own process is a deployment decision, not a change here.
 */
export function createVibeWorker(
  pool: Pool,
  groups: Readonly<Record<string, ReactorGroup>>,
  /**
   * Where a session's skills and project instructions come from.
   *
   * Supplied by the app, because the answer lives in the account service and
   * this package must not learn how to reach it. Left out, sessions open with
   * the built-in prompt and no skills.
   */
  policy?: ReactorGlobals["policy"],
): WorkerExecute {
  const globals: ReactorGlobals = {
    pool, config: readLoopConfig(), sessions: new SessionStore(pool), view: new ViewStore(pool),
    ...(policy ? { policy } : {}),
  };
  const schema = Promise.all([ensureSessionSchema(pool), ensureViewSchema(pool)]);

  return async (event, signal, emit, context) => {
    await schema;

    const { queue, fence } = context;
    const group = groups[queue];
    if (!group) throw new Error(`this worker does not answer on ${queue || "(no queue)"}`);

    const react = group[event.action];
    // A worker that pretends to have handled an unknown action is worse than
    // one that fails loudly.
    if (!react) throw new Error(`no reactor on ${queue} for ${event.action}`);

    let handle: SessionContext | undefined;
    const session = async (): Promise<SessionContext> => {
      if (handle) return handle;
      const sessionKey = sessionKeyOf(event);
      const loaded = await loadSession(globals, sessionKey);
      if (!loaded) throw new Error(`session ${sessionKey} has no working folder; open it with ${VIBE_SESSION_OPEN_ACTION} first`);
      handle = loaded;
      return loaded;
    };

    return react({ globals, event, emit, signal, queue, session, fence });
  };
}

export { loadSession, sessionKeyOf, SessionContext, Sequencer, type ReactorGlobals } from "./context/index.js";
