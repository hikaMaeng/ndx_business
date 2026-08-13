import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PostgresDatabase } from "admin_domain/server/postgres";
import { apiPermissionMiddleware } from "./permission/index.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";

export function createApp(database: PostgresDatabase) {
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
