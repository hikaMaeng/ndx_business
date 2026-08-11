import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate, createOrganization, deleteOrganization, getSettings, listOrganizations, listPendingUsers, listUsers, login, revokeSession, revokeSessionById, saveSettings, setUserStatus, signup, readSettings, assignMember, assignResponsible } from "admin_domain/server";
import { openAuthDatabase } from "admin_domain/server";
import type { DatabaseSync } from "node:sqlite";

type AuthenticatedRequest = express.Request & { user?: { id: string; email: string; status: "active" | "pending" | "rejected"; isMasterAdmin?: boolean }; sessionToken?: string };
function isMaster(user: { id: string; email: string; status: "active" | "pending" | "rejected"; isMasterAdmin?: boolean } | undefined): boolean { return Boolean(user?.isMasterAdmin || (process.env.MASTER_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).includes(user?.email.toLowerCase() ?? "")); }

function readCookie(request: express.Request, name: string): string | undefined {
  const header = request.header("cookie") ?? "";
  return header.split(";").map((part) => part.trim()).map((part) => part.split("=")).find(([key]) => key === name)?.slice(1).join("=");
}

function readSessionToken(request: express.Request, settings: ReturnType<typeof readSettings>): string {
  const bearer = request.header("authorization");
  const bearerToken = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : undefined;
  const headerToken = request.header(settings.sessionHeaderName) ?? undefined;
  const cookieToken = readCookie(request, settings.sessionCookieName);
  const tokens = [bearerToken, headerToken, cookieToken].filter((value): value is string => Boolean(value));
  if (new Set(tokens).size > 1) throw new Error("Conflicting session credentials");
  if (!tokens[0]) throw new Error("Authentication required");
  return tokens[0];
}

function protectedRoute(database: DatabaseSync) {
  return (request: AuthenticatedRequest, response: express.Response, next: express.NextFunction) => {
    try {
      const settings = readSettings(database);
      const token = readSessionToken(request, settings);
      request.sessionToken = token;
      request.user = authenticate(database, token, request.header("x-session-device") ?? "unknown-client", request.header("user-agent") ?? "Unknown client", { method: request.method, path: request.path });
      next();
    } catch (error) {
      response.status(401).json({ error: error instanceof Error ? error.message : "Authentication required" });
    }
  };
}

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

  app.get("/health", health);
  app.get("/api/health", health);

  app.use(express.json({ limit: "64kb" }));
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

  const requireSession = protectedRoute(database);
  app.post("/api/auth/logout", requireSession, (request: AuthenticatedRequest, response) => {
    revokeSession(database, request.sessionToken!);
    response.json({ ok: true });
  });
  app.get("/api/organizations", requireSession, (_request, response) => response.json(listOrganizations(database)));
  app.post("/api/organizations", requireSession, (request: AuthenticatedRequest, response) => { try { response.status(201).json(createOrganization(database, request.user!.id, isMaster(request.user), body(request) as never)); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Organization update failed" }); } });
  app.post("/api/organizations/:id/members", requireSession, (request: AuthenticatedRequest, response) => { try { response.json(assignMember(database, request.user!.id, isMaster(request.user), String(request.params.id), body(request) as never)); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Member assignment failed" }); } });
  app.post("/api/organizations/:id/responsibilities", requireSession, (request: AuthenticatedRequest, response) => { try { response.json(assignResponsible(database, request.user!.id, isMaster(request.user), String(request.params.id), body(request) as never)); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Responsibility assignment failed" }); } });
  app.delete("/api/organizations/:id", requireSession, (request: AuthenticatedRequest, response) => { try { response.json(deleteOrganization(database, request.user!.id, isMaster(request.user), String(request.params.id))); } catch (error) { response.status(403).json({ error: error instanceof Error ? error.message : "Organization deletion failed" }); } });
  app.get("/api/auth/me", requireSession, (request: AuthenticatedRequest, response) => response.json(request.user));
  app.get("/api/admin/settings", requireSession, (_request, response) => response.json(getSettings(database)));
  app.put("/api/admin/settings", requireSession, (request, response) => {
    try {
      response.json(saveSettings(database, body(request)));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "Settings update failed" });
    }
  });
  app.delete("/api/admin/sessions/:id", requireSession, (request, response) => {
    revokeSessionById(database, String(request.params.id));
    response.json({ ok: true });
  });
  app.get("/api/admin/pending-users", requireSession, (_request, response) => response.json({ users: listPendingUsers(database) }));
  app.get("/api/admin/users", requireSession, (_request, response) => response.json({ users: listUsers(database) }));
  app.post("/api/admin/users/:id/approve", requireSession, (request, response) => { setUserStatus(database, String(request.params.id), "active"); response.json({ ok: true }); });
  app.post("/api/admin/users/:id/reject", requireSession, (request, response) => { setUserStatus(database, String(request.params.id), "rejected"); response.json({ ok: true }); });

  app.use(express.static(frontDir));
  app.get("/{*path}", (_request, response) => {
    response.sendFile(path.join(frontDir, "index.html"));
  });

  return app;
}
