import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, VIBE_SESSION_OPEN_ACTION, parseVibeSessionOpenRequest } from "../../common/index.js";
import { ensureWorkspaceDirectory } from "../workspace/index.js";
import type { ReactorGlobals } from "./context.js";

export interface SessionOpenOutcome {
  sessionKey: string;
  workspace: string;
  /** False when this open was a repeat of one already recorded. */
  created: boolean;
}

/**
 * Opens a session by fixing the folder it will work in.
 *
 * The one reactor with no session handle, because it is what creates the thing
 * the others are handed. Immutability is enforced by the insert rather than by
 * a check followed by a write: a session that exists keeps the folder it was
 * created with, and a second open naming a different one is refused. The turns
 * already recorded ran somewhere, and quietly moving the session would make the
 * transcript describe work that never happened in that directory.
 *
 * The absolute path never leaves the server. The event names the folder under
 * the root; where that is on disk is not the client's business.
 */
export async function openSession(
  globals: ReactorGlobals,
  event: EventEnvelope,
  emit: WorkerEmit,
): Promise<SessionOpenOutcome> {
  const payload = event.payload as Record<string, unknown>;
  const request = parseVibeSessionOpenRequest({
    sessionKey: event.sessionId ?? payload.sessionKey,
    userId: payload.userId,
    workspace: payload.workspace,
  });
  if (!request) {
    throw new Error(`${VIBE_SESSION_OPEN_ACTION} requires sessionKey, userId and a workspace path inside the projects root`);
  }

  await ensureWorkspaceDirectory(globals.config.workspaceRoot, request.workspace);
  const opened = await globals.sessions.open(request.sessionKey, request.workspace);
  if (!opened.created) return { sessionKey: request.sessionKey, workspace: opened.row.workspace, created: false };

  const seq = await globals.sessions.allocateSequence(request.sessionKey, 1);
  emit({ action: VIBE_ACTIONS.sessionOpened, seq, key: `session.opened:${request.sessionKey}`, sessionKey: request.sessionKey, workspace: opened.row.workspace });
  return { sessionKey: request.sessionKey, workspace: opened.row.workspace, created: true };
}
