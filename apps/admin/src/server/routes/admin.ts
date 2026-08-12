import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { getSettings, listPendingUsers, listUsers, revokeSessionById, saveSettings, setUserStatus } from "admin_domain/server";
import { body } from "./body.js";

export function registerAdminRoutes(app: express.Express, database: DatabaseSync): void {
  app.get("/api/admin/settings", (_request, response) => response.json(getSettings(database)));
  app.put("/api/admin/settings", (request, response) => { try { response.json(saveSettings(database, body(request))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Settings update failed" }); } });
  app.delete("/api/admin/sessions/:id", (request, response) => { revokeSessionById(database, String(request.params.id)); response.json({ ok: true }); });
  app.get("/api/admin/pending-users", (_request, response) => response.json({ users: listPendingUsers(database) }));
  app.get("/api/admin/users", (_request, response) => response.json({ users: listUsers(database) }));
  app.post("/api/admin/users/:id/approve", (request, response) => { setUserStatus(database, String(request.params.id), "active"); response.json({ ok: true }); });
  app.post("/api/admin/users/:id/reject", (request, response) => { setUserStatus(database, String(request.params.id), "rejected"); response.json({ ok: true }); });
}
