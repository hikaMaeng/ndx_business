import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type ModelAction = "model.select.request" | "model.change.request" | "model.defaults.update.request" | "model.selected.response" | "model.defaults.updated.response";
export type ModelSpec = { modelKey: string; provider?: string; temperature?: number; maxTokens?: number; options?: Record<string, unknown> };
export type ModelDefaults = { modelKey: string; options: Record<string, unknown>; updatedAt: string };
export type ModelResultPayload = AgentResult<ModelSpec | ModelDefaults>;
export type ModelEvent = AgentEvent<ModelAction, { model?: ModelSpec; defaults?: Partial<ModelDefaults> } | ModelResultPayload>;
