import { randomUUID } from "node:crypto";
import {
  ORGANIZATION_COLORS,
  ORGANIZATION_ICONS,
  type AssignMemberRequest,
  type AssignOrganizationInferenceServiceRequest,
  type AssignResponsibleRequest,
  type CreateOrganizationRequest,
  type OrganizationColor,
  type OrganizationIcon,
  type OrganizationInferenceService,
  type OrganizationInferenceServiceOption,
  type OrganizationInferenceModel,
  type OrganizationSnapshot,
  type UpdateOrganizationInferenceModelRequest,
  type UpdateOrganizationRequest,
} from "../../common/protocol/organization/index.js";
import type { UsersResponse } from "../../common/protocol/auth/index.js";
import { listUsers } from "../auth/index.js";
import { positional, queries, type AdminDatabase } from "../database/index.js";
import {
  buildOrganizationAccess,
  canListOrganizationAccounts,
  requireMasterOrganizationMutation,
  requireOrganizationAdminAll,
  requireOrganizationManage,
} from "./authorization/index.js";

export async function listOrganizations(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
): Promise<OrganizationSnapshot> {
  const ask = queries(database);
  const organizationRows = await ask.all(
    "SELECT id, name, parent_id, color, icon, created_at FROM organizations ORDER BY name",
  ) as Array<{
    id: string;
    name: string;
    parent_id: string | null;
    color: OrganizationColor;
    icon: OrganizationIcon;
    created_at: string;
  }>;
  const memberRows = await ask.all(
    "SELECT m.organization_id, m.user_id, u.email FROM organization_members m JOIN users u ON u.id=m.user_id ORDER BY u.email",
  ) as Array<{
    organization_id: string;
    user_id: string;
    email: string;
  }>;
  const responsibilityRows = await ask.all(
    "SELECT r.organization_id, r.user_id, r.scope, u.email FROM organization_responsibilities r JOIN users u ON u.id=r.user_id",
  ) as Array<{
    organization_id: string;
    user_id: string;
    scope: "node" | "subtree";
    email: string;
  }>;
  // `lower()` for a case-insensitive sort.
  const inferenceServiceOptions = await ask.all(
    "SELECT id, name FROM model_endpoints ORDER BY lower(name)",
  ) as Array<{ id: string; name: string }>;
  const inferenceServiceRows = await ask.all(
    "SELECT service.organization_id, service.endpoint_id, endpoint.name FROM organization_inference_services service JOIN model_endpoints endpoint ON endpoint.id = service.endpoint_id ORDER BY lower(endpoint.name)",
  ) as Array<{ organization_id: string; endpoint_id: string; name: string }>;
  const inferenceModelRows = await ask.all(
    "SELECT service.organization_id, service.endpoint_id, definition.id AS model_id, definition.identifier, COALESCE(item.active, 1) AS active FROM organization_inference_services service JOIN model_definitions definition ON definition.endpoint_id = service.endpoint_id LEFT JOIN organization_inference_models item ON item.organization_id = service.organization_id AND item.endpoint_id = service.endpoint_id AND item.model_id = definition.id ORDER BY lower(definition.identifier)",
  ) as Array<{
    organization_id: string;
    endpoint_id: string;
    model_id: string;
    identifier: string;
    active: number;
  }>;
  const servicesByOrganization = new Map<string, Map<string, OrganizationInferenceService>>();
  for (const row of inferenceServiceRows) {
    const services = servicesByOrganization.get(row.organization_id) ?? new Map();
    services.set(row.endpoint_id, {
      organizationId: row.organization_id,
      endpointId: row.endpoint_id,
      name: row.name,
      models: [],
    });
    servicesByOrganization.set(row.organization_id, services);
  }
  for (const row of inferenceModelRows) {
    servicesByOrganization.get(row.organization_id)?.get(row.endpoint_id)?.models.push({
      modelId: row.model_id,
      identifier: row.identifier,
      active: Boolean(row.active),
    } satisfies OrganizationInferenceModel);
  }
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
    inferenceServiceOptions: inferenceServiceOptions.map((row) => ({
      endpointId: row.id,
      name: row.name,
    } satisfies OrganizationInferenceServiceOption)),
    inferenceServices: [...servicesByOrganization.values()].flatMap((services) =>
      [...services.values()],
    ),
    access: await buildOrganizationAccess(
      database,
      actorId,
      master,
      organizationRows.map((row) => row.id),
    ),
  } satisfies OrganizationSnapshot;
}

export async function assignOrganizationInferenceService(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
  input: AssignOrganizationInferenceServiceRequest,
): Promise<OrganizationSnapshot> {
  await requireOrganizationManage(database, actorId, organizationId, master);
  if (!input || typeof input.endpointId !== "string" || !input.endpointId)
    throw new Error("Unknown inference service");
  const endpoint = await queries(database).get("SELECT id FROM model_endpoints WHERE id = ?", input.endpointId) as { id: string } | undefined;
  if (!endpoint) throw new Error("Unknown inference service");
  // Already a member is not an error; it is the state being asked for.
  await queries(database).run(
    "INSERT INTO organization_inference_services (organization_id, endpoint_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
    organizationId, endpoint.id,
  );
  return listOrganizations(database, actorId, master);
}

export async function removeOrganizationInferenceService(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
  endpointId: string,
): Promise<OrganizationSnapshot> {
  await requireOrganizationManage(database, actorId, organizationId, master);
  const removed = await queries(database).run(
    "DELETE FROM organization_inference_services WHERE organization_id = ? AND endpoint_id = ?",
    organizationId, endpointId,
  );
  if (!removed.changes) throw new Error("Unknown organization inference service");
  return listOrganizations(database, actorId, master);
}

