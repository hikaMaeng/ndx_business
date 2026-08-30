import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdminDatabase } from "admin_domain/server";
import { apiPermissionMiddleware } from "./permission/index.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerAuthRoutes } from "./routes/auth/index.js";
import { registerModelRoutes } from "./routes/models/index.js";
import { registerOrganizationRoutes } from "./routes/organizations/index.js";
import { registerPolicyRoutes } from "./routes/policy/index.js";
import { registerProjectDefaultRoutes } from "./routes/project-defaults/index.js";
import { registerProjectRoutes } from "./routes/projects/index.js";
import { registerSkillRoutes } from "./routes/skills/index.js";

/**
 * The database is an argument, not something this function goes and finds.
 *
 * It used to default to a file path, which two tests took: running the suite
 * wrote a real database into the repository. Production never used that
 * default; it only ever created strays.
 */
export function createApp(database: AdminDatabase) {
  const app = express();
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const frontDir = path.resolve(serverDir, "../front");
  const health = (_request: express.Request, response: express.Response) => response.json({ status: "ok", service: "admin" });

  /**
   * One small limit for everything, and one exception that has to be reached.
   *
   * 64kb is right for every request that carries a form: a body larger than
   * that is a mistake or an attack, and refusing it early costs nothing.
   *
   * A skill bundle is the exception, and it has to be skipped *here* rather
   * than raised at the route. A general parser mounted first consumes the
   * request and answers 413 before the route's own limit is ever consulted —
   * so the route would declare 16mb and still refuse an 80kb upload, with a
   * message about JSON. Every hand-made bundle in the tests was under 64kb;
   * the first real skill was the first thing to find this.
   */
  const small = express.json({ limit: "64kb" });
  const bundleUpload = /^\/api\/skills\/[^/]+\/bundle$/;
  app.use((request, response, next) => {
    if (request.method === "POST" && bundleUpload.test(request.path)) { next(); return; }
    small(request, response, next);
  });
  app.use(apiPermissionMiddleware(database));
  app.get("/health", health);
  app.get("/api/health", health);
  registerAuthRoutes(app, database);
  registerOrganizationRoutes(app, database);
  registerProjectRoutes(app, database);
  registerProjectDefaultRoutes(app, database);
  registerPolicyRoutes(app, database);
  registerSkillRoutes(app, database);
  registerModelRoutes(app, database);
  registerAdminRoutes(app, database);
  app.use(express.static(frontDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(frontDir, "index.html")));
  return app;
}
