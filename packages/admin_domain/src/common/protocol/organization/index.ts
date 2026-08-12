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

export type OrganizationInferenceServiceOption = {
  endpointId: string;
  name: string;
};

export type OrganizationInferenceModel = {
  modelId: string;
  identifier: string;
  active: boolean;
};

export type OrganizationInferenceService = {
  organizationId: string;
  endpointId: string;
  name: string;
  models: OrganizationInferenceModel[];
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
  inferenceServiceOptions: OrganizationInferenceServiceOption[];
  inferenceServices: OrganizationInferenceService[];
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
export type AssignOrganizationInferenceServiceRequest = { endpointId: string };
export type UpdateOrganizationInferenceModelRequest = { active: boolean };

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
export function parseAssignOrganizationInferenceServiceRequest(value: unknown): AssignOrganizationInferenceServiceRequest | null { return isRecord(value) && typeof value.endpointId === "string" ? { endpointId: value.endpointId } : null; }
export function parseUpdateOrganizationInferenceModelRequest(value: unknown): UpdateOrganizationInferenceModelRequest | null { return isRecord(value) && typeof value.active === "boolean" ? { active: value.active } : null; }

export const addOrganizationInferenceServiceRoute = {
  path: "/api/organizations/:id/inference-services",
  method: "POST",
} as const;
export const removeOrganizationInferenceServiceRoute = {
  path: "/api/organizations/:id/inference-services/:endpointId",
  method: "DELETE",
} as const;
export const updateOrganizationInferenceModelRoute = {
  path: "/api/organizations/:id/inference-services/:endpointId/models/:modelId",
  method: "PUT",
} as const;

export function organizationInferenceServicesPath(organizationId: string): string {
  return `/api/organizations/${organizationId}/inference-services`;
}

export function organizationInferenceServicePath(
  organizationId: string,
  endpointId: string,
): string {
  return `${organizationInferenceServicesPath(organizationId)}/${endpointId}`;
}

export function organizationInferenceModelPath(
  organizationId: string,
  endpointId: string,
  modelId: string,
): string {
  return `${organizationInferenceServicePath(organizationId, endpointId)}/models/${modelId}`;
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
    !Array.isArray(record.inferenceServiceOptions) ||
    !Array.isArray(record.inferenceServices) ||
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
  const inferenceServiceOptions = record.inferenceServiceOptions.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return typeof row.endpointId === "string" && typeof row.name === "string";
  });
  const inferenceServices = record.inferenceServices.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return (
      typeof row.endpointId === "string" &&
      typeof row.organizationId === "string" &&
      typeof row.name === "string" &&
      Array.isArray(row.models) &&
      row.models.every((model) => {
        if (!model || typeof model !== "object") return false;
        const modelRow = model as Record<string, unknown>;
        return (
          typeof modelRow.modelId === "string" &&
          typeof modelRow.identifier === "string" &&
          typeof modelRow.active === "boolean"
        );
      })
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
    inferenceServiceOptions &&
    inferenceServices &&
    typeof access.isMasterAdmin === "boolean" &&
    typeof access.canCreateRoot === "boolean" &&
    accessNodes
    ? (record as OrganizationSnapshot)
    : null;
}
