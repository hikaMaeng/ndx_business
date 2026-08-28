import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { parseLoginRequest, parseSignupRequest, parseUpdateSettingsRequest } from "admin_domain/common";
import { login, readSettings, revokeSession, signup } from "admin_domain/server";
import type { AuthenticatedRequest } from "../../permission/index.js";
import { body, requireInput } from "../body.js";

export function registerAuthRoutes(app: express.Express, database: DatabaseSync): void {
  app.post("/api/auth/signup", (request, response) => {
    try { const input = requireInput(parseSignupRequest(body(request))); response.status(201).json(signup(database, input.email, input.password, input.metadata ?? {})); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Signup failed" }); }
  });
  app.post("/api/auth/login", (request, response) => {
    try { const input = requireInput(parseLoginRequest(body(request))); const result = login(database, input.email, input.password, input.metadata ?? {}); const settings = readSettings(database); response.setHeader("Set-Cookie", `${settings.sessionCookieName}=${result.sessionToken}; HttpOnly; Path=/; SameSite=Lax`); response.json(result); }
    catch (error) { response.status(401).json({ error: error instanceof Error ? error.message : "Login failed" }); }
  });
  app.post("/api/auth/logout", (request: AuthenticatedRequest, response) => { revokeSession(database, request.sessionToken!); response.json({ ok: true }); });
  app.get("/api/auth/me", (request: AuthenticatedRequest, response) => response.json(request.user));
}
