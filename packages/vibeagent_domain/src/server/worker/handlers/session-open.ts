import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, VIBE_SESSION_OPEN_ACTION, parseVibeSessionOpenRequest } from "../../../common/index.js";
import { ensureWorkspaceDirectory } from "../../workspace/index.js";
import type { SessionContext, WorkerGlobals } from "../context.js";

export interface SessionOpenOutcome {
  sessionKey: string;
  workspace: string;
  /** False when this open was a repeat of one already recorded. */
  created: boolean;
}

/**
 * Opens a session by fixing the folder it will work in.
 *
 * This is the only place a session acquires a folder, and it can happen once.
 * A second open naming a different folder is refused rather than merged: the
 * turns already recorded ran somewhere, and quietly moving the session would
 * make the transcript describe work that never happened in that directory.
 *
 * The only thing this handler mutates is the `session` it was handed. The
 * absolute path is deliberately absent from the event — where a session's files
 * live on the server is not the client's business.
 */
export async function handleSessionOpen(
  globals: WorkerGlobals,
  session: SessionContext,
  event: EventEnvelope,
  emit: WorkerEmit,
): Promise<SessionOpenOutcome> {
  const payload = event.payload as Record<string, unknown>;
  const request = parseVibeSessionOpenRequest({
    sessionKey: session.sessionKey,
    userId: payload.userId,
    workspace: payload.workspace,
  });
  if (!request) {
    throw new Error(`${VIBE_SESSION_OPEN_ACTION} requires sessionKey, userId and a workspace path inside the projects root`);
  }

  const already = session.workspace;
  if (already && already !== request.workspace) {
    throw new Error(`session ${request.sessionKey} already works in ${already}; a session's folder is immutable`);
  }

  await ensureWorkspaceDirectory(globals.config.workspaceRoot, request.workspace);
  if (already === request.workspace) {
    return { sessionKey: request.sessionKey, workspace: request.workspace, created: false };
  }

  session.openWorkspace(request.workspace);
  emit({ action: VIBE_ACTIONS.sessionOpened, sessionKey: request.sessionKey, workspace: request.workspace, seq: session.nextSeq() });
  return { sessionKey: request.sessionKey, workspace: request.workspace, created: true };
}
