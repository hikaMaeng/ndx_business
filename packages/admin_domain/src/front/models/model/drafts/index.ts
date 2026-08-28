import type {
  CreateModelDefinitionRequest,
  CreateModelEndpointRequest,
  ModelDefinition,
  ModelEndpoint,
} from "../../../../common/protocol/models/index.js";

export type EndpointDraft = CreateModelEndpointRequest;
export type ModelDefinitionDraft = CreateModelDefinitionRequest;

/**
 * A blank form, or an existing record opened for editing.
 *
 * Which fields a draft carries, and what an empty one starts as, is a fact
 * about the endpoint — not about the form that happens to show it. Keeping it
 * here means a second surface editing the same thing cannot invent a different
 * set of defaults, and the shape stays next to the request type it becomes.
 */
export function createEndpointDraft(endpoint?: ModelEndpoint): EndpointDraft {
  return endpoint
    ? { name: endpoint.name, url: endpoint.url, headerName: endpoint.headerName, headerValue: endpoint.headerValue, type: endpoint.type }
    : { name: "", url: "", headerName: "", headerValue: "", type: "openai-chat-completion" };
}

export function createModelDefinitionDraft(item?: ModelDefinition): ModelDefinitionDraft {
  return item
    ? {
        identifier: item.identifier, contextSize: item.contextSize, temperature: item.temperature,
        minP: item.minP, topP: item.topP, topK: item.topK, repeatPenalty: item.repeatPenalty,
        reasoning: item.reasoning, supportsText: item.supportsText, supportsImage: item.supportsImage,
        supportsSound: item.supportsSound, supportsVideo: item.supportsVideo,
      }
    : {
        identifier: "", contextSize: 0, temperature: 1, minP: 0, topP: 1, topK: 0, repeatPenalty: 1,
        reasoning: false, supportsText: true, supportsImage: false, supportsSound: false, supportsVideo: false,
      };
}
