import { createHash, randomUUID } from "node:crypto";

export type EventKind = "command" | "fact" | "result" | "progress" | "failure" | "control";

export interface IngressCommand {
  action: string;
  transactionKey: string;
  channel: string;
  replyChannel?: string;
  sessionId?: string;
  runId?: string;
  turnId?: string;
  correlationId?: string;
  payload: Record<string, unknown>;
}

/** Server-issued queue record. It is deliberately not a canonical envelope: append assigns its stream position. */
export interface IngressEvent extends IngressCommand {
  eventId: string;
  createdAt: string;
}

export interface EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> extends IngressCommand {
  eventId: string;
  eventVersion: 1;
  kind: EventKind;
  streamId: string;
  /** Decimal PostgreSQL bigint. Keep it textual so a cursor never loses precision in JSON. */
  sequence: string;
  causationEventId?: string;
  correlationId: string;
  source: "client" | "server" | "worker" | "scheduler";
  createdAt: string;
  payload: TPayload;
}

export type EventDraft<TPayload extends Record<string, unknown> = Record<string, unknown>> = Omit<EventEnvelope<TPayload>, "sequence">;

/** Derives the canonical stream identity of an event from its session or channel scope. */
export function streamIdOf(input: { sessionId?: string; channel: string }): string {
  return input.sessionId ? `session:${input.sessionId}` : `channel:${input.channel}`;
}

/**
 * Produces a stable UUID-shaped identifier for a logical event that may be derived more than once.
 * Redelivery of the same logical outcome converges on one stored row and one client-visible event id.
 */
export function deterministicEventId(name: string): string {
  const digest = createHash("sha256").update(name).digest();
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function createEventDraft(input: IngressCommand, now = new Date().toISOString()): EventDraft {
  return { ...input, eventId: randomUUID(), eventVersion: 1, kind: "command", streamId: streamIdOf(input), correlationId: input.correlationId ?? input.transactionKey, source: "client", createdAt: now };
}

export function createIngressEvent(input: Omit<IngressCommand, "transactionKey"> & { transactionKey?: string }, now = new Date().toISOString()): IngressEvent {
  return { ...input, eventId: randomUUID(), transactionKey: input.transactionKey ?? randomUUID(), createdAt: now };
}

/**
 * Derives a follow-up event that stays inside the causing event's stream.
 * Session, run, turn, stream, and correlation identity are inherited so per-stream ordering and
 * session projections cover results as well as commands.
 */
export function createDerivedDraft(cause: EventEnvelope, input: {
  eventId: string;
  action: string;
  kind: EventKind;
  payload: Record<string, unknown>;
  source?: EventEnvelope["source"];
  channel?: string;
  createdAt?: string;
}): EventDraft {
  return {
    eventId: input.eventId,
    eventVersion: 1,
    kind: input.kind,
    streamId: cause.streamId,
    action: input.action,
    transactionKey: cause.transactionKey,
    channel: input.channel ?? cause.replyChannel ?? cause.channel,
    ...(cause.replyChannel === undefined ? {} : { replyChannel: cause.replyChannel }),
    ...(cause.sessionId === undefined ? {} : { sessionId: cause.sessionId }),
    ...(cause.runId === undefined ? {} : { runId: cause.runId }),
    ...(cause.turnId === undefined ? {} : { turnId: cause.turnId }),
    causationEventId: cause.eventId,
    correlationId: cause.correlationId,
    source: input.source ?? "server",
    createdAt: input.createdAt ?? new Date().toISOString(),
    payload: input.payload,
  };
}
