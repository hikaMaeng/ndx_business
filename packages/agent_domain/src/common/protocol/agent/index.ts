import { randomUUID } from "node:crypto";

export type AgentEventKind = "request" | "result" | "heartbeat";

export interface AgentEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  transactionKey: string;
  kind: AgentEventKind;
  channel: string;
  action: string;
  source: string;
  replyChannel?: string;
  createdAt: string;
  payload: TPayload;
}

export interface AgentResultPayload {
  [key: string]: unknown;
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
}

export function createRequestEvent(input: {
  transactionKey?: string;
  action: string;
  payload: Record<string, unknown>;
  channel?: string;
  source?: string;
  replyChannel?: string;
}): AgentEvent {
  return {
    eventId: randomUUID(),
    transactionKey: input.transactionKey ?? randomUUID(),
    kind: "request",
    channel: input.channel ?? "agent.requests",
    action: input.action,
    source: input.source ?? "unknown",
    replyChannel: input.replyChannel ?? "agent.results",
    createdAt: new Date().toISOString(),
    payload: input.payload,
  };
}

/**
 * Builds the legacy wire result for a request.
 * `eventId` is supplied by the caller so a redelivered request converges on one result identity.
 */
export function createResultEvent(request: Pick<AgentEvent, "transactionKey" | "replyChannel" | "action">, payload: AgentResultPayload, eventId: string = randomUUID()): AgentEvent<AgentResultPayload> {
  return {
    eventId,
    transactionKey: request.transactionKey,
    kind: "result",
    channel: request.replyChannel ?? "agent.results",
    action: `${request.action}.result`,
    source: "agent",
    createdAt: new Date().toISOString(),
    payload,
  };
}
