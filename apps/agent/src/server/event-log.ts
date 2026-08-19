import type { Pool } from "pg";
import type { AgentEvent } from "agent_domain/common";

export class EventLog {
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

  async append(event: AgentEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_events (event_id, transaction_key, action, kind, channel, source, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.transactionKey, event.action, event.kind, event.channel, event.source, JSON.stringify(event.payload), event.createdAt],
    );
  }
}
