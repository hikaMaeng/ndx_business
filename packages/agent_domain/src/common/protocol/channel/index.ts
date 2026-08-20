import type { EventEnvelope, IngressCommand } from "../event/index.js";

const CURSOR_VERSION = 1;
const MAX_CURSOR_BYTES = 8192;
export const MAX_CURSOR_STREAMS = 128;

export type ChannelClientFrame =
  | { type: "subscribe"; channels: string[]; cursor?: string }
  | ({ type: "event" } & IngressCommand);

export type ChannelServerFrame =
  | { type: "ready"; channels: string[] }
  | { type: "subscribed"; channels: string[]; cursor?: string }
  | { type: "event"; event: EventEnvelope };

export interface ChannelCursor { version: typeof CURSOR_VERSION; channels: string[]; positions: Record<string, string>; }

export function encodeChannelCursor(channels: string[], positions: Record<string, string>): string {
  if (Object.keys(positions).length > MAX_CURSOR_STREAMS) throw new Error("channel subscription exceeds the stream limit");
  const value: ChannelCursor = { version: CURSOR_VERSION, channels: [...new Set(channels)].sort(), positions };
  const token = Buffer.from(JSON.stringify(value)).toString("base64url");
  if (Buffer.byteLength(token) > MAX_CURSOR_BYTES) throw new Error("channel cursor exceeds the size limit");
  return token;
}

export function parseChannelCursor(token: string | undefined, channels: string[]): Record<string, string> | undefined {
  if (!token) return {};
  if (Buffer.byteLength(token) > MAX_CURSOR_BYTES) return undefined;
  try {
    const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as ChannelCursor;
    const expected = [...new Set(channels)].sort();
    if (value.version !== CURSOR_VERSION || JSON.stringify(value.channels) !== JSON.stringify(expected) || !value.positions || Object.values(value.positions).some((position) => !/^\d+$/.test(position))) return undefined;
    return value.positions;
  } catch { return undefined; }
}

export function parseChannelClientFrame(value: unknown): ChannelClientFrame | undefined {
  if (!value || typeof value !== "object") return undefined;
  const frame = value as Record<string, unknown>;
  if (frame.type === "subscribe" && Array.isArray(frame.channels) && frame.channels.every((channel) => typeof channel === "string") && (frame.cursor === undefined || typeof frame.cursor === "string")) return { type: "subscribe", channels: frame.channels, ...(typeof frame.cursor === "string" ? { cursor: frame.cursor } : {}) };
  if ("eventId" in frame || "streamId" in frame || "sequence" in frame || "eventVersion" in frame) return undefined;
  if (frame.type !== "event" || typeof frame.action !== "string" || !frame.action || !frame.payload || typeof frame.payload !== "object") return undefined;
  return { type: "event", action: frame.action, payload: frame.payload as Record<string, unknown>, transactionKey: typeof frame.transactionKey === "string" ? frame.transactionKey : crypto.randomUUID(), channel: typeof frame.channel === "string" ? frame.channel : "agent.requests", replyChannel: typeof frame.replyChannel === "string" ? frame.replyChannel : "agent.results", ...(typeof frame.sessionId === "string" ? { sessionId: frame.sessionId } : {}), ...(typeof frame.runId === "string" ? { runId: frame.runId } : {}), ...(typeof frame.turnId === "string" ? { turnId: frame.turnId } : {}) };
}
