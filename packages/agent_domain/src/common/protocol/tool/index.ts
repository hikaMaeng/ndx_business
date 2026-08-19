import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type ToolAction = "tool.call.request" | "tool.started" | "tool.progress" | "tool.stdout" | "tool.stderr" | "tool.completed" | "tool.failed" | "tool.cancel.request" | "tool.cancelled";
export type ToolStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
export type ToolCallPayload = { name: string; input: Record<string, unknown>; timeoutMs?: number; cwd?: string };
export type ToolOutputPayload = { stdout?: string; stderr?: string; exitCode?: number; result?: unknown; truncated?: boolean };
export type ToolRecord = { toolCallKey: string; name: string; status: ToolStatus; input: Record<string, unknown>; output?: ToolOutputPayload; startedAt?: string; completedAt?: string };
export type ToolCompletedPayload = AgentResult<ToolOutputPayload>;
export type ToolEvent = AgentEvent<ToolAction, ToolCallPayload | ToolOutputPayload | ToolCompletedPayload | { reason?: string }>;
