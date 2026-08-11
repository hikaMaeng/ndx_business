export const ORGANIZATION_COLORS = [
  "slate",
  "blue",
  "cyan",
  "green",
  "amber",
  "rose",
] as const;
export const ORGANIZATION_ICONS = [
  "building",
  "briefcase",
  "layers",
  "users",
] as const;

export type OrganizationColor = (typeof ORGANIZATION_COLORS)[number];
export type OrganizationIcon = (typeof ORGANIZATION_ICONS)[number];

export type Organization = {
  id: string;
  name: string;
  parentId: string | null;
  color: OrganizationColor;
  icon: OrganizationIcon;
  createdAt: string;
};

export type OrganizationMember = {
  organizationId: string;
  userId: string;
  email: string;
};

export type OrganizationResponsibility = {
  organizationId: string;
  userId: string;
  scope: "node" | "subtree";
  email: string;
};

export type OrganizationNodePermission = {
  organizationId: string;
  canUpdate: boolean;
  canManageMembers: boolean;
  canCreateChild: boolean;
  canCreateSibling: boolean;
  canDelete: boolean;
  canAssignAdminAll: boolean;
};

export type OrganizationAccess = {
  isMasterAdmin: boolean;
  canCreateRoot: boolean;
  nodes: OrganizationNodePermission[];
};

export type OrganizationSnapshot = {
  organizations: Organization[];
  members: OrganizationMember[];
  responsibilities: OrganizationResponsibility[];
  access: OrganizationAccess;
};

export type CreateOrganizationRequest = {
  name: string;
  mode: "root" | "sibling" | "child";
  parentId?: string | null;
};

export type UpdateOrganizationRequest = {
  name: string;
  color: OrganizationColor;
  icon: OrganizationIcon;
};

export type AssignMemberRequest = { userId: string };
export type AssignResponsibleRequest = {
  userId: string;
  scope: "node" | "subtree";
};

export function parseOrganizationSnapshot(
  value: unknown,
): OrganizationSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.organizations) ||
    !Array.isArray(record.members) ||
    !Array.isArray(record.responsibilities) ||
    !record.access ||
    typeof record.access !== "object"
  )
    return null;
  const organizations = record.organizations.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return (
      typeof row.id === "string" &&
      typeof row.name === "string" &&
      (row.parentId === null || typeof row.parentId === "string") &&
      ORGANIZATION_COLORS.includes(row.color as OrganizationColor) &&
      ORGANIZATION_ICONS.includes(row.icon as OrganizationIcon) &&
      typeof row.createdAt === "string"
    );
  });
  const members = record.members.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return (
      typeof row.organizationId === "string" &&
      typeof row.userId === "string" &&
      typeof row.email === "string"
    );
  });
  const responsibilities = record.responsibilities.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return (
      typeof row.organizationId === "string" &&
      typeof row.userId === "string" &&
      (row.scope === "node" || row.scope === "subtree") &&
      typeof row.email === "string"
    );
  });
  const access = record.access as Record<string, unknown>;
  const accessNodes = Array.isArray(access.nodes)
    ? access.nodes.every((item) => {
        if (!item || typeof item !== "object") return false;
        const row = item as Record<string, unknown>;
        return (
          typeof row.organizationId === "string" &&
          typeof row.canUpdate === "boolean" &&
          typeof row.canManageMembers === "boolean" &&
          typeof row.canCreateChild === "boolean" &&
          typeof row.canCreateSibling === "boolean" &&
          typeof row.canDelete === "boolean" &&
          typeof row.canAssignAdminAll === "boolean"
        );
      })
    : false;
  return organizations &&
    members &&
    responsibilities &&
    typeof access.isMasterAdmin === "boolean" &&
    typeof access.canCreateRoot === "boolean" &&
    accessNodes
    ? (record as OrganizationSnapshot)
    : null;
}
