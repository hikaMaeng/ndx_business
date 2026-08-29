import express from "express";
import { parseSavePolicyRequest } from "admin_domain/common";
import {
  clearPolicy, findProject, listPolicy, requireOrganizationManage, resolvePolicy, setPolicy,
  type AdminDatabase, type PolicyKind,
} from "admin_domain/server";
import type { AuthenticatedRequest } from "../../permission/index.js";
import { body, requireInput } from "../body.js";

/**
 * What a deployment configures: skills, MCP servers, commands, hooks, prompts.
 *
 * Three layers, and the authority differs by layer. An account may write its
 * own entries and its own projects' without asking anyone. An organisation's
 * entry is policy for everybody beneath it, so writing one requires the right
 * to manage that organisation — checked here, because the domain function that
 * stores it deliberately does not know who is calling.
 */
export function registerPolicyRoutes(app: express.Express, database: AdminDatabase): void {
  const actor = (request: AuthenticatedRequest) => ({
    id: request.user!.id,
    master: Boolean(request.user!.isMasterAdmin),
  });

  /**
   * The entries stored in one place, as they were written.
   *
   * Not the resolved set: this is the editing view, and an editor has to see
   * what *this* layer says rather than what survived the merge. `/resolved`
   * below is the other question.
   */
  app.get("/api/policy", async (request: AuthenticatedRequest, response) => {
    const scope = request.query as Record<string, string | undefined>;
    try {
      if (scope.organizationId) {
        const user = actor(request);
        await requireOrganizationManage(database, user.id, scope.organizationId, user.master);
        response.json({ entries: await listPolicy(database, { organizationId: scope.organizationId }) });
        return;
      }
      response.json({
        entries: await listPolicy(database, {
          ownerId: request.user!.id,
          projectId: scope.projectId ?? null,
        }),
      });
    } catch (error) {
      response.status(403).json({ error: error instanceof Error ? error.message : "Policy access failed" });
    }
  });

  /** What one project actually gets, and who decided each of it. */
  app.get("/api/policy/resolved", async (request: AuthenticatedRequest, response) => {
    const name = String((request.query as Record<string, unknown>).project ?? "");
    const project = name ? await findProject(database, request.user!.id, name) : null;
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

  app.put("/api/policy", async (request: AuthenticatedRequest, response) => {
    try {
      const input = requireInput(parseSavePolicyRequest(body(request)));
      const user = actor(request);
      if (input.organizationId) {
        await requireOrganizationManage(database, user.id, input.organizationId, user.master);
      }
      await setPolicy(database, {
        kind: input.kind,
        name: input.name,
        // An account's entry is always the caller's own. Taking the owner from
        // the request would let anyone write into somebody else's layer.
        ...(input.organizationId
          ? { organizationId: input.organizationId }
          : { ownerId: user.id, projectId: input.projectId ?? null }),
        mode: input.mode,
        enabled: input.enabled,
        value: input.value,
      });
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Policy update failed" });
    }
  });

  app.delete("/api/policy", async (request: AuthenticatedRequest, response) => {
    const scope = request.query as Record<string, string | undefined>;
    const kind = scope.kind as PolicyKind | undefined;
    if (!kind || !scope.name) { response.status(400).json({ error: "kind and name are required" }); return; }
    try {
      const user = actor(request);
      if (scope.organizationId) {
        await requireOrganizationManage(database, user.id, scope.organizationId, user.master);
      }
      const removed = await clearPolicy(database, {
        kind,
        name: scope.name,
        ...(scope.organizationId
          ? { organizationId: scope.organizationId }
          : { ownerId: user.id, projectId: scope.projectId ?? null }),
      });
      if (!removed) { response.status(404).json({ error: "no such entry" }); return; }
      response.json({ ok: true });
    } catch (error) {
      response.status(403).json({ error: error instanceof Error ? error.message : "Policy removal failed" });
    }
  });
}
