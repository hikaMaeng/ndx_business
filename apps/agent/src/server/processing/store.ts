import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AgentEvent } from "agent_domain/common";

export interface ProcessingJob { eventId: string; attemptId: string; event: AgentEvent; }
export interface ProcessingCounts { ready: number; running: number; readyOldestMs: number; expiredLeases: number; }

/** Durable scheduler input. PGMQ is acknowledged only after this row exists. */
export class ProcessingStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_processing_job (
      event_id text PRIMARY KEY, event jsonb NOT NULL, status text NOT NULL DEFAULT 'ready',
      lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(), attempt_id text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (status IN ('ready','running','completed')))`);
    await this.pool.query("ALTER TABLE event_processing_job ADD COLUMN IF NOT EXISTS attempt_id text");
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_processing_job_claim_idx ON event_processing_job (retry_at, created_at) WHERE status = 'ready'");
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_processing_job_running_lease_idx ON event_processing_job (lease_until) WHERE status = 'running'");
  }

  async enqueue(event: AgentEvent): Promise<void> {
    await this.pool.query(`INSERT INTO event_processing_job (event_id, event) VALUES ($1, $2::jsonb)
      ON CONFLICT (event_id) DO NOTHING`, [event.eventId, JSON.stringify(event)]);
  }

  async claimNext(): Promise<ProcessingJob | undefined> {
    const attemptId = randomUUID();
    const result = await this.pool.query<{ event_id: string; attempt_id: string; event: AgentEvent }>(`WITH candidate AS (
      SELECT event_id FROM event_processing_job
      WHERE (status = 'ready' AND retry_at <= now()) OR (status = 'running' AND lease_until < now())
      ORDER BY retry_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE event_processing_job job SET status = 'running', attempts = attempts + 1, attempt_id = $2,
      lease_until = now() + make_interval(secs => $1), updated_at = now()
    FROM candidate WHERE job.event_id = candidate.event_id RETURNING job.event_id, job.attempt_id, job.event`, [this.leaseSeconds, attemptId]);
    const row = result.rows[0];
    return row ? { eventId: row.event_id, attemptId: row.attempt_id, event: row.event } : undefined;
  }

  async complete(eventId: string, attemptId: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE event_processing_job SET status = 'completed', lease_until = NULL, updated_at = now() WHERE event_id = $1 AND status = 'running' AND attempt_id = $2", [eventId, attemptId]);
    return Boolean(result.rowCount);
  }

  async renew(eventId: string, attemptId: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE event_processing_job
      SET lease_until = now() + make_interval(secs => $3), updated_at = now()
      WHERE event_id = $1 AND status = 'running' AND attempt_id = $2 RETURNING event_id`, [eventId, attemptId, this.leaseSeconds]);
    return Boolean(result.rowCount);
  }

  async retryLater(eventId: string, attemptId: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE event_processing_job SET status = 'ready', lease_until = NULL, attempt_id = NULL, retry_at = now() + interval '1 second', updated_at = now() WHERE event_id = $1 AND status = 'running' AND attempt_id = $2", [eventId, attemptId]);
    return Boolean(result.rowCount);
  }

  async counts(): Promise<ProcessingCounts> {
    const result = await this.pool.query<{ ready: string; running: string; ready_oldest_ms: string; expired_leases: string }>(`SELECT
      count(*) FILTER (WHERE status = 'ready')::text AS ready,
      count(*) FILTER (WHERE status = 'running')::text AS running,
      coalesce(floor(extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'ready'))) * 1000), 0)::text AS ready_oldest_ms,
      count(*) FILTER (WHERE status = 'running' AND lease_until < now())::text AS expired_leases
      FROM event_processing_job WHERE status IN ('ready','running')`);
    const row = result.rows[0];
    return { ready: Number(row?.ready ?? 0), running: Number(row?.running ?? 0), readyOldestMs: Number(row?.ready_oldest_ms ?? 0), expiredLeases: Number(row?.expired_leases ?? 0) };
  }
}