export async function updateOrganizationInferenceModel(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
  endpointId: string,
  modelId: string,
  input: UpdateOrganizationInferenceModelRequest,
): Promise<OrganizationSnapshot> {
  await requireOrganizationManage(database, actorId, organizationId, master);
  if (!input || typeof input.active !== "boolean")
    throw new Error("Inference model active state is required");
  const changed = await queries(database).run(
    "INSERT INTO organization_inference_models (organization_id, endpoint_id, model_id, active) SELECT ?, ?, definition.id, ? FROM model_definitions definition JOIN organization_inference_services service ON service.organization_id = ? AND service.endpoint_id = ? WHERE definition.id = ? AND definition.endpoint_id = ? ON CONFLICT (organization_id, endpoint_id, model_id) DO UPDATE SET active = excluded.active",
    organizationId,
    endpointId,
    Number(input.active),
    organizationId,
    endpointId,
    modelId,
    endpointId,
  );
  if (!changed.changes) throw new Error("Unknown organization inference model");
  return listOrganizations(database, actorId, master);
}

export async function listOrganizationAccounts(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
): Promise<UsersResponse> {
  if (!(await canListOrganizationAccounts(database, actorId, master)))
    throw new Error("You cannot manage organization accounts");
  return { users: await listUsers(database) } satisfies UsersResponse;
}

export async function createOrganization(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  input: CreateOrganizationRequest,
): Promise<OrganizationSnapshot> {
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
      await requireOrganizationAdminAll(database, actorId, input.parentId, master);
    }
  } else {
    if (typeof input.parentId !== "string" || !input.parentId)
      throw new Error("A child organization requires a parent");
    await requireOrganizationAdminAll(database, actorId, input.parentId, master);
  }
  await queries(database).run(
    "INSERT INTO organizations (id, name, parent_id, color, icon, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    randomUUID(),
    name,
    input.parentId ?? null,
    "blue",
    "building",
    new Date().toISOString(),
  );
  return listOrganizations(database, actorId, master);
}

export async function updateOrganization(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
  input: UpdateOrganizationRequest,
): Promise<OrganizationSnapshot> {
  await requireOrganizationManage(database, actorId, organizationId, master);
  if (!input || typeof input.name !== "string")
    throw new Error("Organization name is required");
  const name = input.name.trim();
  if (!name) throw new Error("Organization name is required");
  if (!ORGANIZATION_COLORS.includes(input.color))
    throw new Error("Unknown organization color");
  if (!ORGANIZATION_ICONS.includes(input.icon))
    throw new Error("Unknown organization icon");
  await queries(database).run(
    "UPDATE organizations SET name = ?, color = ?, icon = ? WHERE id = ?",
    name, input.color, input.icon, organizationId,
  );
  return listOrganizations(database, actorId, master);
}

export async function assignMember(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
  input: AssignMemberRequest,
): Promise<OrganizationSnapshot> {
  await requireOrganizationManage(database, actorId, organizationId, master);
  if (!input || typeof input.userId !== "string" || !input.userId)
    throw new Error("Unknown organization account");
  await queries(database).run(
    "INSERT INTO organization_members (organization_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
    organizationId, input.userId,
  );
  return listOrganizations(database, actorId, master);
}

export async function removeMember(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
  userId: string,
): Promise<OrganizationSnapshot> {
  // see docs/internals.md#decisions
  await requireOrganizationManage(database, actorId, organizationId, master);
  if (!userId) throw new Error("Unknown organization account");

  // Both deletions or neither, and both on one connection — a pool does not
  // promise the next statement lands where `BEGIN` did.
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(positional(
      "DELETE FROM organization_responsibilities WHERE organization_id = ? AND user_id = ?",
    ), [organizationId, userId]);
    await client.query(positional(
      "DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?",
    ), [organizationId, userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return listOrganizations(database, actorId, master);
}

export async function assignResponsible(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
  input: AssignResponsibleRequest,
): Promise<OrganizationSnapshot> {
  await requireOrganizationManage(database, actorId, organizationId, master);
  if (
    !input ||
    typeof input.userId !== "string" ||
    !input.userId ||
    (input.scope !== "node" && input.scope !== "subtree")
  )
    throw new Error("Unknown organization responsibility");
  if (input.scope === "subtree")
    await requireOrganizationAdminAll(database, actorId, organizationId, master);
  await queries(database).run(
    "INSERT INTO organization_responsibilities (organization_id, user_id, scope) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET scope=excluded.scope",
    organizationId, input.userId, input.scope,
  );
  return listOrganizations(database, actorId, master);
}

export async function removeResponsible(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
  userId: string,
): Promise<OrganizationSnapshot> {
  await requireOrganizationManage(database, actorId, organizationId, master);
  if (!userId) throw new Error("Unknown organization account");
  await queries(database).run(
    "DELETE FROM organization_responsibilities WHERE organization_id = ? AND user_id = ?",
    organizationId, userId,
  );
  return listOrganizations(database, actorId, master);
}

export async function deleteOrganization(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
): Promise<OrganizationSnapshot> {
  requireMasterOrganizationMutation(master);
  await requireOrganizationManage(database, actorId, organizationId, master);
  await queries(database).run("DELETE FROM organizations WHERE id = ?", organizationId);
  return listOrganizations(database, actorId, master);
}
