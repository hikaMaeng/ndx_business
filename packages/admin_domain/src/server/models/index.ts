import { randomUUID } from "node:crypto";
import {
  MODEL_ENDPOINT_TYPES,
  type CreateModelDefinitionRequest,
  type CreateModelEndpointRequest,
  type ModelCatalogSnapshot,
  type ModelDefinition,
  type ModelEndpoint,
  type ModelEndpointType,
  type SetModelDefaultRequest,
  type UpdateModelDefinitionRequest,
  type UpdateModelEndpointRequest,
} from "../../common/protocol/models/index.js";
import { positional, queries, type AdminDatabase } from "../database/index.js";

type EndpointRow = {
  id: string;
  name: string;
  url: string;
  header_name: string;
  header_value: string;
  api_type: ModelEndpointType;
  created_at: string;
  updated_at: string;
};

type ModelRow = {
  id: string;
  endpoint_id: string;
  identifier: string;
  context_size: number;
  temperature: number;
  min_p: number;
  top_p: number;
  top_k: number;
  repeat_penalty: number;
  reasoning: number;
  supports_text: number;
  supports_image: number;
  supports_sound: number;
  supports_video: number;
  is_default: number;
  created_at: string;
  updated_at: string;
};

function endpointFromRow(row: EndpointRow): ModelEndpoint {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    headerName: row.header_name,
    headerValue: row.header_value,
    type: row.api_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function modelFromRow(row: ModelRow): ModelDefinition {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    identifier: row.identifier,
    contextSize: Number(row.context_size),
    temperature: Number(row.temperature),
    minP: Number(row.min_p),
    topP: Number(row.top_p),
    topK: Number(row.top_k),
    repeatPenalty: Number(row.repeat_penalty),
    reasoning: Boolean(row.reasoning),
    supportsText: Boolean(row.supports_text),
    supportsImage: Boolean(row.supports_image),
    supportsSound: Boolean(row.supports_sound),
    supportsVideo: Boolean(row.supports_video),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getEndpoint(database: AdminDatabase, endpointId: string): Promise<ModelEndpoint> {
  const row = await queries(database).get("SELECT * FROM model_endpoints WHERE id = ?", endpointId) as EndpointRow | undefined;
  if (!row) throw new Error("Unknown model endpoint");
  return endpointFromRow(row);
}

function assertEndpointInput(input: CreateModelEndpointRequest | UpdateModelEndpointRequest): void {
  if (!input || typeof input.name !== "string" || !input.name.trim())
    throw new Error("Endpoint name is required");
  if (typeof input.url !== "string" || !input.url.trim())
    throw new Error("Endpoint URL is required");
  try {
    const url = new URL(input.url);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("Endpoint URL must use HTTP or HTTPS");
  } catch {
    throw new Error("Endpoint URL is invalid");
  }
  if (typeof input.headerName !== "string" || typeof input.headerValue !== "string")
    throw new Error("Endpoint header is invalid");
  if (Boolean(input.headerName.trim()) !== Boolean(input.headerValue.trim()))
    throw new Error("Endpoint header name and value must be supplied together");
  if (!MODEL_ENDPOINT_TYPES.includes(input.type))
    throw new Error("Unknown endpoint API type");
}

function assertModelInput(input: UpdateModelDefinitionRequest): void {
  if (!input || typeof input.identifier !== "string" || !input.identifier.trim())
    throw new Error("Model identifier is required");
  for (const [name, value] of Object.entries({
    contextSize: input.contextSize,
    temperature: input.temperature,
    minP: input.minP,
    topP: input.topP,
    topK: input.topK,
    repeatPenalty: input.repeatPenalty,
  })) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  }
  if (input.contextSize < 0 || input.topK < 0)
    throw new Error("Context size and top K cannot be negative");
  if (input.minP < 0 || input.topP < 0 || input.topP > 1)
    throw new Error("Probability values must be between zero and one");
  if (
    typeof input.reasoning !== "boolean" ||
    typeof input.supportsText !== "boolean" ||
    typeof input.supportsImage !== "boolean" ||
    typeof input.supportsSound !== "boolean" ||
    typeof input.supportsVideo !== "boolean"
  )
    throw new Error("Model capability values are invalid");
}

function modelsUrl(endpoint: ModelEndpoint): string {
  const url = new URL(endpoint.url);
  const path = url.pathname.replace(/\/$/, "");
  if (path.endsWith("/models")) return url.toString();
  if (endpoint.type === "openai-chat-completion" && path.endsWith("/chat/completions"))
    url.pathname = path.slice(0, -"/chat/completions".length) + "/models";
  else if (endpoint.type === "openai-responses" && path.endsWith("/responses"))
    url.pathname = path.slice(0, -"/responses".length) + "/models";
  else if (endpoint.type === "anthropic" && path.endsWith("/messages"))
    url.pathname = path.slice(0, -"/messages".length) + "/models";
  else url.pathname = `${path}/models`;
  return url.toString();
}

function identifiersFromProvider(type: ModelEndpointType, value: unknown): string[] {
  if (!value || typeof value !== "object") throw new Error("Provider returned an invalid models response");
  const record = value as Record<string, unknown>;
  const candidates = type === "gemini" ? record.models : record.data;
  if (!Array.isArray(candidates)) throw new Error("Provider returned no model list");
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    const identifier = type === "gemini" ? row.name : row.id;
    return typeof identifier === "string" && identifier.trim() ? [identifier.trim()] : [];
  });
}

