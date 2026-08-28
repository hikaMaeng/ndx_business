import express from "express";
import { parseCreateProjectRequest } from "admin_domain/common";
import {
  createProject, deleteProject, findProject, listProjects, listProjectsByOrganization,
  readProjectDefault, resolvePolicy, type AdminDatabase,
} from "admin_domain/server";
import type { AuthenticatedRequest } from "../../permission/index.js";
import { body, requireInput } from "../body.js";

/**
 * Projects, as records.
 *
 * The folder lives on the coding agent's volume; this is the half that says
 * whose it is and under whose policy it runs. Admin owns it because Admin owns
 * accounts and organisations, and a project points at both.
 */
export function registerProjectRoutes(app: express.Express, database: AdminDatabase): void {
  app.get("/api/projects", async (request: AuthenticatedRequest, response) => {
    response.json({ projects: await listProjects(database, request.user!.id) });
  });

  app.post("/api/projects", async (request: AuthenticatedRequest, response) => {
    try {
      const input = requireInput(parseCreateProjectRequest(body(request)));
      // The owner is the signed-in account, never a field in the request.
      response.status(201).json(await createProject(database, {
        ownerId: request.user!.id,
        organizationId: input.organizationId ?? null,
        name: input.name,
      }));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Project creation failed" });
    }
  });

  app.delete("/api/projects/:name", async (request: AuthenticatedRequest, response) => {
    const removed = await deleteProject(database, request.user!.id, String(request.params.name));
    if (!removed) { response.status(404).json({ error: "no such project" }); return; }
    response.json({ ok: true });
  });

  /**
   * What one session may use, and who decided each of it.
   *
   * Asked for by the coding agent when it opens a session, on behalf of the
   * account signing in. The account is the caller, never a parameter — reading
   * somebody else's policy would be reading their organisation's.
   */
  app.get("/api/projects/:name/policy", async (request: AuthenticatedRequest, response) => {
    const project = await findProject(database, request.user!.id, String(request.params.name));
    if (!project) { response.status(404).json({ error: "no such project" }); return; }
    response.json({
      project,
      entries: await resolvePolicy(database, {
        ownerId: request.user!.id,
        organizationId: project.organizationId,
        projectId: project.id,
      }),
    });
  });

  /** The organisation's side: whose projects are running under it, and under its subtree. */
  app.get("/api/organizations/:id/projects", async (request, response) => {
    response.json({ projects: await listProjectsByOrganization(database, String(request.params.id)) });
  });
}
