import express from "express";

import type { UserSummary } from "admin_domain/common";
import { authenticate, readSettings, type AdminDatabase } from "admin_domain/server";

export type AuthenticatedRequest = express.Request & {
  user?: UserSummary;
  sessionToken?: string;
};

type ApiPermission = "public" | "authenticated" | "master";

const publicApiRoutes = new Set([
  "GET /api/health",
  "POST /api/auth/signup",
  "POST /api/auth/login",
]);

function permissionFor(request: express.Request): ApiPermission {
  if (request.path !== "/api" && !request.path.startsWith("/api/")) return "public";
  if (publicApiRoutes.has(`${request.method.toUpperCase()} ${request.path}`)) return "public";
  return ["/api/admin", "/api/models"].some((prefix) => request.path === prefix || request.path.startsWith(`${prefix}/`))
    ? "master"
    : "authenticated";
}

function readSessionToken(request: express.Request, settings: Awaited<ReturnType<typeof readSettings>>): string {
  const bearer = request.header("authorization");
  const bearerToken = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : undefined;
  const headerToken = request.header(settings.sessionHeaderName) ?? undefined;
  const cookie = request.header("cookie") ?? "";
  const cookieToken = cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === settings.sessionCookieName)
    ?.slice(1)
    .join("=");
  const tokens = [bearerToken, headerToken, cookieToken].filter((value): value is string => Boolean(value));
  if (new Set(tokens).size > 1) throw new Error("Conflicting session credentials");
  if (!tokens[0]) throw new Error("Authentication required");
  return tokens[0];
}

// see apps/admin/docs/constraints.md#blast-radius
export function apiPermissionMiddleware(database: AdminDatabase): express.RequestHandler {
  return async (request: AuthenticatedRequest, response, next) => {
    const permission = permissionFor(request);
    if (permission === "public") return next();
    try {
      const token = readSessionToken(request, await readSettings(database));
      request.sessionToken = token;
      request.user = await authenticate(
        database,
        token,
        request.header("x-session-device") ?? "unknown-client",
        request.header("user-agent") ?? "Unknown client",
        { method: request.method, path: request.path },
      );
    } catch (error) {
      response.status(401).json({ error: error instanceof Error ? error.message : "Authentication required" });
      return;
    }
    if (permission === "master" && !request.user.isMasterAdmin) {
      response.status(403).json({ error: "Master administrator permission is required" });
      return;
    }
    next();
  };
}
