/**
 * Every action name in the vibe coding vocabulary.
 *
 * Two kinds live here and they are not interchangeable.
 *
 * A **command** is submitted by a client. The broker checks membership in
 * `VIBE_COMMAND_ACTIONS` and understands nothing else about it.
 *
 * A **fact** is what a worker records when it has done its one job. Facts are
 * the only thing workers produce — none of them says "do this next", because a
 * worker that could say that would have to know who does it. What reacts to
 * which fact is a reaction table held by the application, and no worker,
 * broker or dispatcher knows what any of it means.
 */

/**
 * Opening a session.
 *
 * A session cannot exist without a working folder, so opening one is its own
 * command rather than something a turn quietly implies.
 */
export const VIBE_SESSION_OPEN_ACTION = "vibe.session.open" as const;

/** Asking for a turn. */
export const VIBE_TURN_ACTION = "vibe.turn.run" as const;

/** Everything a client may submit. The broker checks membership and nothing else. */
export const VIBE_COMMAND_ACTIONS = [VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION] as const;

export type VibeCommandAction = (typeof VIBE_COMMAND_ACTIONS)[number];

/**
 * Facts. Each is something that already happened, recorded by whoever did it.
 *
 * Read the loop off this list and you will not find it: `turnFinal` does not
 * follow `modelReplied` here, and `iterationReady` does not point back at the
 * model. The cycle exists only in the reaction table.
 */
export const VIBE_ACTIONS = {
  sessionOpened: "vibe.session.opened",

  /** The prompt is in the session's history and the turn is under way. */
  turnStarted: "vibe.turn.started",

  iterationStarted: "vibe.iteration.started",
  iterationReasoning: "vibe.iteration.reasoning",
  iterationMessage: "vibe.iteration.message",

  /** The model answered. Its message is already in the session history. */
  modelReplied: "vibe.model.replied",

  /** The model asked for exactly one command. One fact per call, so N calls fan out. */
  toolRequested: "vibe.tool.requested",
  toolStarted: "vibe.tool.started",
  toolStdout: "vibe.tool.stdout",
  toolStderr: "vibe.tool.stderr",
  /** This one command is finished and its result is in the session history. */
  toolCompleted: "vibe.tool.completed",
  toolFailed: "vibe.tool.failed",

  /** Every tool call this iteration asked for now has a result recorded. */
  iterationReady: "vibe.iteration.ready",

  turnFinal: "vibe.turn.final",
} as const;

export type VibeAction = (typeof VIBE_ACTIONS)[keyof typeof VIBE_ACTIONS];

/**
 * Facts that exist only so another reactor can react.
 *
 * They are recorded with `audience: "worker"`, so the broker never reads them
 * and no client ever sees one. Listing them here is not how that is enforced —
 * the envelope is — but it is how the client's type stops demanding a renderer
 * for something it will never receive.
 */
export const VIBE_WORKER_ACTIONS = [
  VIBE_ACTIONS.modelReplied,
  VIBE_ACTIONS.toolRequested,
  VIBE_ACTIONS.iterationReady,
] as const;

export type VibeWorkerAction = (typeof VIBE_WORKER_ACTIONS)[number];

/** Facts a client renders. Everything else is machinery. */
export type VibeClientAction = Exclude<VibeAction, VibeWorkerAction>;

const WORKER_ONLY: ReadonlySet<string> = new Set<string>(VIBE_WORKER_ACTIONS);

export function isVibeClientAction(action: string): action is VibeClientAction {
  return isVibeAction(action) && !WORKER_ONLY.has(action);
}

export function isVibeAction(action: string): action is VibeAction {
  return (Object.values(VIBE_ACTIONS) as string[]).includes(action);
}

/** Session-scoped facts belong to no turn, so a turn check must not be applied to them. */
export const VIBE_SESSION_SCOPED_ACTIONS: ReadonlySet<string> = new Set<string>([VIBE_ACTIONS.sessionOpened]);
