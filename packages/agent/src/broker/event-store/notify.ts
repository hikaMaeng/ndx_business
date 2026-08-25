import { Client } from "pg";

export const EVENT_LOG_NOTIFY_CHANNEL = "agent_event_log";

/**
 * Wakes a log tail the moment an append commits.
 *
 * Polling alone would work — the log is the truth and a tail that reads a
 * little late is still correct — but it forces a choice between latency and
 * query rate. `pg_notify` fires on commit, never before, so a listener is woken
 * exactly when there is something committed to read. The tail still polls on an
 * interval underneath: a dropped notification must cost latency, not delivery.
 *
 * This needs its own connection because `LISTEN` is session state and a pooled
 * client can be handed to someone else mid-listen.
 */
export class EventLogListener {
  private client: Client | undefined;
  private stopped = false;
  private retryMs = 250;

  constructor(private readonly connectionString: string, private readonly onNotify: (channel: string) => void) {}

  async start(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: this.connectionString });
    this.client = client;
    client.on("notification", (message) => {
      if (message.channel !== EVENT_LOG_NOTIFY_CHANNEL) return;
      this.onNotify(message.payload ?? "");
    });
    // A lost listener is a latency fault, not a correctness one, so it reconnects
    // quietly and the tail keeps polling in the meantime.
    client.on("error", (error) => {
      if (this.stopped) return;
      console.warn(JSON.stringify({ event: "event.log.listener.error", error: error.message }));
      void this.reconnect();
    });
    await client.connect();
    await client.query(`LISTEN ${EVENT_LOG_NOTIFY_CHANNEL}`);
    this.retryMs = 250;
  }

  private async reconnect(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
    if (this.stopped) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(5_000, this.retryMs * 2);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    await this.start().catch((error) => {
      console.warn(JSON.stringify({ event: "event.log.listener.reconnect.failed", error: error instanceof Error ? error.message : String(error) }));
      void this.reconnect();
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
  }
}
