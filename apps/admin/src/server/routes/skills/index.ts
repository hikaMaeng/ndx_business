import express from "express";
import {
  BUNDLE_LIMITS, bundleRoot, deleteBundle, extractBundle, listBundle, listPolicy,
  readBundleFile, readBundleManifest, requireOrganizationManage, setPolicy, writeBundleFile,
  type AdminDatabase,
} from "admin_domain/server";
import type { AuthenticatedRequest } from "../../permission/index.js";
import { body } from "../body.js";

/** Where bundles live inside this container. The tool runner sees the same tree, read-only. */
const SKILLS_ROOT = process.env.SKILLS_ROOT ?? "/skills";

/**
 * A skill's files: uploaded, browsed, edited.
 *
 * The layer a bundle belongs to comes from the query and decides two things at
 * once — which folder it lives in, and who is allowed to touch it. An
 * organisation's bundle is policy for everyone beneath it, so writing one needs
 * the right to manage that organisation. An account's is its own.
 */
export function registerSkillRoutes(app: express.Express, database: AdminDatabase): void {
  /**
   * Resolves the folder and checks the authority in one step.
   *
   * Together on purpose: they are the same question asked of the same
   * parameters, and splitting them is how a route ends up resolving one layer
   * and authorising another.
   */
  const place = async (request: AuthenticatedRequest) => {
    const scope = request.query as Record<string, string | undefined>;
    if (scope.organizationId) {
      await requireOrganizationManage(database, request.user!.id, scope.organizationId, Boolean(request.user!.isMasterAdmin));
      return { organizationId: scope.organizationId };
    }
    return scope.projectId
      ? { ownerId: request.user!.id, projectId: scope.projectId }
      : { ownerId: request.user!.id };
  };

  const locate = async (request: AuthenticatedRequest, name: string) =>
    bundleRoot(SKILLS_ROOT, await place(request), name);

  const refuse = (response: express.Response, error: unknown) =>
    response.status(400).json({ error: error instanceof Error ? error.message : "Skill file access failed" });

  app.get("/api/skills/:name/files", async (request: AuthenticatedRequest, response) => {
    try {
      const root = await locate(request, String(request.params.name));
      // The manifest comes back with the listing, not only with the upload that
      // installed it: what a skill needs is a fact about the skill, and it is
      // wanted by whoever opens it next rather than only by whoever put it there.
      response.json({ files: await listBundle(root), manifest: await readBundleManifest(root) });
    } catch (error) { refuse(response, error); }
  });

  app.get("/api/skills/:name/file", async (request: AuthenticatedRequest, response) => {
    const file = String((request.query as Record<string, unknown>).path ?? "");
    try { response.json({ path: file, content: await readBundleFile(await locate(request, String(request.params.name)), file) }); }
    catch (error) { refuse(response, error); }
  });

  app.put("/api/skills/:name/file", async (request: AuthenticatedRequest, response) => {
    const input = body(request) as { path?: unknown; content?: unknown } | undefined;
    if (typeof input?.path !== "string" || typeof input.content !== "string") {
      response.status(400).json({ error: "path and content are required" });
      return;
    }
    try {
      const root = await locate(request, String(request.params.name));
      await writeBundleFile(root, input.path, input.content);
      response.json({ files: await listBundle(root) });
    } catch (error) { refuse(response, error); }
  });

  /**
   * The upload.
   *
   * The archive arrives as base64 in JSON rather than as multipart: this app
   * parses JSON and nothing else, and a second body parser exists to be the one
   * nobody remembers to bound. The size ceiling is stated here because the
   * generic JSON limit is measured in kilobytes and would refuse every real
   * bundle with a message about JSON.
   */
  app.post("/api/skills/:name/bundle",
    express.json({ limit: `${Math.ceil(BUNDLE_LIMITS.totalBytes / (1024 * 1024)) * 2}mb` }),
    async (request: AuthenticatedRequest, response) => {
      const archive = (request.body as { archive?: unknown } | undefined)?.archive;
      if (typeof archive !== "string" || !archive) {
        response.status(400).json({ error: "archive must be a base64 zip" });
        return;
      }
      try {
        const buffer = Buffer.from(archive, "base64");
        if (buffer.byteLength > BUNDLE_LIMITS.totalBytes) throw new Error("the archive is too large");
        const name = String(request.params.name);
        const scope = await place(request);
        const root = bundleRoot(SKILLS_ROOT, scope, name);
        const files = await extractBundle(root, buffer);

        /**
         * The skill's own account of itself wins.
         *
         * A real skill states its description in `SKILL.md`'s frontmatter,
         * because that file travels with it. Copying that sentence into a row
         * by hand produces two versions of it, and the row's is the one that
         * goes stale — it sits next to nothing that changes when the skill
         * does. So an upload updates the row rather than asking anyone to.
         *
         * Only when the bundle says something. A skill with no frontmatter
         * leaves whatever a person wrote, because overwriting a description
         * with an empty one would remove the entry from the session index
         * entirely, and "I uploaded files and the skill disappeared" is not a
         * sentence this should be able to produce.
         */
        const manifest = await readBundleManifest(root);
        if (manifest.description) {
          const existing = (await listPolicy(database, scope))
            .find((entry) => entry.kind === "skill" && entry.name === name);
          await setPolicy(database, {
            ...scope,
            kind: "skill",
            name,
            mode: existing?.mode,
            enabled: existing?.enabled,
            value: { ...existing?.value, description: manifest.description },
          });
        }
        response.status(201).json({ files, manifest });
      } catch (error) { refuse(response, error); }
    });

  app.delete("/api/skills/:name/bundle", async (request: AuthenticatedRequest, response) => {
    try {
      await deleteBundle(await locate(request, String(request.params.name)));
      response.json({ ok: true });
    } catch (error) { refuse(response, error); }
  });
}
