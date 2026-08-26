import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_SESSION_OPEN_ACTION, VIBE_TURN_ACTION, parseVibeTurnRequest, type VibeTurnOutcome } from "../../../common/index.js";
import { runTurn, type Emit } from "../../loop/index.js";
import { resolveWorkspaceDirectory } from "../../workspace/index.js";
import type { SessionContext, WorkerGlobals } from "../context.js";

/**
 * Runs one turn in a session that is already open.
 *
 * The working directory comes from the session's memory — that is, from its
 * `vibe.session.opened` fact — and never from the session id. A turn on a
 * session that was never opened is refused rather than given a folder invented
 * on its behalf, which is the whole point of making the folder an explicit,
 * separate property.
 *
 * Numbering is the session's job, not the loop's. The loop emits; this handler
 * stamps each fact with the next position from the one context that owns the
 * counter, which is what keeps a session's sequence consistent no matter how
 * many turns or handlers contribute to it.
 */
export async function handleTurnRun(
  globals: WorkerGlobals,
  session: SessionContext,
  event: EventEnvelope,
  emit: WorkerEmit,
  signal: AbortSignal,
): Promise<VibeTurnOutcome> {
  const payload = event.payload as Record<string, unknown>;
  const request = parseVibeTurnRequest({
    sessionKey: session.sessionKey,
    turnKey: event.turnId ?? event.transactionKey,
    userId: payload.userId,
    prompt: payload.prompt,
  });
  if (!request) throw new Error(`${VIBE_TURN_ACTION} requires sessionKey, turnKey, userId and prompt`);

  const workspace = session.workspace;
  if (!workspace) {
    throw new Error(`session ${request.sessionKey} has no working folder; open it with ${VIBE_SESSION_OPEN_ACTION} first`);
  }

  const numbered: Emit = (fact) => emit({ ...fact, seq: session.nextSeq() });
  const directory = resolveWorkspaceDirectory(globals.config.workspaceRoot, workspace);
  return runTurn(request, globals.config, { relative: workspace, directory }, numbered, signal);
}
