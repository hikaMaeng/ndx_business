import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignMember,
  assignResponsible,
  createOrganization,
  createModelDefinition,
  createModelEndpoint,
  deleteOrganization,
  getSettings,
  listOrganizationAccounts,
  listOrganizations,
  listModelCatalog,
  listPendingUsers,
  listUsers,
  login,
  openAuthDatabase,
  readSettings,
  removeMember,
  removeResponsible,
  revokeSession,
  revokeSessionById,
  saveSettings,
  setUserStatus,
  signup,
  refreshModelEndpoint,
  updateModelDefinition,
  updateModelEndpoint,
  updateOrganization,
} from "admin_domain/server";
import type { DatabaseSync } from "node:sqlite";
import { apiPermissionMiddleware, type AuthenticatedRequest } from "./permission/index.js";

function body(request: express.Request): Record<string, unknown> {
  return request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
}

export function createApp(database: DatabaseSync = openAuthDatabase(process.env.AUTH_DATABASE_PATH ?? "./data/admin.sqlite")) {
  const app = express();
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const frontDir = path.resolve(serverDir, "../front");

  const health = (_request: express.Request, response: express.Response) => {
    response.json({
      status: "ok",
      service: "admin"
    });
  };

  app.use(express.json({ limit: "64kb" }));
  app.use(apiPermissionMiddleware(database));
  app.get("/health", health);
  app.get("/api/health", health);
  app.post("/api/auth/signup", (request, response) => {
    try {
      const input = body(request);
      response.status(201).json(signup(database, String(input.email ?? ""), String(input.password ?? ""), (input.metadata ?? {}) as Record<string, unknown>));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Signup failed" });
    }
  });
  app.post("/api/auth/login", (request, response) => {
    try {
      const input = body(request);
      const result = login(database, String(input.email ?? ""), String(input.password ?? ""), (input.metadata ?? {}) as Record<string, unknown>);
      const settings = readSettings(database);
      response.setHeader("Set-Cookie", `${settings.sessionCookieName}=${result.sessionToken}; HttpOnly; Path=/; SameSite=Lax`);
      response.json(result);
    } catch (error) {
      response.status(401).json({ error: error instanceof Error ? error.message : "Login failed" });
    }
  });

  app.post("/api/auth/logout", (request: AuthenticatedRequest, response) => {
    revokeSession(database, request.sessionToken!);
    response.json({ ok: true });
  });
  app.get("/api/organizations", (request: AuthenticatedRequest, response) => response.json(listOrganizations(database, request.user!.id, Boolean(request.user!.isMasterAdmin))));
  app.get("/api/organizations/users", (request: AuthenticatedRequest, response) => { try { response.json(listOrganizationAccounts(database, request.user!.id, Boolean(request.user!.isMasterAdmin))); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Organization account access failed" }); } });
  app.post("/api/organizations", (request: AuthenticatedRequest, response) => { try { response.status(201).json(createOrganization(database, request.user!.id, Boolean(request.user!.isMasterAdmin), body(request) as never)); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Organization update failed" }); } });
  app.put("/api/organizations/:id", (request: AuthenticatedRequest, response) => { try { response.json(updateOrganization(database, request.user!.id, Boolean(request.user!.isMasterAdmin), String(request.params.id), body(request) as never)); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Organization update failed" }); } });
  app.post("/api/organizations/:id/members", (request: AuthenticatedRequest, response) => { try { response.json(assignMember(database, request.user!.id, Boolean(request.user!.isMasterAdmin), String(request.params.id), body(request) as never)); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Member assignment failed" }); } });
  app.delete("/api/organizations/:id/members/:userId", (request: AuthenticatedRequest, response) => { try { response.json(removeMember(database, request.user!.id, Boolean(request.user!.isMasterAdmin), String(request.params.id), String(request.params.userId))); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Member removal failed" }); } });
  app.post("/api/organizations/:id/responsibilities", (request: AuthenticatedRequest, response) => { try { response.json(assignResponsible(database, request.user!.id, Boolean(request.user!.isMasterAdmin), String(request.params.id), body(request) as never)); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Responsibility assignment failed" }); } });
  app.delete("/api/organizations/:id/responsibilities/:userId", (request: AuthenticatedRequest, response) => { try { response.json(removeResponsible(database, request.user!.id, Boolean(request.user!.isMasterAdmin), String(request.params.id), String(request.params.userId))); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Responsibility removal failed" }); } });
  app.delete("/api/organizations/:id", (request: AuthenticatedRequest, response) => { try { response.json(deleteOrganization(database, request.user!.id, Boolean(request.user!.isMasterAdmin), String(request.params.id))); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Organization deletion failed" }); } });
  app.get("/api/auth/me", (request: AuthenticatedRequest, response) => response.json(request.user));
  app.get("/api/models", (_request, response) => response.json(listModelCatalog(database)));
  app.post("/api/models", (request, response) => {
    try {
      response.status(201).json(createModelEndpoint(database, body(request) as never));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Model endpoint creation failed" });
    }
  });
  app.put("/api/models/:endpointId", (request, response) => {
    try {
      response.json(updateModelEndpoint(database, String(request.params.endpointId), body(request) as never));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Model endpoint update failed" });
    }
  });
  app.post("/api/models/:endpointId/refresh", async (request, response) => {
    try {
      response.json(await refreshModelEndpoint(database, String(request.params.endpointId)));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Model refresh failed" });
    }
  });
  app.post("/api/models/:endpointId/models", (request, response) => {
    try {
      response.status(201).json(createModelDefinition(database, String(request.params.endpointId), body(request) as never));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Model definition creation failed" });
    }
  });
  app.put("/api/models/:endpointId/models/:modelId", (request, response) => {
    try {
      response.json(updateModelDefinition(database, String(request.params.endpointId), String(request.params.modelId), body(request) as never));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Model definition update failed" });
    }
  });
  app.get("/api/admin/settings", (_request, response) => response.json(getSettings(database)));
  app.put("/api/admin/settings", (request, response) => {
    try {
      response.json(saveSettings(database, body(request)));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Settings update failed" });
    }
  });
  app.delete("/api/admin/sessions/:id", (request, response) => {
    revokeSessionById(database, String(request.params.id));
    response.json({ ok: true });
  });
  app.get("/api/admin/pending-users", (_request, response) => response.json({ users: listPendingUsers(database) }));
  app.get("/api/admin/users", (_request, response) => response.json({ users: listUsers(database) }));
  app.post("/api/admin/users/:id/approve", (request, response) => { setUserStatus(database, String(request.params.id), "active"); response.json({ ok: true }); });
  app.post("/api/admin/users/:id/reject", (request, response) => { setUserStatus(database, String(request.params.id), "rejected"); response.json({ ok: true }); });

  app.use(express.static(frontDir));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(frontDir, "index.html"));
  });

  return app;
}
