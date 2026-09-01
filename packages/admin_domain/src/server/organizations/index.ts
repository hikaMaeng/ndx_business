import { randomUUID } from "node:crypto";
import {
  ORGANIZATION_COLORS,
  ORGANIZATION_ICONS,
  type AssignMemberRequest,
  type AssignResponsibleRequest,
  type CreateOrganizationRequest,
  type OrganizationColor,
  type OrganizationIcon,
  type OrganizationInferenceModel,
  type OrganizationInferenceModelOption,
  type OrganizationSnapshot,
  type SetOrganizationInferenceModelRequest,
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
  /*
   * Every registered model, not the ones some endpoint was attached to first.
   *
   * Attaching a service used to be a step of its own, and choosing a model
   * meant remembering which endpoint it lived under. There is one choice to
   * make now, so the list is every model the deployment knows about, sorted by
   * endpoint then identifier — `lower()` because a case-sensitive sort files
   * `Zeta` before `alpha` and reads as a bug in the picker.
   */
  const inferenceModelOptionRows = await ask.all(
    "SELECT definition.id AS model_id, definition.identifier, endpoint.id AS endpoint_id, endpoint.name AS endpoint_name FROM model_definitions definition JOIN model_endpoints endpoint ON endpoint.id = definition.endpoint_id ORDER BY lower(endpoint.name), lower(definition.identifier)",
  ) as Array<{ model_id: string; identifier: string; endpoint_id: string; endpoint_name: string }>;
  // At most one row per organisation, which the partial unique index on
  // `active = 1` is what actually guarantees.
  const inferenceModelRows = await ask.all(
    "SELECT item.organization_id, definition.id AS model_id, definition.identifier, endpoint.id AS endpoint_id, endpoint.name AS endpoint_name FROM organization_inference_models item JOIN model_definitions definition ON definition.id = item.model_id JOIN model_endpoints endpoint ON endpoint.id = definition.endpoint_id WHERE item.active = 1",
  ) as Array<{
    organization_id: string;
    model_id: string;
    identifier: string;
    endpoint_id: string;
    endpoint_name: string;
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
    inferenceModelOptions: inferenceModelOptionRows.map((row) => ({
      modelId: row.model_id,
      endpointId: row.endpoint_id,
      endpointName: row.endpoint_name,
      identifier: row.identifier,
    } satisfies OrganizationInferenceModelOption)),
    inferenceModels: inferenceModelRows.map((row) => ({
      organizationId: row.organization_id,
      modelId: row.model_id,
      endpointId: row.endpoint_id,
      endpointName: row.endpoint_name,
      identifier: row.identifier,
    } satisfies OrganizationInferenceModel)),
    access: await buildOrganizationAccess(
      database,
      actorId,
      master,
      organizationRows.map((row) => row.id),
    ),
  } satisfies OrganizationSnapshot;
}

/**
 * Points an organisation at its one model, replacing whatever it had.
 *
 * Replacing rather than adding is the whole point: the resolver takes the
 * first organisation up the chain with a model, so a second one attached here
 * would be a preference nobody could express and the database would have to
 * break the tie. Clearing first also lets somebody move an organisation from
 * one endpoint's model to another's without the partial unique index refusing
 * the insert half-way through.
 *
 * The endpoint is read from the model rather than asked for. A model belongs
 * to exactly one endpoint, so accepting both would let a caller name a pairing
 * that does not exist.
 */
export async function setOrganizationInferenceModel(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
  input: SetOrganizationInferenceModelRequest,
): Promise<OrganizationSnapshot> {
  await requireOrganizationManage(database, actorId, organizationId, master);
  if (!input || typeof input.modelId !== "string" || !input.modelId)
    throw new Error("Unknown inference model");
  const definition = await queries(database).get(
    "SELECT id, endpoint_id FROM model_definitions WHERE id = ?",
    input.modelId,
  ) as { id: string; endpoint_id: string } | undefined;
  if (!definition) throw new Error("Unknown inference model");

  // All three statements or none, and all three on one connection — a pool does
  // not promise the next statement lands where `BEGIN` did. A delete that
  // committed without its insert would read as an organisation that quietly
  // dropped back to inheriting.
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(positional(
      "DELETE FROM organization_inference_models WHERE organization_id = ?",
    ), [organizationId]);
    // The service row exists only to satisfy the model row's composite foreign
    // key; nobody manages it directly any more.
    await client.query(positional(
      "INSERT INTO organization_inference_services (organization_id, endpoint_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
    ), [organizationId, definition.endpoint_id]);
    await client.query(positional(
      "INSERT INTO organization_inference_models (organization_id, endpoint_id, model_id, active) VALUES (?, ?, ?, 1)",
    ), [organizationId, definition.endpoint_id, definition.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return listOrganizations(database, actorId, master);
}

/**
 * Takes the organisation's model away, so it inherits again.
 *
 * Clearing what is already clear is not an error; it is the state being asked
 * for, and a double-click on the button should not raise one.
 */
export async function clearOrganizationInferenceModel(
  database: AdminDatabase,
  actorId: string,
  master: boolean,
  organizationId: string,
): Promise<OrganizationSnapshot> {
  await requireOrganizationManage(database, actorId, organizationId, master);
  await queries(database).run(
    "DELETE FROM organization_inference_models WHERE organization_id = ?",
    organizationId,
  );
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
