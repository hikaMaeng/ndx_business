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

type Listener = () => void;

export class EventStreamModel {
  private version = 0;
  private readonly listeners = new Set<Listener>();
  private readonly snapshot: StreamSnapshot = {
    channels: ["agent.requests", "agent.results", "orders", "telemetry", "notifications"],
    subscribedChannels: ["agent.requests", "agent.results"],
    events: [],
    connection: "connecting",
  };

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getVersion(): number { return this.version; }
  getSnapshot(): StreamSnapshot { return this.snapshot; }
  setConnection(connection: StreamSnapshot["connection"]): void { this.snapshot.connection = connection; this.emit(); }
  toggleSubscription(channel: string): void {
    this.snapshot.subscribedChannels = this.snapshot.subscribedChannels.includes(channel)
      ? this.snapshot.subscribedChannels.filter((item) => item !== channel)
      : [...this.snapshot.subscribedChannels, channel];
    this.emit();
  }
  addChannel(channel: string): void {
    const normalized = channel.trim();
    if (!normalized || this.snapshot.channels.includes(normalized)) return;
    this.snapshot.channels.push(normalized);
    this.emit();
  }
  addEvent(event: StreamEventRecord): void {
    if (event.direction === "inbound" && !this.snapshot.subscribedChannels.includes(event.channel)) return;
    this.snapshot.events.unshift(event);
    this.snapshot.events.splice(80);
    this.emit();
  }
  clear(): void { this.snapshot.events.length = 0; this.emit(); }
  private emit(): void { this.version += 1; for (const listener of this.listeners) listener(); }
}
