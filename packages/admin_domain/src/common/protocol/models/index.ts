export const MODEL_ENDPOINT_TYPES = [
  "openai-chat-completion",
  "openai-responses",
  "anthropic",
  "gemini",
] as const;

export type ModelEndpointType = (typeof MODEL_ENDPOINT_TYPES)[number];

export type ModelEndpoint = {
  id: string;
  name: string;
  url: string;
  headerName: string;
  headerValue: string;
  type: ModelEndpointType;
  createdAt: string;
  updatedAt: string;
};

export type ModelDefinition = {
  id: string;
  endpointId: string;
  identifier: string;
  contextSize: number;
  temperature: number;
  minP: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  reasoning: boolean;
  supportsText: boolean;
  supportsImage: boolean;
  supportsSound: boolean;
  supportsVideo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ModelCatalogSnapshot = {
  endpoints: ModelEndpoint[];
  models: ModelDefinition[];
};

export type CreateModelEndpointRequest = Pick<
  ModelEndpoint,
  "name" | "url" | "headerName" | "headerValue" | "type"
>;

export type UpdateModelEndpointRequest = CreateModelEndpointRequest;

export type UpdateModelDefinitionRequest = Pick<
  ModelDefinition,
  | "identifier"
  | "contextSize"
  | "temperature"
  | "minP"
  | "topP"
  | "topK"
  | "repeatPenalty"
  | "reasoning"
  | "supportsText"
  | "supportsImage"
  | "supportsSound"
  | "supportsVideo"
>;

export type CreateModelDefinitionRequest = UpdateModelDefinitionRequest;

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object"; }
function endpointRequest(value: unknown): CreateModelEndpointRequest | null {
  return isRecord(value) && typeof value.name === "string" && typeof value.url === "string" && typeof value.headerName === "string" && typeof value.headerValue === "string" && MODEL_ENDPOINT_TYPES.includes(value.type as ModelEndpointType)
    ? { name: value.name, url: value.url, headerName: value.headerName, headerValue: value.headerValue, type: value.type as ModelEndpointType } : null;
}
export const parseCreateModelEndpointRequest = endpointRequest;
export const parseUpdateModelEndpointRequest = endpointRequest;
export function parseModelDefinitionRequest(value: unknown): UpdateModelDefinitionRequest | null {
  if (!isRecord(value) || typeof value.identifier !== "string" || typeof value.contextSize !== "number" || typeof value.temperature !== "number" || typeof value.minP !== "number" || typeof value.topP !== "number" || typeof value.topK !== "number" || typeof value.repeatPenalty !== "number" || typeof value.reasoning !== "boolean" || typeof value.supportsText !== "boolean" || typeof value.supportsImage !== "boolean" || typeof value.supportsSound !== "boolean" || typeof value.supportsVideo !== "boolean") return null;
  return { identifier: value.identifier, contextSize: value.contextSize, temperature: value.temperature, minP: value.minP, topP: value.topP, topK: value.topK, repeatPenalty: value.repeatPenalty, reasoning: value.reasoning, supportsText: value.supportsText, supportsImage: value.supportsImage, supportsSound: value.supportsSound, supportsVideo: value.supportsVideo };
}

export const modelCatalogRoute = { path: "/api/models", method: "GET" } as const;
export const createModelEndpointRoute = { path: "/api/models", method: "POST" } as const;
export const updateModelEndpointRoute = { path: "/api/models/:endpointId", method: "PUT" } as const;
export const refreshModelEndpointRoute = { path: "/api/models/:endpointId/refresh", method: "POST" } as const;
export const createModelDefinitionRoute = { path: "/api/models/:endpointId/models", method: "POST" } as const;
export const updateModelDefinitionRoute = { path: "/api/models/:endpointId/models/:modelId", method: "PUT" } as const;

function isEndpoint(value: unknown): value is ModelEndpoint {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string" &&
    typeof value.headerName === "string" &&
    typeof value.headerValue === "string" &&
    MODEL_ENDPOINT_TYPES.includes(value.type as ModelEndpointType) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isModelDefinition(value: unknown): value is ModelDefinition {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.endpointId === "string" &&
    typeof value.identifier === "string" &&
    typeof value.contextSize === "number" &&
    typeof value.temperature === "number" &&
    typeof value.minP === "number" &&
    typeof value.topP === "number" &&
    typeof value.topK === "number" &&
    typeof value.repeatPenalty === "number" &&
    typeof value.reasoning === "boolean" &&
    typeof value.supportsText === "boolean" &&
    typeof value.supportsImage === "boolean" &&
    typeof value.supportsSound === "boolean" &&
    typeof value.supportsVideo === "boolean" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function parseModelCatalogSnapshot(value: unknown): ModelCatalogSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.endpoints) || !Array.isArray(value.models))
    return null;
  return value.endpoints.every(isEndpoint) && value.models.every(isModelDefinition)
    ? (value as ModelCatalogSnapshot)
    : null;
}