/** PostgreSQL's unique-violation code, which is how a duplicate arrives now. */
const UNIQUE_VIOLATION = "23505";

export async function listModelCatalog(database: AdminDatabase): Promise<ModelCatalogSnapshot> {
  // `lower()` so the ordering is case-insensitive, which is what the screen
  // has always shown.
  const endpoints = await queries(database).all("SELECT * FROM model_endpoints ORDER BY lower(name)") as EndpointRow[];
  const models = await queries(database).all("SELECT * FROM model_definitions ORDER BY lower(identifier)") as ModelRow[];
  return {
    endpoints: endpoints.map(endpointFromRow),
    models: models.map(modelFromRow),
  } satisfies ModelCatalogSnapshot;
}

export async function createModelEndpoint(
  database: AdminDatabase,
  input: CreateModelEndpointRequest,
): Promise<ModelCatalogSnapshot> {
  assertEndpointInput(input);
  const now = new Date().toISOString();
  await queries(database).run(
    "INSERT INTO model_endpoints (id, name, url, header_name, header_value, api_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    randomUUID(), input.name.trim(), input.url.trim(), input.headerName.trim(), input.headerValue.trim(), input.type, now, now,
  );
  return listModelCatalog(database);
}

export async function updateModelEndpoint(
  database: AdminDatabase,
  endpointId: string,
  input: UpdateModelEndpointRequest,
): Promise<ModelCatalogSnapshot> {
  assertEndpointInput(input);
  await getEndpoint(database, endpointId);
  await queries(database).run(
    "UPDATE model_endpoints SET name = ?, url = ?, header_name = ?, header_value = ?, api_type = ?, updated_at = ? WHERE id = ?",
    input.name.trim(), input.url.trim(), input.headerName.trim(), input.headerValue.trim(), input.type, new Date().toISOString(), endpointId,
  );
  return listModelCatalog(database);
}

