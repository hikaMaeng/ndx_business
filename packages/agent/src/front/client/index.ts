import { parseChannelServerFrame } from "../../common/index.js";
import type { EventEnvelope, IngressCommand } from "../../common/index.js";

export type ConnectionState = "connecting" | "online" | "offline";

export interface BrokerClientOptions {
  /** Broker origin. Defaults to the page origin, which is where the bundle was served from. */
  url?: string;
  /** Session token. It rides the upgrade URL because a browser cannot set handshake headers. */
  token: () => string;
  channels: () => readonly string[];
  onEvent(event: EventEnvelope): void;
  onState?(state: ConnectionState): void;
  /**
   * Resume from this cursor instead of starting at the current high-water mark.
   * Obtained from the broker; how it was positioned is the caller's business.
   */
  initialCursor?: string;
  /** Reconnect backoff ceiling. */
  maxRetryMs?: number;
}

/**
 * The client half of the broker contract: send events, receive events.
 *
 * That is the whole surface. Which events to send, and what to do with the ones
 * that arrive, is the application's domain — this class never inspects an
 * action or a payload.
 *
 * It does own one thing the application should not re-implement: the cursor. A
 * reconnect resumes from the last delivered position, so a client that was
 * offline replays what it missed instead of silently losing it.
 */
export class BrokerClient {
  private socket: WebSocket | undefined;
  private cursor: string | undefined;
  private retryMs = 500;
  private generation = 0;
  private closed = false;

  constructor(private readonly options: BrokerClientOptions) { this.cursor = options.initialCursor; }

  connect(): void {
    this.closed = false;
    const generation = ++this.generation;
    this.socket?.close();

    const base = this.options.url ?? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
    const socket = new WebSocket(`${base.replace(/^http/, "ws")}/ws?session=${encodeURIComponent(this.options.token())}`);
    this.socket = socket;
    this.options.onState?.("connecting");

    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.retryMs = 500;
      this.options.onState?.("online");
      this.subscribe();
    };
    socket.onerror = () => { if (generation === this.generation) this.options.onState?.("offline"); };
    socket.onclose = () => {
      if (generation !== this.generation || this.closed) return;
      this.options.onState?.("offline");
      const delay = this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, this.options.maxRetryMs ?? 5_000);
      window.setTimeout(() => { if (generation === this.generation && !this.closed) this.connect(); }, delay);
    };
    socket.onmessage = (message) => {
      try {
        const frame = parseChannelServerFrame(JSON.parse(String(message.data)));
        if (!frame) return;
        if (frame.type === "subscribed") { this.cursor = frame.cursor; return; }
        if (frame.type === "replay") {
          this.cursor = frame.cursor;
          // An incomplete replay means more history is waiting; ask again from here.
          if (!frame.replayComplete) this.subscribe();
          return;
        }
        if (frame.type !== "event") return;
        this.cursor = frame.cursor;
        this.options.onEvent(frame.event);
      } catch { /* a malformed frame is not actionable on the client */ }
    };
  }

  private subscribe(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "subscribe", channels: [...this.options.channels()], ...(this.cursor ? { cursor: this.cursor } : {}) }));
  }

  /** Re-subscribes with the current channel set, dropping the cursor if the set changed. */
  resubscribe(resetCursor = false): void {
    if (resetCursor) this.cursor = undefined;
    this.subscribe();
  }

  isOpen(): boolean { return this.socket?.readyState === WebSocket.OPEN; }

  /**
   * Submits one event. The broker re-stamps identity and may reject the frame,
   * so what is sent here is a proposal, not a fact.
   */
  send(command: Omit<IngressCommand, "channel"> & { channel?: string }): boolean {
    if (!this.isOpen()) return false;
    this.socket!.send(JSON.stringify({ type: "event", ...command }));
    return true;
  }

  close(): void {
    this.closed = true;
    this.generation += 1;
    this.socket?.close();
    this.socket = undefined;
  }
}
