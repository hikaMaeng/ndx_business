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

/**
 * One model an organisation could be pointed at, from any registered endpoint.
 *
 * The endpoint's name travels with it because two providers may register the
 * same identifier. A picker offering `gpt-4o` twice asks somebody to choose
 * between two entries it refuses to tell apart.
 */
export type OrganizationInferenceModelOption = {
  modelId: string;
  endpointId: string;
  endpointName: string;
  identifier: string;
};

/**
 * The one model an organisation has chosen, or no row at all.
 *
 * Singular, because an organisation that attached two expressed a preference
 * nothing recorded and left the resolver picking between them by identifier
 * order. A snapshot that can still carry a list is a snapshot that invites the
 * screen to re-create the ambiguity the schema now forbids.
 */
export type OrganizationInferenceModel = OrganizationInferenceModelOption & {
  organizationId: string;
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
  inferenceModelOptions: OrganizationInferenceModelOption[];
  /**
   * Every organisation's choice, and never more than one entry per
   * organisation. Carried for the whole tree rather than for the open node so
   * a node that chose nothing can name the ancestor it inherits from without a
   * second request.
   */
  inferenceModels: OrganizationInferenceModel[];
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
export type SetOrganizationInferenceModelRequest = { modelId: string };

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object"; }

export function parseCreateOrganizationRequest(value: unknown): CreateOrganizationRequest | null {
  if (!isRecord(value) || typeof value.name !== "string" || !["root", "sibling", "child"].includes(String(value.mode))) return null;
  return { name: value.name, mode: value.mode as CreateOrganizationRequest["mode"], parentId: value.parentId === null || typeof value.parentId === "string" ? value.parentId : undefined };
}
export function parseUpdateOrganizationRequest(value: unknown): UpdateOrganizationRequest | null {
  return isRecord(value) && typeof value.name === "string" && ORGANIZATION_COLORS.includes(value.color as OrganizationColor) && ORGANIZATION_ICONS.includes(value.icon as OrganizationIcon)
    ? { name: value.name, color: value.color as OrganizationColor, icon: value.icon as OrganizationIcon } : null;
}
export function parseAssignMemberRequest(value: unknown): AssignMemberRequest | null { return isRecord(value) && typeof value.userId === "string" ? { userId: value.userId } : null; }
export function parseAssignResponsibleRequest(value: unknown): AssignResponsibleRequest | null { return isRecord(value) && typeof value.userId === "string" && (value.scope === "node" || value.scope === "subtree") ? { userId: value.userId, scope: value.scope } : null; }
export function parseSetOrganizationInferenceModelRequest(value: unknown): SetOrganizationInferenceModelRequest | null { return isRecord(value) && typeof value.modelId === "string" && value.modelId ? { modelId: value.modelId } : null; }

/**
 * One path, singular, for the one model.
 *
 * PUT replaces and DELETE clears, so neither verb can express "one more
 * alongside the others" — the URL says what the schema enforces rather than
 * leaving the constraint to be discovered from a failing insert.
 */
export const setOrganizationInferenceModelRoute = {
  path: "/api/organizations/:id/inference-model",
  method: "PUT",
} as const;
export const clearOrganizationInferenceModelRoute = {
  path: "/api/organizations/:id/inference-model",
  method: "DELETE",
} as const;

export function organizationInferenceModelPath(organizationId: string): string {
  return `/api/organizations/${organizationId}/inference-model`;
}

export function parseOrganizationSnapshot(
  value: unknown,
): OrganizationSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.organizations) ||
    !Array.isArray(record.members) ||
    !Array.isArray(record.responsibilities) ||
    !Array.isArray(record.inferenceModelOptions) ||
    !Array.isArray(record.inferenceModels) ||
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
  const isModelOption = (item: unknown): boolean => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return (
      typeof row.modelId === "string" &&
      typeof row.endpointId === "string" &&
      typeof row.endpointName === "string" &&
      typeof row.identifier === "string"
    );
  };
  const inferenceModelOptions = record.inferenceModelOptions.every(isModelOption);
  /**
   * A second entry for one organisation is a snapshot from a server that lost
   * the constraint, and the screen would render it as a `<select>` silently
   * showing one of the two. Rejecting the whole snapshot surfaces that as a
   * load failure instead of as a value nobody chose.
   */
  const chosenBy = new Set<string>();
  const inferenceModels = record.inferenceModels.every((item) => {
    if (!isModelOption(item)) return false;
    const row = item as Record<string, unknown>;
    if (typeof row.organizationId !== "string" || chosenBy.has(row.organizationId)) return false;
    chosenBy.add(row.organizationId);
    return true;
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
    inferenceModelOptions &&
    inferenceModels &&
    typeof access.isMasterAdmin === "boolean" &&
    typeof access.canCreateRoot === "boolean" &&
    accessNodes
    ? (record as OrganizationSnapshot)
    : null;
}