export async function refreshModelEndpoint(
  database: AdminDatabase,
  endpointId: string,
): Promise<ModelCatalogSnapshot> {
  const endpoint = await getEndpoint(database, endpointId);
  const headers = endpoint.headerName
    ? { [endpoint.headerName]: endpoint.headerValue }
    : undefined;
  const response = await fetch(modelsUrl(endpoint), {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Provider model request failed (${response.status})`);
  // see docs/internals.md#decisions
  const identifiers = [...new Set(identifiersFromProvider(endpoint.type, await response.json()))]
    .filter((identifier) => !identifier.toLowerCase().includes("embedding"));
  const now = new Date().toISOString();

  /**
   * One client, not the pool.
   *
   * `BEGIN` on a pool is a promise that the next statement lands on the same
   * connection, and a pool makes no such promise — the inserts could scatter
   * across connections and the commit would apply to whichever one happened to
   * run it. A whole provider refresh landing half-applied is exactly what the
   * transaction was there to prevent.
   */
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    for (const identifier of identifiers) {
      await client.query(positional(
        // `is_default` is 0 here as it is on a manual create, and `DO NOTHING`
        // keeps a refresh from writing over a model that already holds it: a
        // provider listing its catalogue is not a decision about this
        // deployment's fallback.
        "INSERT INTO model_definitions (id, endpoint_id, identifier, context_size, temperature, min_p, top_p, top_k, repeat_penalty, reasoning, supports_text, supports_image, supports_sound, supports_video, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, ?, ?) ON CONFLICT (endpoint_id, identifier) DO NOTHING",
      ), [randomUUID(), endpointId, identifier, now, now]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return listModelCatalog(database);
}

export async function createModelDefinition(
  database: AdminDatabase,
  endpointId: string,
  input: CreateModelDefinitionRequest,
): Promise<ModelCatalogSnapshot> {
  assertModelInput(input);
  await getEndpoint(database, endpointId);
  const now = new Date().toISOString();
  try {
    // `is_default` is written as 0 rather than left to the column default, so
    // that registering a model is visibly never the act that moves the
    // deployment default. Moving it has its own call below.
    await queries(database).run(
      "INSERT INTO model_definitions (id, endpoint_id, identifier, context_size, temperature, min_p, top_p, top_k, repeat_penalty, reasoning, supports_text, supports_image, supports_sound, supports_video, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
      randomUUID(), endpointId, input.identifier.trim(), input.contextSize, input.temperature, input.minP, input.topP, input.topK, input.repeatPenalty, Number(input.reasoning), Number(input.supportsText), Number(input.supportsImage), Number(input.supportsSound), Number(input.supportsVideo), now, now,
    );
  } catch (error) {
    // Matched on the code rather than the message, so it survives a server
    // running in another language.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION)
      throw new Error("A model with this identifier already exists for the endpoint");
    throw error;
  }
  return listModelCatalog(database);
}

export async function updateModelDefinition(
  database: AdminDatabase,
  endpointId: string,
  modelId: string,
  input: UpdateModelDefinitionRequest,
): Promise<ModelCatalogSnapshot> {
  assertModelInput(input);
  const changed = await queries(database).run(
    "UPDATE model_definitions SET identifier = ?, context_size = ?, temperature = ?, min_p = ?, top_p = ?, top_k = ?, repeat_penalty = ?, reasoning = ?, supports_text = ?, supports_image = ?, supports_sound = ?, supports_video = ?, updated_at = ? WHERE id = ? AND endpoint_id = ?",
    input.identifier.trim(), input.contextSize, input.temperature, input.minP, input.topP, input.topK, input.repeatPenalty, Number(input.reasoning), Number(input.supportsText), Number(input.supportsImage), Number(input.supportsSound), Number(input.supportsVideo), new Date().toISOString(), modelId, endpointId,
  );
  if (!changed.changes) throw new Error("Unknown endpoint model");
  return listModelCatalog(database);
}

/**
 * Move the deployment default onto one model, or take it off that model.
 *
 * `idx_model_definitions_default` is a unique index over `is_default` restricted
 * to the rows holding it, so the table can never carry two defaults. That is
 * also why setting a new one cannot be a single UPDATE: the moment the new row
 * turns 1 while the old one still is, the index rejects the write and the
 * administrator sees a constraint error instead of a moved default.
 *
 * So the old holder is cleared first and the new one set second, and both run
 * on one connection inside one transaction. PostgreSQL checks a non-deferrable
 * unique index at the end of each statement, so the intermediate state the
 * transaction passes through — no default at all — is a state the index is
 * happy with, while nothing outside the transaction ever observes it. Splitting
 * the two statements across a pool would be worse than useless: `BEGIN` does not
 * reserve the connection the next statement lands on, and a clear that commits
 * without its matching set leaves the deployment with no default and every
 * organisation-less account unable to open a session.
 */
export async function setModelDefault(
  database: AdminDatabase,
  endpointId: string,
  modelId: string,
  input: SetModelDefaultRequest,
): Promise<ModelCatalogSnapshot> {
  const now = new Date().toISOString();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // Named by both ids, so a request carrying a model id from one endpoint and
    // an endpoint id from another is rejected rather than quietly clearing the
    // default it happened to reach.
    const target = await client.query(positional("SELECT id FROM model_definitions WHERE id = ? AND endpoint_id = ?"), [modelId, endpointId]);
    if (!target.rows[0]) throw new Error("Unknown endpoint model");
    // Excluding the target keeps re-setting the model that already holds it from
    // clearing and re-writing the same row for no change.
    await client.query(positional("UPDATE model_definitions SET is_default = 0, updated_at = ? WHERE is_default = 1 AND id <> ?"), [now, modelId]);
    await client.query(positional("UPDATE model_definitions SET is_default = ?, updated_at = ? WHERE id = ?"), [input.isDefault ? 1 : 0, now, modelId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    // Two administrators moving the default at once: the loser's clear no longer
    // matches the row the winner already cleared, so its own set trips the index.
    // Reported as a conflict to reload from, because retrying blindly would hand
    // the default to whoever pressed the button least recently.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION)
      throw new Error("The default model changed while this was saving; reload and try again");
    throw error;
  } finally {
    client.release();
  }
  return listModelCatalog(database);
}
