import type { EventEnvelope, IngressCommand } from "../event/index.js";


export type ChannelClientFrame =
  | { type: "subscribe"; channels: string[]; cursor?: string }
  | ({ type: "event" } & IngressCommand);

export type ChannelServerFrame =
  | { type: "ready"; channels: string[] }
  | { type: "subscribed"; channels: string[]; cursor?: string }
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
  if ((frame.type === "ready" || frame.type === "subscribed") && Array.isArray(frame.channels) && frame.channels.every((channel) => typeof channel === "string") && (frame.cursor === undefined || typeof frame.cursor === "string")) return { type: frame.type, channels: frame.channels, ...(typeof frame.cursor === "string" ? { cursor: frame.cursor } : {}) };
  if (frame.type !== "event" || typeof frame.cursor !== "string" || !frame.event || typeof frame.event !== "object") return undefined;
  const event = frame.event as Record<string, unknown>;
  if (typeof event.eventId !== "string" || typeof event.streamId !== "string" || typeof event.sequence !== "string" || typeof event.channel !== "string" || typeof event.transactionKey !== "string" || typeof event.action !== "string" || !event.payload || typeof event.payload !== "object") return undefined;
  return { type: "event", cursor: frame.cursor, event: event as unknown as EventEnvelope };
}
