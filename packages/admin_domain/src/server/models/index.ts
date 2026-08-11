import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  MODEL_ENDPOINT_TYPES,
  type CreateModelEndpointRequest,
  type ModelCatalogSnapshot,
  type ModelDefinition,
  type ModelEndpoint,
  type ModelEndpointType,
  type UpdateModelDefinitionRequest,
  type UpdateModelEndpointRequest,
} from "../../common/protocol/models/index.js";

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
    contextSize: row.context_size,
    temperature: row.temperature,
    minP: row.min_p,
    topP: row.top_p,
    topK: row.top_k,
    repeatPenalty: row.repeat_penalty,
    reasoning: Boolean(row.reasoning),
    supportsText: Boolean(row.supports_text),
    supportsImage: Boolean(row.supports_image),
    supportsSound: Boolean(row.supports_sound),
    supportsVideo: Boolean(row.supports_video),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getEndpoint(database: DatabaseSync, endpointId: string): ModelEndpoint {
  const row = database
    .prepare("SELECT * FROM model_endpoints WHERE id = ?")
    .get(endpointId) as EndpointRow | undefined;
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

export function listModelCatalog(database: DatabaseSync): ModelCatalogSnapshot {
  const endpoints = database
    .prepare("SELECT * FROM model_endpoints ORDER BY name COLLATE NOCASE")
    .all() as EndpointRow[];
  const models = database
    .prepare("SELECT * FROM model_definitions ORDER BY identifier COLLATE NOCASE")
    .all() as ModelRow[];
  return {
    endpoints: endpoints.map(endpointFromRow),
    models: models.map(modelFromRow),
  } satisfies ModelCatalogSnapshot;
}

export function createModelEndpoint(
  database: DatabaseSync,
  input: CreateModelEndpointRequest,
): ModelCatalogSnapshot {
  assertEndpointInput(input);
  const now = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO model_endpoints (id, name, url, header_name, header_value, api_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(randomUUID(), input.name.trim(), input.url.trim(), input.headerName.trim(), input.headerValue.trim(), input.type, now, now);
  return listModelCatalog(database);
}

export function updateModelEndpoint(
  database: DatabaseSync,
  endpointId: string,
  input: UpdateModelEndpointRequest,
): ModelCatalogSnapshot {
  assertEndpointInput(input);
  getEndpoint(database, endpointId);
  database
    .prepare(
      "UPDATE model_endpoints SET name = ?, url = ?, header_name = ?, header_value = ?, api_type = ?, updated_at = ? WHERE id = ?",
    )
    .run(input.name.trim(), input.url.trim(), input.headerName.trim(), input.headerValue.trim(), input.type, new Date().toISOString(), endpointId);
  return listModelCatalog(database);
}

export async function refreshModelEndpoint(
  database: DatabaseSync,
  endpointId: string,
): Promise<ModelCatalogSnapshot> {
  const endpoint = getEndpoint(database, endpointId);
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
  const insert = database.prepare(
    "INSERT INTO model_definitions (id, endpoint_id, identifier, context_size, temperature, min_p, top_p, top_k, repeat_penalty, reasoning, supports_text, supports_image, supports_sound, supports_video, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, ?, ?) ON CONFLICT(endpoint_id, identifier) DO NOTHING",
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const identifier of identifiers) insert.run(randomUUID(), endpointId, identifier, now, now);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return listModelCatalog(database);
}

export function updateModelDefinition(
  database: DatabaseSync,
  endpointId: string,
  modelId: string,
  input: UpdateModelDefinitionRequest,
): ModelCatalogSnapshot {
  assertModelInput(input);
  const changed = database
    .prepare(
      "UPDATE model_definitions SET identifier = ?, context_size = ?, temperature = ?, min_p = ?, top_p = ?, top_k = ?, repeat_penalty = ?, reasoning = ?, supports_text = ?, supports_image = ?, supports_sound = ?, supports_video = ?, updated_at = ? WHERE id = ? AND endpoint_id = ?",
    )
    .run(input.identifier.trim(), input.contextSize, input.temperature, input.minP, input.topP, input.topK, input.repeatPenalty, Number(input.reasoning), Number(input.supportsText), Number(input.supportsImage), Number(input.supportsSound), Number(input.supportsVideo), new Date().toISOString(), modelId, endpointId);
  if (!changed.changes) throw new Error("Unknown endpoint model");
  return listModelCatalog(database);
}
