import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type StateAction = "kv.put.request" | "kv.get.request" | "kv.delete.request" | "kv.persist.request" | "kv.persisted.response" | "compaction.start.request" | "compaction.progress" | "compaction.completed.response" | "checkpoint.create.request" | "checkpoint.created.response";
export type KvPayload = { namespace: string; key: string; value?: unknown; version?: number };
export type CompactionPayload = { reason: "context_limit" | "manual" | "checkpoint"; keepLastTurns?: number; targetTokens?: number };
export type StateResultPayload = AgentResult<{ namespace?: string; key?: string; version?: number; summary?: string; removedTurnKeys?: string[] }>;
export type StateEvent = AgentEvent<StateAction, KvPayload | CompactionPayload | StateResultPayload>;
