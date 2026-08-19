import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type IterationAction = "iteration.start.request" | "iteration.progress" | "iteration.merge.request" | "iteration.merged.response" | "iteration.failed.response";
export type IterationStatus = "running" | "waiting_tool" | "merging" | "completed" | "failed";
export type IterationRecord = { iterationKey: string; turnKey: string; index: number; status: IterationStatus; text?: string; toolCallKeys: string[] };
export type IterationStartPayload = { index: number; prompt?: string };
export type IterationProgressPayload = { delta?: string; reasoning?: string; toolCallKeys?: string[] };
export type IterationMergedPayload = AgentResult<{ text: string; toolResults: unknown[]; nextAction?: "continue" | "complete" }>;
export type IterationEvent = AgentEvent<IterationAction, IterationStartPayload | IterationProgressPayload | IterationMergedPayload>;
