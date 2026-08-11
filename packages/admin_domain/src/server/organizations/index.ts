import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ORGANIZATION_COLORS,
  ORGANIZATION_ICONS,
  type AssignMemberRequest,
  type AssignResponsibleRequest,
  type CreateOrganizationRequest,
  type OrganizationColor,
  type OrganizationIcon,
  type OrganizationSnapshot,
  type UpdateOrganizationRequest,
} from "../../common/protocol/organization/index.js";
import type { UsersResponse } from "../../common/protocol/auth/index.js";
import { listUsers } from "../auth/index.js";
import {
  buildOrganizationAccess,
  canListOrganizationAccounts,
  requireMasterOrganizationMutation,
  requireOrganizationAdminAll,
  requireOrganizationManage,
} from "./authorization/index.js";

export function listOrganizations(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
): OrganizationSnapshot {
  const organizationRows = database
    .prepare(
      "SELECT id, name, parent_id, color, icon, created_at FROM organizations ORDER BY name",
    )
    .all() as Array<{
    id: string;
    name: string;
    parent_id: string | null;
    color: OrganizationColor;
    icon: OrganizationIcon;
    created_at: string;
  }>;
  const memberRows = database
    .prepare(
      "SELECT m.organization_id, m.user_id, u.email FROM organization_members m JOIN users u ON u.id=m.user_id ORDER BY u.email",
    )
    .all() as Array<{
    organization_id: string;
    user_id: string;
    email: string;
  }>;
  const responsibilityRows = database
    .prepare(
      "SELECT r.organization_id, r.user_id, r.scope, u.email FROM organization_responsibilities r JOIN users u ON u.id=r.user_id",
    )
    .all() as Array<{
    organization_id: string;
    user_id: string;
    scope: "node" | "subtree";
    email: string;
  }>;
  return {
    organizations: organizationRows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      color: row.color,
      icon: row.icon,
      createdAt: row.created_at,
    })),
    members: memberRows.map((row) => ({
      organizationId: row.organization_id,
      userId: row.user_id,
      email: row.email,
    })),
    responsibilities: responsibilityRows.map((row) => ({
      organizationId: row.organization_id,
      userId: row.user_id,
      scope: row.scope,
      email: row.email,
    })),
    access: buildOrganizationAccess(
      database,
      actorId,
      master,
      organizationRows.map((row) => row.id),
    ),
  } satisfies OrganizationSnapshot;
}

export function listOrganizationAccounts(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
): UsersResponse {
  if (!canListOrganizationAccounts(database, actorId, master))
    throw new Error("You cannot manage organization accounts");
  return { users: listUsers(database) } satisfies UsersResponse;
}

export function createOrganization(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
  input: CreateOrganizationRequest,
): OrganizationSnapshot {
  if (!input || typeof input.name !== "string")
    throw new Error("Organization name is required");
  const name = input.name.trim();
  if (!name) throw new Error("Organization name is required");
  if (
    input.mode !== "root" &&
    input.mode !== "sibling" &&
    input.mode !== "child"
  )
    throw new Error("Unknown organization creation mode");
  if (input.mode === "root") {
    if (input.parentId !== null && input.parentId !== undefined)
      throw new Error("A root organization cannot have a parent");
    requireMasterOrganizationMutation(master);
  } else if (input.mode === "sibling") {
    requireMasterOrganizationMutation(master);
    if (input.parentId !== null && input.parentId !== undefined) {
      if (typeof input.parentId !== "string" || !input.parentId)
        throw new Error("Unknown parent organization");
      requireOrganizationAdminAll(database, actorId, input.parentId, master);
    }
  } else {
    if (typeof input.parentId !== "string" || !input.parentId)
      throw new Error("A child organization requires a parent");
    requireOrganizationAdminAll(database, actorId, input.parentId, master);
  }
  database
    .prepare(
      "INSERT INTO organizations (id, name, parent_id, color, icon, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      randomUUID(),
      name,
      input.parentId ?? null,
      "blue",
      "building",
      new Date().toISOString(),
    );
  return listOrganizations(database, actorId, master);
}

export function updateOrganization(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
  organizationId: string,
  input: UpdateOrganizationRequest,
): OrganizationSnapshot {
  requireOrganizationManage(database, actorId, organizationId, master);
  if (!input || typeof input.name !== "string")
    throw new Error("Organization name is required");
  const name = input.name.trim();
  if (!name) throw new Error("Organization name is required");
  if (!ORGANIZATION_COLORS.includes(input.color))
    throw new Error("Unknown organization color");
  if (!ORGANIZATION_ICONS.includes(input.icon))
    throw new Error("Unknown organization icon");
  database
    .prepare(
      "UPDATE organizations SET name = ?, color = ?, icon = ? WHERE id = ?",
    )
    .run(name, input.color, input.icon, organizationId);
  return listOrganizations(database, actorId, master);
}

export function assignMember(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
  organizationId: string,
  input: AssignMemberRequest,
): OrganizationSnapshot {
  requireOrganizationManage(database, actorId, organizationId, master);
  if (!input || typeof input.userId !== "string" || !input.userId)
    throw new Error("Unknown organization account");
  database
    .prepare(
      "INSERT OR IGNORE INTO organization_members (organization_id, user_id) VALUES (?, ?)",
    )
    .run(organizationId, input.userId);
  return listOrganizations(database, actorId, master);
}

export function removeMember(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
  organizationId: string,
  userId: string,
): OrganizationSnapshot {
  // see docs/internals.md#decisions
  requireOrganizationManage(database, actorId, organizationId, master);
  if (!userId) throw new Error("Unknown organization account");
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        "DELETE FROM organization_responsibilities WHERE organization_id = ? AND user_id = ?",
      )
      .run(organizationId, userId);
    database
      .prepare(
        "DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?",
      )
      .run(organizationId, userId);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return listOrganizations(database, actorId, master);
}

export function assignResponsible(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
  organizationId: string,
  input: AssignResponsibleRequest,
): OrganizationSnapshot {
  requireOrganizationManage(database, actorId, organizationId, master);
  if (
    !input ||
    typeof input.userId !== "string" ||
    !input.userId ||
    (input.scope !== "node" && input.scope !== "subtree")
  )
    throw new Error("Unknown organization responsibility");
  if (input.scope === "subtree")
    requireOrganizationAdminAll(database, actorId, organizationId, master);
  database
    .prepare(
      "INSERT INTO organization_responsibilities (organization_id, user_id, scope) VALUES (?, ?, ?) ON CONFLICT(organization_id, user_id) DO UPDATE SET scope=excluded.scope",
    )
    .run(organizationId, input.userId, input.scope);
  return listOrganizations(database, actorId, master);
}

export function removeResponsible(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
  organizationId: string,
  userId: string,
): OrganizationSnapshot {
  requireOrganizationManage(database, actorId, organizationId, master);
  if (!userId) throw new Error("Unknown organization account");
  database
    .prepare(
      "DELETE FROM organization_responsibilities WHERE organization_id = ? AND user_id = ?",
    )
    .run(organizationId, userId);
  return listOrganizations(database, actorId, master);
}

export function deleteOrganization(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
  organizationId: string,
): OrganizationSnapshot {
  requireMasterOrganizationMutation(master);
  requireOrganizationManage(database, actorId, organizationId, master);
  database
    .prepare("DELETE FROM organizations WHERE id = ?")
    .run(organizationId);
  return listOrganizations(database, actorId, master);
}
