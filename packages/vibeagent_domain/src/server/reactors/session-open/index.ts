import type { EventEnvelope } from "agent/common";
import type { WorkerEmit } from "agent/broker/worker";
import { VIBE_ACTIONS, VIBE_SESSION_OPEN_ACTION, parseVibeSessionOpenRequest } from "../../../common/index.js";
import { ensureWorkspaceDirectory, projectPath } from "../../workspace/index.js";
import { composePrefix, describeContext } from "../../context/index.js";
import { renderSkillIndex } from "../../context/loader.js";
import { mcpSessionData, resolveMcpBindings } from "../../context/mcp.js";
import type { ReactorGlobals } from "../context/index.js";

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

  /**
   * The account half of the path comes from here, never from the request.
   *
   * The broker stamps the verified user over whatever the frame carried, so
   * `request.userId` is the signed-in account and not a claim. Composing the
   * path from it means there is no string a client could send that reaches
   * another account's folder — isolation by construction rather than a check
   * that has to be repeated at every entry point.
   *
   * What is stored is the root-relative path, because everything downstream
   * resolves from the root: the tool's working directory, the artefact server.
   * Clients only ever see the name.
   */
  const workspace = projectPath(request.userId, request.workspace);
  await ensureWorkspaceDirectory(globals.config.workspaceRoot, workspace);
  const opened = await globals.sessions.open(request.sessionKey, workspace);
  if (!opened.created) return { sessionKey: request.sessionKey, workspace: opened.row.workspace, created: false };

  /**
   * The context is fixed here, and never again.
   *
   * Here rather than at the first turn because that is what "the session runs
   * under these instructions" means: a turn is not the unit anything was
   * decided for. Never again because the provider caches by token prefix, so
   * recomposing would discard the cache for the whole transcript, and because
   * changing what a running conversation was told halfway is its own kind of
   * wrong. Configuration that changes after this reaches the next session.
   */
  const policy = await globals.policy?.(request.userId, opened.row.workspace) ?? { skills: [], baseVersion: "builtin" };
  const parts = {
    basePrompt: globals.config.systemPrompt,
    tools: ["bash"] as const,
    projectPath: `${globals.config.workspaceRoot}/${opened.row.workspace}`,
    projectName: opened.row.workspace.split("/").slice(1).join("/") || opened.row.workspace,
    agents: policy.agents ?? "",
  };
  /**
   * The servers each skill asked for, bound to what the deployment configured.
   *
   * What could not be bound is recorded in the recipe rather than thrown: one
   * skill naming a server nobody configured should not stop the session from
   * opening with the others, and "the skill did nothing" reads the same for a
   * missing entry, a disabled one, and one whose URL was mistyped.
   */
  const mcp = resolveMcpBindings(policy.skills, policy.mcp ?? []);
  await globals.sessions.writeContext(
    request.sessionKey,
    composePrefix(parts),
    renderSkillIndex(policy.skills),
    {
      ...describeContext(parts, policy.skills.filter((skill) => skill.enabled), policy.baseVersion),
      mcpServers: mcp.bindings.map((binding) => binding.name),
      mcpProblems: mcp.problems,
    },
    mcpSessionData(mcp),
  );

  const seq = await globals.sessions.allocateSequence(request.sessionKey, 1);
  emit({ action: VIBE_ACTIONS.sessionOpened, seq, key: `session.opened:${request.sessionKey}`, sessionKey: request.sessionKey, workspace: opened.row.workspace });
  return { sessionKey: request.sessionKey, workspace: opened.row.workspace, created: true };
}
