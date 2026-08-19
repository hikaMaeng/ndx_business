import type { Pool } from "pg";
import type { EventDraft, EventEnvelope } from "agent_domain/common";

type StoredEventRow = {
  event_id: string; stream_id: string; sequence: number; action: string; transaction_key: string;
  kind: EventEnvelope["kind"]; channel: string; reply_channel: string | null; correlation_id: string;
  source: EventEnvelope["source"]; event_version: 1; session_id: string | null; run_id: string | null;
  turn_id: string | null; payload: Record<string, unknown>; created_at: string | Date;
};

function fromRow(row: StoredEventRow): EventEnvelope {
  return {
    eventId: row.event_id, streamId: row.stream_id, sequence: row.sequence, action: row.action,
    transactionKey: row.transaction_key, kind: row.kind, channel: row.channel,
    ...(row.reply_channel === null ? {} : { replyChannel: row.reply_channel }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    ...(row.turn_id === null ? {} : { turnId: row.turn_id }),
    correlationId: row.correlation_id, source: row.source, eventVersion: 1,
    createdAt: new Date(row.created_at).toISOString(), payload: row.payload,
  };
}

export class EventStore {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_store (
      event_id text PRIMARY KEY, stream_id text NOT NULL, sequence bigint NOT NULL,
      action text NOT NULL, transaction_key text NOT NULL, event_version integer NOT NULL DEFAULT 1, kind text NOT NULL,
      channel text NOT NULL, reply_channel text, correlation_id text NOT NULL,
      session_id text, run_id text, turn_id text, source text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now(), UNIQUE (stream_id, sequence))`);
    await this.pool.query("ALTER TABLE event_store ADD COLUMN IF NOT EXISTS event_version integer NOT NULL DEFAULT 1");
    await this.pool.query("ALTER TABLE event_store ADD COLUMN IF NOT EXISTS session_id text");
    await this.pool.query("ALTER TABLE event_store ADD COLUMN IF NOT EXISTS run_id text");
    await this.pool.query("ALTER TABLE event_store ADD COLUMN IF NOT EXISTS turn_id text");
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_stream_sequence (
      stream_id text PRIMARY KEY, last_sequence bigint NOT NULL)`);
  }

  async append(event: EventDraft): Promise<EventEnvelope> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [event.eventId]);
      const existing = await client.query<StoredEventRow>(`SELECT event_id,stream_id,sequence,action,transaction_key,event_version,kind,channel,reply_channel,session_id,run_id,turn_id,correlation_id,source,payload,created_at
        FROM event_store WHERE event_id = $1`, [event.eventId]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        return fromRow(existing.rows[0]);
      }
      const next = await client.query<{ sequence: number }>(`INSERT INTO event_stream_sequence (stream_id,last_sequence) VALUES ($1,1)
        ON CONFLICT (stream_id) DO UPDATE SET last_sequence = event_stream_sequence.last_sequence + 1 RETURNING last_sequence AS sequence`, [event.streamId]);
      const stored = { ...event, sequence: next.rows[0].sequence };
      const inserted = await client.query<StoredEventRow>(`INSERT INTO event_store (event_id,stream_id,sequence,action,transaction_key,event_version,kind,channel,reply_channel,session_id,run_id,turn_id,correlation_id,source,payload,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id,stream_id,sequence,action,transaction_key,event_version,kind,channel,reply_channel,session_id,run_id,turn_id,correlation_id,source,payload,created_at`, [stored.eventId, stored.streamId, stored.sequence, stored.action, stored.transactionKey, stored.eventVersion, stored.kind, stored.channel, stored.replyChannel ?? null, stored.sessionId ?? null, stored.runId ?? null, stored.turnId ?? null, stored.correlationId, stored.source, JSON.stringify(stored.payload), stored.createdAt]);
      if (!inserted.rowCount) throw new Error(`event store insert returned no row for ${event.eventId}`);
      const result = fromRow(inserted.rows[0]);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
