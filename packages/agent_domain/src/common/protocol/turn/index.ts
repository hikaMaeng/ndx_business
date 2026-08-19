import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type TurnAction = "turn.start.request" | "turn.input.append.request" | "turn.stop.request" | "turn.final.response" | "turn.cancelled.response" | "turn.failed.response";
export type TurnStatus = "queued" | "running" | "waiting_tool" | "waiting_approval" | "completed" | "failed" | "cancelled";
export type TurnInput = { role: "user" | "system"; content: string; attachments?: string[] };
export type TurnRecord = { turnKey: string; sessionKey: string; status: TurnStatus; input: TurnInput[]; output?: string; usage?: { inputTokens: number; outputTokens: number }; startedAt: string; completedAt?: string };
export type TurnStartPayload = { input: TurnInput; modelKey?: string; options?: Record<string, unknown> };
export type TurnFinalPayload = AgentResult<{ output: string; usage?: TurnRecord["usage"]; finishReason: string }>;
export type TurnEvent = AgentEvent<TurnAction, TurnStartPayload | TurnFinalPayload | { reason?: string }>;
