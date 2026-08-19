import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type HookName = "before_session" | "after_session" | "before_turn" | "after_turn" | "before_iteration" | "after_iteration" | "before_tool" | "after_tool" | "before_compaction" | "after_compaction";
export type HookAction = "hook.invoke.request" | "hook.started" | "hook.completed" | "hook.failed" | "hook.skipped";
export type HookPayload = { name: HookName; input: Record<string, unknown>; timeoutMs?: number };
export type HookResultPayload = AgentResult<{ output?: Record<string, unknown>; mutations?: Record<string, unknown> }>;
export type HookEvent = AgentEvent<HookAction, HookPayload | HookResultPayload | { reason?: string }>;
