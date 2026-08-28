import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { apiPermissionMiddleware } from "./permission/index.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerAuthRoutes } from "./routes/auth/index.js";
import { registerModelRoutes } from "./routes/models/index.js";
import { registerOrganizationRoutes } from "./routes/organizations/index.js";

/**
 * The database is an argument, not something this function goes and finds.
 *
 * It used to default to opening `./data/admin.sqlite` relative to the working
 * directory. Two tests called `createApp()` with nothing, so running the suite
 * wrote a real sqlite file into the repository — `apps/admin/data/` was that,
 * sitting untracked for weeks. Production never used the default; it only ever
 * created strays.
 */
export function createApp(database: DatabaseSync) {
  const app = express();
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const frontDir = path.resolve(serverDir, "../front");
  const health = (_request: express.Request, response: express.Response) => response.json({ status: "ok", service: "admin" });

  app.use(express.json({ limit: "64kb" }));
  app.use(apiPermissionMiddleware(database));
  app.get("/health", health);
  app.get("/api/health", health);
  registerAuthRoutes(app, database);
  registerOrganizationRoutes(app, database);
  registerModelRoutes(app, database);
  registerAdminRoutes(app, database);
  app.use(express.static(frontDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(frontDir, "index.html")));
  return app;
}
