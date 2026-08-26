/**
 * Every action name in the vibe coding vocabulary.
 *
 * Two kinds live here and they are not interchangeable. A **command** is
 * submitted by a client, goes on the PGMQ queue and is handled by exactly one
 * worker. A **fact** is appended to the log and read by every client watching
 * the channel. The broker checks command membership and understands neither.
 */

/**
 * Opening a session.
 *
 * A session cannot exist without a working folder, so opening one is its own
 * command rather than something a turn quietly implies.
 */
export const VIBE_SESSION_OPEN_ACTION = "vibe.session.open" as const;

/** Running one turn in an already-opened session. */
export const VIBE_TURN_ACTION = "vibe.turn.run" as const;

/** Everything a client may submit. The broker checks membership and nothing else. */
export const VIBE_COMMAND_ACTIONS = [VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION] as const;

export type VibeCommandAction = (typeof VIBE_COMMAND_ACTIONS)[number];

/** Facts the worker appends. Everything a client renders comes from this list. */
export const VIBE_ACTIONS = {
  sessionOpened: "vibe.session.opened",
  turnStarted: "vibe.turn.started",
  iterationStarted: "vibe.iteration.started",
  iterationReasoning: "vibe.iteration.reasoning",
  iterationMessage: "vibe.iteration.message",
  toolStarted: "vibe.tool.started",
  toolStdout: "vibe.tool.stdout",
  toolStderr: "vibe.tool.stderr",
  toolCompleted: "vibe.tool.completed",
  toolFailed: "vibe.tool.failed",
  turnFinal: "vibe.turn.final",
} as const;

export type VibeAction = (typeof VIBE_ACTIONS)[keyof typeof VIBE_ACTIONS];

export function isVibeAction(action: string): action is VibeAction {
  return (Object.values(VIBE_ACTIONS) as string[]).includes(action);
}

/** Session-scoped facts belong to no turn, so a turn check must not be applied to them. */
export const VIBE_SESSION_SCOPED_ACTIONS: ReadonlySet<string> = new Set<string>([VIBE_ACTIONS.sessionOpened]);
