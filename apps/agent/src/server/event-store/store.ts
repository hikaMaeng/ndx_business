import type { Pool } from "pg";
import type { EventDraft, EventEnvelope } from "agent_domain/common";
import type { MetricsRegistry } from "../metrics/registry.js";

const COLUMNS = "event_id,stream_id,sequence,action,transaction_key,event_version,kind,channel,reply_channel,session_id,run_id,turn_id,causation_event_id,correlation_id,source,payload,created_at";

type StoredEventRow = {
  event_id: string; stream_id: string; sequence: string | number; action: string; transaction_key: string;
  kind: EventEnvelope["kind"]; channel: string; reply_channel: string | null; correlation_id: string;
  causation_event_id: string | null; source: EventEnvelope["source"]; event_version: 1;
  session_id: string | null; run_id: string | null; turn_id: string | null;
  payload: Record<string, unknown>; created_at: string | Date;
};

function fromRow(row: StoredEventRow): EventEnvelope {
  return {
    eventId: row.event_id, streamId: row.stream_id, sequence: Number(row.sequence), action: row.action,
    transactionKey: row.transaction_key, kind: row.kind, channel: row.channel,
    ...(row.reply_channel === null ? {} : { replyChannel: row.reply_channel }),
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    ...(row.turn_id === null ? {} : { turnId: row.turn_id }),
    ...(row.causation_event_id === null ? {} : { causationEventId: row.causation_event_id }),
    correlationId: row.correlation_id, source: row.source, eventVersion: 1,
    createdAt: new Date(row.created_at).toISOString(), payload: row.payload,
  };
}

export class EventStore {
  constructor(private readonly pool: Pool, private readonly metrics?: MetricsRegistry) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_store (
      event_id text PRIMARY KEY, stream_id text NOT NULL, sequence bigint NOT NULL,
      action text NOT NULL, transaction_key text NOT NULL, event_version integer NOT NULL DEFAULT 1, kind text NOT NULL,
      channel text NOT NULL, reply_channel text, correlation_id text NOT NULL,
      session_id text, run_id text, turn_id text, causation_event_id text,
      source text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL,
      stored_at timestamptz NOT NULL DEFAULT now(), UNIQUE (stream_id, sequence))`);
    await this.pool.query("ALTER TABLE event_store ADD COLUMN IF NOT EXISTS event_version integer NOT NULL DEFAULT 1");
    await this.pool.query("ALTER TABLE event_store ADD COLUMN IF NOT EXISTS session_id text");
    await this.pool.query("ALTER TABLE event_store ADD COLUMN IF NOT EXISTS run_id text");
    await this.pool.query("ALTER TABLE event_store ADD COLUMN IF NOT EXISTS turn_id text");
    await this.pool.query("ALTER TABLE event_store ADD COLUMN IF NOT EXISTS causation_event_id text");
    await this.backfillIdentity();
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_store_stream_sequence_idx ON event_store (stream_id, sequence)");
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_store_correlation_idx ON event_store (correlation_id, stored_at)");
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_stream_sequence (
      stream_id text PRIMARY KEY, last_sequence bigint NOT NULL)`);
  }

  /**
   * Restores session, run, and turn identity on rows appended before those columns existed.
   * The legacy payload keys and the `session:` stream prefix are the only recoverable sources.
   */
  private async backfillIdentity(): Promise<void> {
    const filled = await this.pool.query(`UPDATE event_store SET
      session_id = COALESCE(session_id, NULLIF(payload->>'sessionKey',''), NULLIF(substring(stream_id from 'session:(.*)'),'')),
      run_id = COALESCE(run_id, NULLIF(payload->>'runKey','')),
      turn_id = COALESCE(turn_id, NULLIF(payload->>'turnKey',''))
      WHERE session_id IS NULL OR run_id IS NULL OR turn_id IS NULL`);
    if (filled.rowCount) console.log(JSON.stringify({ event: "event.store.backfilled", rows: filled.rowCount }));
  }

  async append(event: EventDraft): Promise<EventEnvelope> {
    const startedAt = Date.now();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [event.eventId]);
      const existing = await client.query<StoredEventRow>(`SELECT ${COLUMNS} FROM event_store WHERE event_id = $1`, [event.eventId]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        this.metrics?.increment("appendDuplicates");
        this.record(startedAt);
        return fromRow(existing.rows[0]);
      }
      const next = await client.query<{ sequence: string | number }>(`INSERT INTO event_stream_sequence (stream_id,last_sequence) VALUES ($1,1)
        ON CONFLICT (stream_id) DO UPDATE SET last_sequence = event_stream_sequence.last_sequence + 1 RETURNING last_sequence AS sequence`, [event.streamId]);
      const sequence = Number(next.rows[0].sequence);
      const inserted = await client.query<StoredEventRow>(`INSERT INTO event_store (${COLUMNS})
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING ${COLUMNS}`, [event.eventId, event.streamId, sequence, event.action, event.transactionKey, event.eventVersion, event.kind, event.channel, event.replyChannel ?? null, event.sessionId ?? null, event.runId ?? null, event.turnId ?? null, event.causationEventId ?? null, event.correlationId, event.source, JSON.stringify(event.payload), event.createdAt]);
      if (!inserted.rowCount) throw new Error(`event store insert returned no row for ${event.eventId}`);
      const result = fromRow(inserted.rows[0]);
      await client.query("COMMIT");
      this.record(startedAt);
      return result;
    } catch (error) { await client.query("ROLLBACK"); this.metrics?.increment("appendFailures"); throw error; }
    finally { client.release(); }
  }

  private record(startedAt: number): void {
    this.metrics?.increment("appendTotal");
    this.metrics?.increment("appendLatencyMsTotal", Date.now() - startedAt);
  }
}
