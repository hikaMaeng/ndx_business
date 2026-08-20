import type { AgentEvent, EventDraft, EventEnvelope, EventKind } from "agent_domain/common";
import { createDerivedDraft, streamIdOf } from "agent_domain/common";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function kindOf(event: AgentEvent): EventKind {
  if (event.kind === "result") return "result";
  if (event.kind === "heartbeat") return "control";
  return "command";
}

/** Converts the deployed queue contract into the canonical, server-issued event draft. */
export function toEventDraft(event: AgentEvent): EventDraft {
  const payload = event.payload as Record<string, unknown>;
  const sessionId = optionalString(payload.sessionKey);
  const runId = optionalString(payload.runKey);
  const turnId = optionalString(payload.turnKey);
  return {
    eventId: event.eventId,
    eventVersion: 1,
    kind: kindOf(event),
    streamId: streamIdOf({ sessionId, channel: event.channel }),
    action: event.action,
    transactionKey: event.transactionKey,
    channel: event.channel,
    ...(event.replyChannel ? { replyChannel: event.replyChannel } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(runId ? { runId } : {}),
    ...(turnId ? { turnId } : {}),
    correlationId: event.transactionKey,
    source: event.kind === "request" ? "client" : "server",
    createdAt: event.createdAt,
    payload,
  };
}

/**
 * Converts a legacy result event into a canonical draft that stays in the requesting event's stream.
 * The result payload carries no session context, so identity is inherited from the persisted request.
 */
export function toResultDraft(request: EventEnvelope, result: AgentEvent): EventDraft {
  return createDerivedDraft(request, {
    eventId: result.eventId,
    action: result.action,
    kind: "result",
    channel: result.channel,
    createdAt: result.createdAt,
    payload: result.payload as Record<string, unknown>,
  });
}

/** Records a job-scoped permanent processing failure without occupying the transaction result identity. */
export function toProcessingFailureDraft(request: EventEnvelope, eventId: string, message: string): EventDraft {
  return createDerivedDraft(request, {
    eventId,
    action: `${request.action}.processing.failure`,
    kind: "failure",
    source: "scheduler",
    channel: request.replyChannel ?? request.channel,
    payload: { ok: false, error: { code: "processing_permanent_failure", message } },
  });
}
