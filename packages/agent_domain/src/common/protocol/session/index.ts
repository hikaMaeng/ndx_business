import type { AgentEvent, AgentResult } from "../envelope/index.js";

export type SessionAction = "session.create.request" | "session.delete.request" | "session.get.request" | "session.snapshot.response" | "session.deleted.response" | "session.cancel.request" | "session.cancelled.response" | "session.resume.request" | "session.resumed.response";
export type SessionStatus = "active" | "compacting" | "waiting" | "completed" | "cancelled" | "deleted";
export type SessionRecord = { sessionKey: string; ownerKey: string; status: SessionStatus; modelKey: string; createdAt: string; updatedAt: string; metadata: Record<string, unknown> };
export type SessionCreatePayload = { ownerKey: string; modelKey: string; metadata?: Record<string, unknown> };
export type SessionSnapshotPayload = AgentResult<SessionRecord> & { revision: number };
export type SessionEvent = AgentEvent<SessionAction, SessionCreatePayload | SessionSnapshotPayload | { reason?: string }>;
