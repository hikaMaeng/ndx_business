import type { DatabaseSync } from "node:sqlite";
import type {
  OrganizationAccess,
  OrganizationNodePermission,
} from "../../../common/protocol/organization/index.js";

type ResponsibilityRow = {
  organization_id: string;
  scope: "node" | "subtree";
};

type OrganizationAuthority = {
  canManage: boolean;
  hasAdminAll: boolean;
};

function readOrganizationAuthority(
  database: DatabaseSync,
  actorId: string,
  organizationId: string,
  master: boolean,
): OrganizationAuthority {
  const ancestors = database
    .prepare(
      `WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM organizations WHERE id = ?
        UNION ALL
        SELECT organization.id, organization.parent_id
        FROM organizations organization
        JOIN ancestors child ON organization.id = child.parent_id
      )
      SELECT id FROM ancestors`,
    )
    .all(organizationId) as Array<{ id: string }>;
  if (ancestors.length === 0)
    return { canManage: false, hasAdminAll: false };
  if (master) return { canManage: true, hasAdminAll: true };

  const ancestorIds = new Set(ancestors.map((row) => row.id));
  const responsibilities = database
    .prepare(
      "SELECT organization_id, scope FROM organization_responsibilities WHERE user_id = ?",
    )
    .all(actorId) as ResponsibilityRow[];
  return {
    canManage: responsibilities.some(
      (row) =>
        row.organization_id === organizationId ||
        (row.scope === "subtree" && ancestorIds.has(row.organization_id)),
    ),
    hasAdminAll: responsibilities.some(
      (row) =>
        row.scope === "subtree" && ancestorIds.has(row.organization_id),
    ),
  };
}

export function requireOrganizationManage(
  database: DatabaseSync,
  actorId: string,
  organizationId: string,
  master: boolean,
): void {
  if (
    !readOrganizationAuthority(database, actorId, organizationId, master)
      .canManage
  )
    throw new Error("You cannot manage this organization");
}

export function requireOrganizationAdminAll(
  database: DatabaseSync,
  actorId: string,
  organizationId: string,
  master: boolean,
): void {
  if (
    !readOrganizationAuthority(database, actorId, organizationId, master)
      .hasAdminAll
  )
    throw new Error("Admin all permission is required");
}

export function requireMasterOrganizationMutation(master: boolean): void {
  if (!master) throw new Error("Master administrator permission is required");
}

export function canListOrganizationAccounts(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
): boolean {
  if (master) return true;
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM organization_responsibilities WHERE user_id = ? LIMIT 1",
      )
      .get(actorId),
  );
}

export function buildOrganizationAccess(
  database: DatabaseSync,
  actorId: string,
  master: boolean,
  organizationIds: string[],
): OrganizationAccess {
  // see docs/internals.md#organization-authorization
  const nodes: OrganizationNodePermission[] = organizationIds.map(
    (organizationId) => {
      const authority = readOrganizationAuthority(
        database,
        actorId,
        organizationId,
        master,
      );
      return {
        organizationId,
        canUpdate: authority.canManage,
        canManageMembers: authority.canManage,
        canCreateChild: authority.hasAdminAll,
        canCreateSibling: master,
        canDelete: master,
        canAssignAdminAll: authority.hasAdminAll,
      };
    },
  );
  return {
    isMasterAdmin: master,
    canCreateRoot: master,
    nodes,
  };
}
