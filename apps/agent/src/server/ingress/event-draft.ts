import type { AgentEvent, EventDraft, EventKind } from "agent_domain/common";

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
    streamId: sessionId ? `session:${sessionId}` : `channel:${event.channel}`,
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
