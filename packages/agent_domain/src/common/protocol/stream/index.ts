export type StreamDirection = "outbound" | "inbound";
export type StreamState = "queued" | "processing" | "delivered" | "failed";

export interface StreamEventRecord {
  id: string;
  transactionKey: string;
  channel: string;
  eventType: string;
  direction: StreamDirection;
  state: StreamState;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface StreamSnapshot {
  channels: string[];
  subscribedChannels: string[];
  events: StreamEventRecord[];
  connection: "online" | "offline" | "connecting";
}
