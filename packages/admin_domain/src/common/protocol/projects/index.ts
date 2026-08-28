/**
 * A project as both sides speak of it.
 *
 * `name` is what the owner typed and what the client shows. Where it sits on
 * disk — under a folder named for the account — is the coding agent's business
 * and never crosses this wire.
 */
export type ProjectSummary = {
  id: string;
  ownerId: string;
  /** Null for a personal project: no organisation's policy applies to it. */
  organizationId: string | null;
  name: string;
  createdAt: string;
};

export type ProjectsResponse = { projects: ProjectSummary[] };

export type CreateProjectRequest = {
  name: string;
  /** Omitted or null means personal. An account in exactly one organisation has this filled in for it. */
  organizationId?: string | null;
};

/** A file every new project starts with. Edited in Admin, not baked into an image. */
export type ProjectDefault = { name: string; content: string; updatedAt: string };
export type ProjectDefaultResponse = { file: ProjectDefault };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function parseProjectSummary(value: unknown): ProjectSummary | null {
  if (!isRecord(value)) return null;
  return typeof value.id === "string"
    && typeof value.ownerId === "string"
    && (value.organizationId === null || typeof value.organizationId === "string")
    && typeof value.name === "string"
    && typeof value.createdAt === "string"
    ? value as ProjectSummary
    : null;
}

export function parseProjectsResponse(value: unknown): ProjectsResponse | null {
  if (!isRecord(value) || !Array.isArray(value.projects)) return null;
  return value.projects.every((item) => parseProjectSummary(item) !== null)
    ? { projects: value.projects as ProjectSummary[] }
    : null;
}

export function parseCreateProjectRequest(value: unknown): CreateProjectRequest | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  const organizationId = value.organizationId;
  if (organizationId !== undefined && organizationId !== null && typeof organizationId !== "string") return null;
  return { name: value.name.trim(), organizationId: organizationId ?? null };
}

export function parseProjectDefaultResponse(value: unknown): ProjectDefaultResponse | null {
  if (!isRecord(value) || !isRecord(value.file)) return null;
  const file = value.file;
  return typeof file.name === "string" && typeof file.content === "string" && typeof file.updatedAt === "string"
    ? { file: file as ProjectDefault }
    : null;
}
