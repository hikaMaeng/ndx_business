import type { Pool } from "pg";
import type { AgentEvent } from "agent_domain/common";

export class EventLog {
  private readonly pending: AgentEvent[] = [];
  private flushing = false;
  private scheduled = false;

  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS agent_events (
      event_id text PRIMARY KEY,
      transaction_key text NOT NULL,
      action text NOT NULL,
      kind text NOT NULL,
      channel text NOT NULL,
      source text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now()
    )`);
    await this.pool.query("CREATE INDEX IF NOT EXISTS agent_events_transaction_idx ON agent_events (transaction_key, created_at)");
  }

  append(event: AgentEvent): void {
    this.pending.push(event);
    if (!this.scheduled) {
      this.scheduled = true;
      setImmediate(() => { this.scheduled = false; void this.flush(); });
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.pending.length === 0) return;
    this.flushing = true;
    const batch = this.pending.splice(0, 64);
    try {
      await Promise.all(batch.map((event) => this.pool.query(
        `INSERT INTO agent_events (event_id, transaction_key, action, kind, channel, source, payload, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (event_id) DO NOTHING`,
        [event.eventId, event.transactionKey, event.action, event.kind, event.channel, event.source, JSON.stringify(event.payload), event.createdAt],
      )));
    } catch (error) {
      this.pending.unshift(...batch);
      console.error(JSON.stringify({ event: "event.persistence.failed", count: batch.length, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      this.flushing = false;
      if (this.pending.length > 0) { this.scheduled = true; setImmediate(() => { this.scheduled = false; void this.flush(); }); }
    }
  }
}
