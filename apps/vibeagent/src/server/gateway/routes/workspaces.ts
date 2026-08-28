import express from "express";
import { requireSession, type AuthedRequest } from "agent/broker";
import { normaliseWorkspacePath } from "vibeagent_domain/common";
import { ensureWorkspaceDirectory, listWorkspaceFolders } from "vibeagent_domain/server";
import type { SessionVerifier } from "../verifier.js";
import { workspaceRoot } from "../../config.js";

/**
 * Projects.
 *
 * A project is a folder under the projects root, and a session is created
 * inside one — which is how a session gets its folder without anyone typing a
 * path at session time. Managing folders is not agent work, so it stays on
 * HTTP; the agent conversation is still entirely events.
 */
export function workspaceRoutes(verifier: SessionVerifier): express.Router {
  const router = express.Router();
  const guard = requireSession(verifier);

  router.get("/api/vibe/workspaces", guard, async (_request: AuthedRequest, response) => {
    try { response.json({ workspaces: await listWorkspaceFolders(workspaceRoot) }); }
    catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : "workspace list unavailable" }); }
  });

  router.post("/api/vibe/workspaces", guard, async (request: AuthedRequest, response) => {
    const workspace = normaliseWorkspacePath((request.body as Record<string, unknown> | undefined)?.workspace);
    if (!workspace) { response.status(400).json({ error: "폴더 이름은 영문·숫자로 시작하고 . _ - / 만 쓸 수 있습니다." }); return; }
    try {
      await ensureWorkspaceDirectory(workspaceRoot, workspace);
      response.status(201).json({ workspace });
    } catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : "workspace could not be created" }); }
  });

  return router;
}
