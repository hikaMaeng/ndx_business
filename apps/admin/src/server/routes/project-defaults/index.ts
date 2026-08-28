import express from "express";
import { readProjectDefault, writeProjectDefault, type AdminDatabase } from "admin_domain/server";
import { body } from "../body.js";

/**
 * The files a project starts with.
 *
 * Its own family because it is about templates, not about projects: nothing
 * here reads or writes a project record, and the two change for different
 * reasons.
 */
export function registerProjectDefaultRoutes(app: express.Express, database: AdminDatabase): void {
  /**
   * What every new project starts with.
   *
   * Readable by any signed-in account because the coding agent fetches it on
   * their behalf when it makes a folder; only a master administrator writes it.
   */
  app.get("/api/project-defaults/:name", async (request, response) => {
    response.json({ file: await readProjectDefault(database, String(request.params.name)) });
  });

  app.put("/api/admin/project-defaults/:name", async (request, response) => {
    const content = (body(request) as { content?: unknown } | undefined)?.content;
    if (typeof content !== "string") { response.status(400).json({ error: "content must be a string" }); return; }
    response.json({ file: await writeProjectDefault(database, String(request.params.name), content) });
  });
}
