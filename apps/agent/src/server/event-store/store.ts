import type { Pool } from "pg";
import type { EventEnvelope } from "agent_domain/common";

export class EventStore {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_store (
      event_id text PRIMARY KEY, stream_id text NOT NULL, sequence bigint NOT NULL,
      action text NOT NULL, transaction_key text NOT NULL, kind text NOT NULL,
      channel text NOT NULL, reply_channel text, correlation_id text NOT NULL,
      source text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now(), UNIQUE (stream_id, sequence))`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_stream_sequence (
      stream_id text PRIMARY KEY, last_sequence bigint NOT NULL)`);
  }

  async append(event: EventEnvelope): Promise<EventEnvelope> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ sequence: number }>("SELECT sequence FROM event_store WHERE event_id = $1", [event.eventId]);
      if (existing.rowCount) { await client.query("COMMIT"); return { ...event, sequence: existing.rows[0].sequence }; }
      const next = await client.query<{ sequence: number }>(`INSERT INTO event_stream_sequence (stream_id,last_sequence) VALUES ($1,1)
        ON CONFLICT (stream_id) DO UPDATE SET last_sequence = event_stream_sequence.last_sequence + 1 RETURNING last_sequence AS sequence`, [event.streamId]);
      const stored = { ...event, sequence: next.rows[0].sequence };
      await client.query(`INSERT INTO event_store (event_id,stream_id,sequence,action,transaction_key,kind,channel,reply_channel,correlation_id,source,payload,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`, [stored.eventId, stored.streamId, stored.sequence, stored.action, stored.transactionKey, stored.kind, stored.channel, stored.replyChannel ?? null, stored.correlationId, stored.source, JSON.stringify(stored.payload), stored.createdAt]);
      await client.query("COMMIT");
      return stored;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
