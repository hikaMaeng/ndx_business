import express from "express";
import { requireSession, type AuthedRequest } from "agent/broker";
import { normaliseWorkspacePath } from "vibeagent_domain/common";
import { ensureProjectDirectory, initialiseRepository, listWorkspaceFolders } from "vibeagent_domain/server";
import type { SessionVerifier } from "../verifier.js";
import { accountBaseUrl, workspaceRoot } from "../../config.js";

/**
 * Projects.
 *
 * A project is a folder under the account that owns it, a git repository from
 * the moment it exists, and a record in Admin saying whose it is and under
 * whose policy it runs. Managing them is not agent work, so it stays on HTTP;
 * the agent conversation is still entirely events.
 */
export function workspaceRoutes(verifier: SessionVerifier): express.Router {
  const router = express.Router();
  const guard = requireSession(verifier);

  /** Admin is the source of truth for accounts, organisations and project records. */
  const admin = async (path: string, token: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetch(`${accountBaseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((payload as { error?: string }).error ?? `admin refused (${response.status})`);
    return payload;
  };

  router.get("/api/vibe/workspaces", guard, async (request: AuthedRequest, response) => {
    try { response.json({ workspaces: await listWorkspaceFolders(workspaceRoot, request.sessionUser!.id) }); }
    catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : "workspace list unavailable" }); }
  });

  router.post("/api/vibe/workspaces", guard, async (request: AuthedRequest, response) => {
    const workspace = normaliseWorkspacePath((request.body as Record<string, unknown> | undefined)?.workspace);
    if (!workspace) { response.status(400).json({ error: "폴더 이름은 영문·숫자로 시작하고 . _ - / 만 쓸 수 있습니다." }); return; }
    const user = request.sessionUser!;
    const organizationId = (request.body as { organizationId?: unknown } | undefined)?.organizationId;

    try {
      /**
       * The record first, the folder second.
       *
       * Admin decides whether the name is free and whether this account may
       * claim the organisation. A folder made before that answer would be a
       * folder nobody owns if the answer is no.
       */
      await admin("/api/projects", request.sessionToken!, {
        method: "POST",
        body: JSON.stringify({ name: workspace, organizationId: typeof organizationId === "string" ? organizationId : null }),
      });

      const directory = await ensureProjectDirectory(workspaceRoot, user.id, workspace);

      // The starting `.gitignore` is Admin's to edit, so it is asked for rather
      // than baked in. A project that cannot reach it is still created — losing
      // a template is not a reason to lose the work that would go in it.
      let gitignore = "";
      try {
        const answer = await admin(`/api/project-defaults/gitignore`, request.sessionToken!) as { file?: { content?: unknown } };
        if (typeof answer.file?.content === "string") gitignore = answer.file.content;
      } catch (error) {
        console.warn(JSON.stringify({ event: "vibe.project.gitignore.unavailable", workspace, error: error instanceof Error ? error.message : String(error) }));
      }

      const repository = await initialiseRepository(directory, {
        gitignore,
        identity: { name: user.email.split("@")[0] ?? user.email, email: user.email },
      });
      response.status(201).json({ workspace, ...repository });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "workspace could not be created" });
    }
  });

  /**
   * The prompts this account may start from, for one project.
   *
   * Not part of the session's context and deliberately so. A prompt is text a
   * person picks, edits and sends — it belongs in the composer, not in front of
   * the transcript, and keeping it out means it never disturbs the cached
   * prefix however long it is.
   *
   * Resolved through the same three layers as everything else, so an
   * organisation can publish a house prompt, an account can keep its own, and a
   * project can have one for the work in hand.
   */
  router.get("/api/vibe/prompts", guard, async (request: AuthedRequest, response) => {
    const workspace = String((request.query as Record<string, unknown>).workspace ?? "");
    if (!workspace) { response.status(400).json({ error: "workspace is required" }); return; }
    try {
      const answer = await admin(`/api/projects/${encodeURIComponent(workspace)}/policy`, request.sessionToken!) as {
        entries?: Array<{ kind: string; name: string; enabled: boolean; value: Record<string, unknown> }>;
      };
      const prompts = (answer.entries ?? [])
        .filter((entry) => entry.kind === "prompt" && entry.enabled)
        .map((entry) => ({
          name: entry.name,
          title: typeof entry.value.title === "string" ? entry.value.title : entry.name,
          body: typeof entry.value.body === "string" ? entry.value.body : "",
        }))
        .filter((prompt) => prompt.body);
      response.json({ prompts });
    } catch (error) {
      // A project with no record has no prompts, which is not a failure — it is
      // the answer. Anything else is worth saying.
      response.json({ prompts: [], note: error instanceof Error ? error.message : "unavailable" });
    }
  });

  return router;
}
