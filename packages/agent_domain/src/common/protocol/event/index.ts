import { randomUUID } from "node:crypto";

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

export interface EventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> extends IngressCommand {
  eventId: string;
  eventVersion: 1;
  kind: EventKind;
  streamId: string;
  sequence: number;
  correlationId: string;
  source: "client" | "server" | "worker" | "scheduler";
  createdAt: string;
  payload: TPayload;
}

export type EventDraft<TPayload extends Record<string, unknown> = Record<string, unknown>> = Omit<EventEnvelope<TPayload>, "sequence">;

export function createEventDraft(input: IngressCommand, now = new Date().toISOString()): EventDraft {
  const streamId = input.sessionId ? `session:${input.sessionId}` : `channel:${input.channel}`;
  return { ...input, eventId: randomUUID(), eventVersion: 1, kind: "command", streamId, correlationId: input.correlationId ?? input.transactionKey, source: "client", createdAt: now };
}
