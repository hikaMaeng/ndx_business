import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { EventDraft, EventEnvelope } from "agent_domain/common";
import type { MetricsRegistry } from "../metrics/registry.js";

const COLUMNS = "event_id,stream_id,sequence,action,transaction_key,event_version,kind,channel,reply_channel,session_id,run_id,turn_id,causation_event_id,correlation_id,source,payload,created_at";
const QUALIFIED_COLUMNS = COLUMNS.split(",").map((column) => `event_store.${column}`).join(",");

type StoredEventRow = {
  event_id: string; stream_id: string; sequence: string | number; action: string; transaction_key: string;
  kind: EventEnvelope["kind"]; channel: string; reply_channel: string | null; correlation_id: string;
  causation_event_id: string | null; source: EventEnvelope["source"]; event_version: 1;
  session_id: string | null; run_id: string | null; turn_id: string | null;
  payload: Record<string, unknown>; created_at: string | Date;
};

function fromRow(row: StoredEventRow): EventEnvelope {
  return {
    eventId: row.event_id, streamId: row.stream_id, sequence: String(row.sequence), action: row.action,
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
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_store_channel_stream_sequence_idx ON event_store (channel, stream_id, sequence)");
    await this.pool.query("DROP INDEX IF EXISTS event_store_stream_channel_sequence_idx");
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_store_correlation_idx ON event_store (correlation_id, stored_at)");
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_stream_sequence (
      stream_id text PRIMARY KEY, last_sequence bigint NOT NULL)`);
    await this.pool.query(`INSERT INTO event_stream_sequence (stream_id, last_sequence)
      SELECT stream_id, max(sequence) FROM event_store GROUP BY stream_id
      ON CONFLICT (stream_id) DO UPDATE SET last_sequence = GREATEST(event_stream_sequence.last_sequence, EXCLUDED.last_sequence)`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_subscription_cursor (
      token uuid PRIMARY KEY, channels jsonb NOT NULL, positions jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
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
      WHERE (session_id IS NULL AND COALESCE(NULLIF(payload->>'sessionKey',''), NULLIF(substring(stream_id from 'session:(.*)'),'')) IS NOT NULL)
        OR (run_id IS NULL AND NULLIF(payload->>'runKey','') IS NOT NULL)
        OR (turn_id IS NULL AND NULLIF(payload->>'turnKey','') IS NOT NULL)`);
    if (filled.rowCount) console.log(JSON.stringify({ event: "event.store.backfilled", rows: filled.rowCount }));
  }

  /** See docs/internals.md#decisions: callback work commits with the immutable event or not at all. */
  async append(event: EventDraft, afterAppend?: (client: PoolClient, persisted: EventEnvelope) => Promise<void>): Promise<EventEnvelope> {
    const persisted = await this.appendMany([event], afterAppend ? async (client, events) => afterAppend(client, events[0]!) : undefined);
    return persisted[0]!;
  }

  /** Appends related terminal events and their durable side effects in one database transaction. */
  async appendMany(events: readonly EventDraft[], afterAppend?: (client: PoolClient, persisted: readonly EventEnvelope[]) => Promise<void>): Promise<EventEnvelope[]> {
    if (events.length === 0) return [];
    const startedAt = Date.now();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const persisted: EventEnvelope[] = [];
      // Sequence rows, rather than event ids, are the shared lock. This order keeps future multi-stream batches deadlock-free.
      for (const event of [...events].sort((left, right) => left.streamId.localeCompare(right.streamId) || left.eventId.localeCompare(right.eventId))) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [event.eventId]);
        const existing = await client.query<StoredEventRow>(`SELECT ${COLUMNS} FROM event_store WHERE event_id = $1`, [event.eventId]);
        if (existing.rowCount) {
          persisted.push(fromRow(existing.rows[0]));
          this.metrics?.increment("appendDuplicates");
          continue;
        }
        const next = await client.query<{ sequence: string | number }>(`INSERT INTO event_stream_sequence (stream_id,last_sequence) VALUES ($1,1)
          ON CONFLICT (stream_id) DO UPDATE SET last_sequence = event_stream_sequence.last_sequence + 1 RETURNING last_sequence AS sequence`, [event.streamId]);
        const sequence = String(next.rows[0].sequence);
        const inserted = await client.query<StoredEventRow>(`INSERT INTO event_store (${COLUMNS})
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
          ON CONFLICT (event_id) DO NOTHING
          RETURNING ${COLUMNS}`, [event.eventId, event.streamId, sequence, event.action, event.transactionKey, event.eventVersion, event.kind, event.channel, event.replyChannel ?? null, event.sessionId ?? null, event.runId ?? null, event.turnId ?? null, event.causationEventId ?? null, event.correlationId, event.source, JSON.stringify(event.payload), event.createdAt]);
        if (!inserted.rowCount) throw new Error(`event store insert returned no row for ${event.eventId}`);
        persisted.push(fromRow(inserted.rows[0]));
      }
      if (afterAppend) await afterAppend(client, persisted);
      await client.query("COMMIT");
      for (const _event of events) this.record(startedAt);
      return persisted;
    } catch (error) { await client.query("ROLLBACK"); this.metrics?.increment("appendFailures"); throw error; }
    finally { client.release(); }
  }

  async channelHighWater(channels: string[]): Promise<Record<string, string>> {
    const result = await this.pool.query<{ stream_id: string; sequence: string | number }>(`SELECT stream_id, max(sequence)::text AS sequence
      FROM event_store WHERE channel = ANY($1::text[]) GROUP BY stream_id`, [channels]);
    return Object.fromEntries(result.rows.map((row) => [row.stream_id, String(row.sequence)]));
  }

  async replayChannels(channels: string[], positions: Record<string, string>, highWater: Record<string, string>, limit: number): Promise<{ events: EventEnvelope[]; complete: boolean }> {
    const result = await this.pool.query<StoredEventRow>(`WITH bounds AS (
        SELECT high_water.key AS stream_id,
          COALESCE(($2::jsonb ->> high_water.key)::bigint, 0) AS position,
          high_water.value::bigint AS high_water
        FROM jsonb_each_text($3::jsonb) AS high_water
      )
      SELECT ${QUALIFIED_COLUMNS} FROM bounds JOIN event_store ON event_store.stream_id = bounds.stream_id
      WHERE channel = ANY($1::text[]) AND sequence > bounds.position AND sequence <= bounds.high_water
      ORDER BY event_store.stream_id, event_store.sequence LIMIT $4`, [channels, JSON.stringify(positions), JSON.stringify(highWater), limit + 1]);
    return { events: result.rows.slice(0, limit).map(fromRow), complete: result.rows.length <= limit };
  }

  async openChannelCursor(channels: string[], token?: string): Promise<{ token: string; positions: Record<string, string> }> {
    const fingerprint = [...new Set(channels)].sort();
    if (token) {
      const result = await this.pool.query<{ channels: string[]; positions: Record<string, string> }>("SELECT channels, positions FROM event_subscription_cursor WHERE token = $1", [token]);
      const row = result.rows[0];
      if (!row || JSON.stringify(row.channels) !== JSON.stringify(fingerprint)) throw new Error("channel cursor does not match this subscription");
      return { token, positions: row.positions };
    }
    const highWater = await this.channelHighWater(fingerprint);
    const created = randomUUID();
    await this.pool.query("INSERT INTO event_subscription_cursor (token, channels, positions) VALUES ($1, $2::jsonb, $3::jsonb)", [created, JSON.stringify(fingerprint), JSON.stringify(highWater)]);
    return { token: created, positions: highWater };
  }

  async advanceChannelCursor(token: string, positions: Record<string, string>): Promise<void> {
    const updated = await this.pool.query("UPDATE event_subscription_cursor SET positions = $2::jsonb, updated_at = now() WHERE token = $1 RETURNING token", [token, JSON.stringify(positions)]);
    if (!updated.rowCount) throw new Error("channel cursor no longer exists");
  }

  async pruneChannelCursors(retentionDays: number): Promise<number> {
    const pruned = await this.pool.query("DELETE FROM event_subscription_cursor WHERE updated_at < now() - make_interval(days => $1)", [retentionDays]);
    return pruned.rowCount ?? 0;
  }

  async prune(retentionDays: number): Promise<number> {
    const pruned = await this.pool.query("DELETE FROM event_store WHERE stored_at < now() - make_interval(days => $1)", [retentionDays]);
    await this.pool.query("DELETE FROM event_stream_sequence AS sequence WHERE NOT EXISTS (SELECT 1 FROM event_store WHERE stream_id = sequence.stream_id)");
    return pruned.rowCount ?? 0;
  }

  private record(startedAt: number): void {
    this.metrics?.increment("appendTotal");
    this.metrics?.increment("appendLatencyMsTotal", Date.now() - startedAt);
  }
}
