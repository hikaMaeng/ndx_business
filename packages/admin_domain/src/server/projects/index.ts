import { randomUUID } from "node:crypto";
import type { ProjectSummary } from "../../common/protocol/projects/index.js";
import { queries, type AdminDatabase } from "../database/index.js";

/**
 * What a new project starts with when nobody has edited it.
 *
 * Deliberately broad rather than clever: these projects are written by an agent
 * that may reach for any stack, so the file has to be right before anyone knows
 * what the project will become. Deleting the row in Admin brings this back.
 *
 * `.env.example` is un-ignored on purpose — the pattern above it would take it,
 * and a committed example is how the next person learns what to set.
 */
export const DEFAULT_GITIGNORE = `# --- secrets: never commit these ---
.env
.env.*
!.env.example
*.pem
*.key
*.p12
id_rsa*

# --- dependencies ---
node_modules/
.pnpm-store/
vendor/
__pycache__/
*.py[cod]
.venv/
venv/

# --- build output ---
dist/
build/
out/
target/
*.tsbuildinfo

# --- logs and coverage ---
*.log
npm-debug.log*
coverage/
.nyc_output/

# --- editors and operating systems ---
.vscode/
.idea/
*.swp
.DS_Store
Thumbs.db
`;

const toSummary = (row: Record<string, unknown>): ProjectSummary => ({
  id: String(row.id),
  ownerId: String(row.owner_id),
  organizationId: row.organization_id === null || row.organization_id === undefined ? null : String(row.organization_id),
  name: String(row.name),
  createdAt: String(row.created_at),
});

/** One account's projects. Nobody else's are visible from here. */
export async function listProjects(database: AdminDatabase, ownerId: string): Promise<ProjectSummary[]> {
  const rows = await queries(database).all("SELECT * FROM projects WHERE owner_id = ? ORDER BY name", ownerId);
  return rows.map(toSummary);
}

export async function findProject(database: AdminDatabase, ownerId: string, name: string): Promise<ProjectSummary | null> {
  const row = await queries(database).get("SELECT * FROM projects WHERE owner_id = ? AND name = ?", ownerId, name);
  return row ? toSummary(row) : null;
}

/**
 * Records a project against an account and, optionally, an organisation.
 *
 * The organisation is checked against membership here rather than trusted from
 * the request: an account can belong to several, and which one a project runs
 * under decides whose policy applies to everything written in it. Claiming an
 * organisation you are not in would be claiming its skills and its permissions.
 */
export async function createProject(
  database: AdminDatabase,
  input: { ownerId: string; organizationId: string | null; name: string },
): Promise<ProjectSummary> {
  if (input.organizationId) {
    const member = await queries(database).get(
      "SELECT 1 FROM organization_members WHERE organization_id = ? AND user_id = ?",
      input.organizationId, input.ownerId,
    );
    if (!member) throw new Error("you are not a member of that organization");
  }
  if (await findProject(database, input.ownerId, input.name)) throw new Error("a project with that name already exists");

  const summary: ProjectSummary = {
    id: randomUUID(),
    ownerId: input.ownerId,
    organizationId: input.organizationId,
    name: input.name,
    createdAt: new Date().toISOString(),
  };
  await queries(database).run(
    "INSERT INTO projects (id, owner_id, organization_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
    summary.id, summary.ownerId, summary.organizationId, summary.name, summary.createdAt,
  );
  return summary;
}

/** Returns whether a record was there to remove, so a caller can tell a miss from a no-op. */
export async function deleteProject(database: AdminDatabase, ownerId: string, name: string): Promise<boolean> {
  const result = await queries(database).run("DELETE FROM projects WHERE owner_id = ? AND name = ?", ownerId, name);
  return result.changes > 0;
}

/** A project seen from the organisation's side: whose it is, not just what it is called. */
export interface OrganizationProject extends ProjectSummary {
  ownerEmail: string;
}

/**
 * Every project running under an organisation, and under the ones below it.
 *
 * The recursion is the point. A parent organisation that could only see its own
 * node would be blind to the work its subtree is doing, which is the opposite of
 * how authority runs here — a parent's policy reaches down, so its view has to
 * as well.
 *
 * Ordered by account then project so the caller can group without sorting.
 */
export async function listProjectsByOrganization(database: AdminDatabase, organizationId: string): Promise<OrganizationProject[]> {
  const rows = await queries(database).all(`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM organizations WHERE id = ?
      UNION
      SELECT o.id FROM organizations o JOIN tree t ON o.parent_id = t.id
    )
    SELECT p.*, u.email AS owner_email
      FROM projects p
      JOIN users u ON u.id = p.owner_id
     WHERE p.organization_id IN (SELECT id FROM tree)
     ORDER BY u.email, p.name
  `, organizationId);
  return rows.map((row) => ({ ...toSummary(row), ownerEmail: String(row.owner_email) }));
}

/** The stored file, or the built-in when nobody has saved one. */
export async function readProjectDefault(database: AdminDatabase, name: string): Promise<{ name: string; content: string; updatedAt: string }> {
  const row = await queries(database).get("SELECT * FROM project_defaults WHERE name = ?", name);
  if (row) return { name, content: String(row.content), updatedAt: String(row.updated_at) };
  return { name, content: name === "gitignore" ? DEFAULT_GITIGNORE : "", updatedAt: "" };
}

export async function writeProjectDefault(database: AdminDatabase, name: string, content: string): Promise<{ name: string; content: string; updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  await queries(database).run(
    `INSERT INTO project_defaults (name, content, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    name, content, updatedAt,
  );
  return { name, content, updatedAt };
}
