import type { Pool } from "pg";
import type { EventEnvelope } from "agent_domain/common";

export const projectionNames = ["session", "run", "turn", "tool"] as const;
export type ProjectionName = typeof projectionNames[number];
type StoredEvent = { event_id: string; stream_id: string; sequence: string | number; action: string; transaction_key: string; event_version: 1; kind: EventEnvelope["kind"]; channel: string; reply_channel: string | null; session_id: string | null; run_id: string | null; turn_id: string | null; causation_event_id: string | null; correlation_id: string; source: EventEnvelope["source"]; payload: Record<string, unknown>; created_at: string | Date; };
const columns = "event_id,stream_id,sequence,action,transaction_key,event_version,kind,channel,reply_channel,session_id,run_id,turn_id,causation_event_id,correlation_id,source,payload,created_at";

function envelope(row: StoredEvent): EventEnvelope {
  return { eventId: row.event_id, streamId: row.stream_id, sequence: String(row.sequence), action: row.action, transactionKey: row.transaction_key, eventVersion: 1, kind: row.kind, channel: row.channel, correlationId: row.correlation_id, source: row.source, createdAt: new Date(row.created_at).toISOString(), payload: row.payload, ...(row.reply_channel ? { replyChannel: row.reply_channel } : {}), ...(row.session_id ? { sessionId: row.session_id } : {}), ...(row.run_id ? { runId: row.run_id } : {}), ...(row.turn_id ? { turnId: row.turn_id } : {}), ...(row.causation_event_id ? { causationEventId: row.causation_event_id } : {}) };
}

function identity(name: ProjectionName, event: EventEnvelope): string | undefined {
  if (name === "session") return event.sessionId;
  if (name === "run") return event.runId;
  if (name === "turn") return event.turnId;
  return typeof event.payload.toolCallKey === "string" ? event.payload.toolCallKey : undefined;
}

function status(event: EventEnvelope): string | undefined {
  if (event.action.includes("cancel")) return "cancelled";
  if (event.action.includes("fail") || event.kind === "failure") return "failed";
  if (event.action.includes("complete") || event.action.includes("final")) return "completed";
  if (event.action.includes("start") || event.kind === "command") return "running";
  return undefined;
}

/** Independent CQRS checkpoints; a failed projection never moves another projection's position. */
export class ProjectionStore {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query("CREATE TABLE IF NOT EXISTS event_projection_checkpoint (projection text PRIMARY KEY, positions jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now())");
    for (const name of projectionNames) await this.pool.query(`CREATE TABLE IF NOT EXISTS ${name}_view (identity text PRIMARY KEY, stream_id text NOT NULL, snapshot_sequence bigint NOT NULL, snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  }

  async applyBatch(name: ProjectionName, limit = 256): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const checkpoint = await client.query<{ positions: Record<string, string> }>("SELECT positions FROM event_projection_checkpoint WHERE projection = $1 FOR UPDATE", [name]);
      const positions = checkpoint.rows[0]?.positions ?? {};
      const rows = await client.query<StoredEvent>(`SELECT ${columns} FROM event_store
        WHERE sequence > COALESCE(($1::jsonb ->> stream_id)::bigint, 0)
        ORDER BY stored_at, stream_id, sequence LIMIT $2`, [JSON.stringify(positions), limit]);
      for (const row of rows.rows) {
        const event = envelope(row); const key = identity(name, event);
        if (key) await client.query(`INSERT INTO ${name}_view (identity, stream_id, snapshot_sequence, snapshot)
          VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (identity) DO UPDATE SET stream_id = EXCLUDED.stream_id,
          snapshot_sequence = EXCLUDED.snapshot_sequence, snapshot = EXCLUDED.snapshot, updated_at = now()
          WHERE ${name}_view.snapshot_sequence < EXCLUDED.snapshot_sequence`, [key, event.streamId, event.sequence, JSON.stringify({ identity: key, status: status(event), lastEventId: event.eventId, lastAction: event.action, kind: event.kind, payload: event.payload, sequence: event.sequence, updatedAt: event.createdAt })]);
        positions[event.streamId] = event.sequence;
      }
      await client.query("INSERT INTO event_projection_checkpoint (projection, positions) VALUES ($1, $2::jsonb) ON CONFLICT (projection) DO UPDATE SET positions = EXCLUDED.positions, updated_at = now()", [name, JSON.stringify(positions)]);
      await client.query("COMMIT");
      return rows.rowCount ?? 0;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async rebuild(name: ProjectionName): Promise<void> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); await client.query(`TRUNCATE TABLE ${name}_view`); await client.query("DELETE FROM event_projection_checkpoint WHERE projection = $1", [name]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
