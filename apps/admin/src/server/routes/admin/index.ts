import express from "express";
import { getSettings, listPendingUsers, listUsers, revokeSessionById, saveSettings, setUserStatus, type AdminDatabase } from "admin_domain/server";
import { body } from "../body.js";

export function registerAdminRoutes(app: express.Express, database: AdminDatabase): void {
  app.get("/api/admin/settings", async (_request, response) => response.json(await getSettings(database)));
  app.put("/api/admin/settings", async (request, response) => { try { response.json(await saveSettings(database, body(request))); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Settings update failed" }); } });
  app.delete("/api/admin/sessions/:id", async (request, response) => { await revokeSessionById(database, String(request.params.id)); response.json({ ok: true }); });
  app.get("/api/admin/pending-users", async (_request, response) => response.json({ users: await listPendingUsers(database) }));
  app.get("/api/admin/users", async (_request, response) => response.json({ users: await listUsers(database) }));
  app.post("/api/admin/users/:id/approve", async (request, response) => { await setUserStatus(database, String(request.params.id), "active"); response.json({ ok: true }); });
  app.post("/api/admin/users/:id/reject", async (request, response) => { await setUserStatus(database, String(request.params.id), "rejected"); response.json({ ok: true }); });
}
