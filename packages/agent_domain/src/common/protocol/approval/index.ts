import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type ApprovalAction = "approval.request" | "approval.granted" | "approval.rejected" | "approval.expired";
export type ApprovalPayload = { approvalKey: string; reason: string; operation: string; expiresAt?: string; details?: Record<string, unknown> };
export type ApprovalResultPayload = AgentResult<{ approvalKey: string; decidedBy?: string }>;
export type ApprovalEvent = AgentEvent<ApprovalAction, ApprovalPayload | ApprovalResultPayload>;
