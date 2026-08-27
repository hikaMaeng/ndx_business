import type { EventEnvelope, IngressCommand } from "../event/index.js";


export type ChannelClientFrame =
  | { type: "subscribe"; channels: string[]; cursor?: string }
  | ({ type: "event" } & IngressCommand);

export type ChannelServerFrame =
  | { type: "ready"; channels: string[] }
  | { type: "subscribed"; channels: string[]; cursor?: string; replayComplete: boolean }
  | { type: "replay"; cursor: string; replayComplete: boolean }
  | { type: "event"; event: EventEnvelope; cursor: string };

export function parseChannelCursor(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token) ? token : undefined;
}

export function parseChannelClientFrame(value: unknown): ChannelClientFrame | undefined {
  if (!value || typeof value !== "object") return undefined;
  const frame = value as Record<string, unknown>;
  if (frame.type === "subscribe" && Array.isArray(frame.channels) && frame.channels.every((channel) => typeof channel === "string") && (frame.cursor === undefined || typeof frame.cursor === "string")) return { type: "subscribe", channels: frame.channels, ...(typeof frame.cursor === "string" ? { cursor: frame.cursor } : {}) };
  if ("eventId" in frame || "streamId" in frame || "sequence" in frame || "eventVersion" in frame) return undefined;
  if (frame.type !== "event" || typeof frame.action !== "string" || !frame.action || !frame.payload || typeof frame.payload !== "object") return undefined;
  return { type: "event", action: frame.action, payload: frame.payload as Record<string, unknown>, transactionKey: typeof frame.transactionKey === "string" ? frame.transactionKey : crypto.randomUUID(), channel: typeof frame.channel === "string" ? frame.channel : "agent.requests", replyChannel: typeof frame.replyChannel === "string" ? frame.replyChannel : "agent.results", ...(typeof frame.sessionId === "string" ? { sessionId: frame.sessionId } : {}), ...(typeof frame.runId === "string" ? { runId: frame.runId } : {}), ...(typeof frame.turnId === "string" ? { turnId: frame.turnId } : {}) };
}

export function parseChannelServerFrame(value: unknown): ChannelServerFrame | undefined {
  if (!value || typeof value !== "object") return undefined;
  const frame = value as Record<string, unknown>;
  if (frame.type === "ready" && Array.isArray(frame.channels) && frame.channels.every((channel) => typeof channel === "string")) return { type: "ready", channels: frame.channels };
  if (frame.type === "subscribed" && Array.isArray(frame.channels) && frame.channels.every((channel) => typeof channel === "string") && typeof frame.replayComplete === "boolean" && (frame.cursor === undefined || typeof frame.cursor === "string")) return { type: "subscribed", channels: frame.channels, replayComplete: frame.replayComplete, ...(typeof frame.cursor === "string" ? { cursor: frame.cursor } : {}) };
  if (frame.type === "replay" && typeof frame.cursor === "string" && typeof frame.replayComplete === "boolean") return { type: "replay", cursor: frame.cursor, replayComplete: frame.replayComplete };
  if (frame.type !== "event" || typeof frame.cursor !== "string" || !frame.event || typeof frame.event !== "object") return undefined;
  const event = frame.event as Record<string, unknown>;
  if (typeof event.eventId !== "string" || typeof event.streamId !== "string" || typeof event.sequence !== "string" || typeof event.channel !== "string" || typeof event.transactionKey !== "string" || typeof event.action !== "string" || typeof event.correlationId !== "string" || typeof event.createdAt !== "string" || event.eventVersion !== 1 || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return undefined;
  if (event.kind !== "command" && event.kind !== "fact" && event.kind !== "result" && event.kind !== "progress" && event.kind !== "failure" && event.kind !== "control") return undefined;
  if (event.source !== "client" && event.source !== "server" && event.source !== "worker" && event.source !== "scheduler") return undefined;
  if ((event.replyChannel !== undefined && typeof event.replyChannel !== "string") || (event.sessionId !== undefined && typeof event.sessionId !== "string") || (event.runId !== undefined && typeof event.runId !== "string") || (event.turnId !== undefined && typeof event.turnId !== "string") || (event.causationEventId !== undefined && typeof event.causationEventId !== "string")) return undefined;
  return { type: "event", cursor: frame.cursor, event: {
    eventId: event.eventId, streamId: event.streamId, sequence: event.sequence, action: event.action,
    transactionKey: event.transactionKey, eventVersion: 1, kind: event.kind,
    channel: event.channel, correlationId: event.correlationId, source: event.source,
    createdAt: event.createdAt, payload: { ...event.payload },
    ...(typeof event.replyChannel === "string" ? { replyChannel: event.replyChannel } : {}),
    ...(typeof event.sessionId === "string" ? { sessionId: event.sessionId } : {}),
    ...(typeof event.runId === "string" ? { runId: event.runId } : {}),
    ...(typeof event.turnId === "string" ? { turnId: event.turnId } : {}),
    ...(typeof event.causationEventId === "string" ? { causationEventId: event.causationEventId } : {}),
  } };
}
