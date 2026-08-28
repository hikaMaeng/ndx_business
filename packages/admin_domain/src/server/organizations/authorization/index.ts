import type {
  OrganizationAccess,
  OrganizationNodePermission,
} from "../../../common/protocol/organization/index.js";
import { queries, type AdminDatabase } from "../../database/index.js";

type ResponsibilityRow = {
  organization_id: string;
  scope: "node" | "subtree";
};

type OrganizationAuthority = {
  canManage: boolean;
  hasAdminAll: boolean;
};

async function readOrganizationAuthority(
  database: AdminDatabase,
  actorId: string,
  organizationId: string,
  master: boolean,
): Promise<OrganizationAuthority> {
  const ancestors = await queries(database).all(
    `WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM organizations WHERE id = ?
        UNION ALL
        SELECT organization.id, organization.parent_id
        FROM organizations organization
        JOIN ancestors child ON organization.id = child.parent_id
      )
      SELECT id FROM ancestors`,
    organizationId,
  ) as Array<{ id: string }>;
  if (ancestors.length === 0)
    return { canManage: false, hasAdminAll: false };
  if (master) return { canManage: true, hasAdminAll: true };

  const ancestorIds = new Set(ancestors.map((row) => row.id));
  const responsibilities = await queries(database).all(
    "SELECT organization_id, scope FROM organization_responsibilities WHERE user_id = ?",
    actorId,
  ) as ResponsibilityRow[];
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

export async function requireOrganizationManage(
  database: AdminDatabase,
  actorId: string,
  organizationId: string,
  master: boolean,
): Promise<void> {
  if (
    !(await readOrganizationAuthority(database, actorId, organizationId, master))
      .canManage
  )
    throw new Error("You cannot manage this organization");
}

export async function requireOrganizationAdminAll(
  database: AdminDatabase,
  actorId: string,
  organizationId: string,
  master: boolean,
): Promise<void> {
  if (
    !(await readOrganizationAuthority(database, actorId, organizationId, master))
      .hasAdminAll
  )
    throw new Error("Admin all permission is required");
}

export function requireMasterOrganizationMutation(master: boolean): void {
  if (!master) throw new Error("Master administrator permission is required");
}

export async function canListOrganizationAccounts(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
): Promise<boolean> {
  if (master) return true;
  return Boolean(
    await queries(database).get(
      "SELECT 1 FROM organization_responsibilities WHERE user_id = ? LIMIT 1",
      actorId,
    ),
  );
}

export async function buildOrganizationAccess(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationIds: string[],
): Promise<OrganizationAccess> {
  // see docs/internals.md#organization-authorization
  const nodes: OrganizationNodePermission[] = [];
  for (const organizationId of organizationIds) {
    const authority = await readOrganizationAuthority(
      database,
      actorId,
      organizationId,
      master,
    );
    nodes.push({
      organizationId,
      canUpdate: authority.canManage,
      canManageMembers: authority.canManage,
      canCreateChild: authority.hasAdminAll,
      canCreateSibling: master,
      canDelete: master,
      canAssignAdminAll: authority.hasAdminAll,
    });
  }
  return {
    isMasterAdmin: master,
    canCreateRoot: master,
    nodes,
  };
}
