import type { Pool } from "pg";
import type { AgentEvent } from "agent_domain/common";

export interface ProcessingJob { eventId: string; event: AgentEvent; }
export interface ProcessingCounts { ready: number; running: number; }

/** Durable scheduler input. PGMQ is acknowledged only after this row exists. */
export class ProcessingStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_processing_job (
      event_id text PRIMARY KEY, event jsonb NOT NULL, status text NOT NULL DEFAULT 'ready',
      lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (status IN ('ready','running','completed')))`);
  }

  async enqueue(event: AgentEvent): Promise<void> {
    await this.pool.query(`INSERT INTO event_processing_job (event_id, event) VALUES ($1, $2::jsonb)
      ON CONFLICT (event_id) DO NOTHING`, [event.eventId, JSON.stringify(event)]);
  }

  async claimNext(): Promise<ProcessingJob | undefined> {
    const result = await this.pool.query<{ event_id: string; event: AgentEvent }>(`WITH candidate AS (
      SELECT event_id FROM event_processing_job
      WHERE (status = 'ready' AND retry_at <= now()) OR (status = 'running' AND lease_until < now())
      ORDER BY retry_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE event_processing_job job SET status = 'running', attempts = attempts + 1,
      lease_until = now() + make_interval(secs => $1), updated_at = now()
    FROM candidate WHERE job.event_id = candidate.event_id RETURNING job.event_id, job.event`, [this.leaseSeconds]);
    const row = result.rows[0];
    return row ? { eventId: row.event_id, event: row.event } : undefined;
  }

  async complete(eventId: string): Promise<void> {
    await this.pool.query("UPDATE event_processing_job SET status = 'completed', lease_until = NULL, updated_at = now() WHERE event_id = $1", [eventId]);
  }

  async renew(eventId: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE event_processing_job
      SET lease_until = now() + make_interval(secs => $2), updated_at = now()
      WHERE event_id = $1 AND status = 'running' RETURNING event_id`, [eventId, this.leaseSeconds]);
    return Boolean(result.rowCount);
  }

  async retryLater(eventId: string): Promise<void> {
    await this.pool.query("UPDATE event_processing_job SET status = 'ready', lease_until = NULL, retry_at = now() + interval '1 second', updated_at = now() WHERE event_id = $1", [eventId]);
  }

  async counts(): Promise<ProcessingCounts> {
    const result = await this.pool.query<{ status: "ready" | "running"; count: string }>("SELECT status, count(*)::text FROM event_processing_job WHERE status IN ('ready','running') GROUP BY status");
    return result.rows.reduce<ProcessingCounts>((counts, row) => ({ ...counts, [row.status]: Number(row.count) }), { ready: 0, running: 0 });
  }
}
