import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type ProcessAction = "process.start.request" | "process.started" | "process.stdout" | "process.stderr" | "process.exit" | "process.timeout" | "process.cancel.request" | "process.cancelled";
export type ProcessStartPayload = { command: string; args?: string[]; cwd?: string; env?: Record<string, string>; timeoutMs?: number };
export type ProcessExitPayload = AgentResult<{ pid: number; exitCode: number | null; signal?: string }>;
export type ProcessEvent = AgentEvent<ProcessAction, ProcessStartPayload | { pid: number; chunk: string } | ProcessExitPayload | { reason?: string }>;
