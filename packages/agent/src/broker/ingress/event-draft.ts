import type { EventDraft, EventEnvelope, IngressEvent } from "../../common/index.js";
import { createDerivedDraft, streamIdOf } from "../../common/index.js";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Converts the deployed queue contract into the canonical, server-issued event draft. */
export function toEventDraft(event: IngressEvent): EventDraft {
  const payload = event.payload as Record<string, unknown>;
  const sessionId = optionalString(payload.sessionKey);
  const runId = optionalString(payload.runKey);
  const turnId = optionalString(payload.turnKey);
  return {
    eventId: event.eventId,
    eventVersion: 1,
    kind: "command",
    streamId: streamIdOf({ sessionId, channel: event.channel }),
    action: event.action,
    transactionKey: event.transactionKey,
    channel: event.channel,
    ...(event.replyChannel ? { replyChannel: event.replyChannel } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(runId ? { runId } : {}),
    ...(turnId ? { turnId } : {}),
    correlationId: event.transactionKey,
    source: "client",
    createdAt: event.createdAt,
    payload,
  };
}

/**
 * Converts a legacy result event into a canonical draft that stays in the requesting event's stream.
 * The result payload carries no session context, so identity is inherited from the persisted request.
 */
export function toResultDraft(request: EventEnvelope, input: { eventId: string; action: string; channel: string; createdAt: string; payload: Record<string, unknown>; source?: EventEnvelope["source"] }): EventDraft {
  return createDerivedDraft(request, {
    eventId: input.eventId,
    action: input.action,
    kind: "result",
    channel: input.channel,
    source: input.source,
    createdAt: input.createdAt,
    payload: input.payload,
  });
}

/**
 * A mid-execution observation. Progress is derived from the request so it lands
 * in the same stream and reaches the same reply channel as the terminal result.
 */
export function toProgressDraft(request: EventEnvelope, input: { eventId: string; action: string; payload: Record<string, unknown>; kind?: EventDraft["kind"] }): EventDraft {
  return createDerivedDraft(request, {
    eventId: input.eventId,
    action: input.action,
    kind: input.kind ?? "progress",
    channel: request.replyChannel ?? request.channel,
    source: "worker",
    payload: input.payload,
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
