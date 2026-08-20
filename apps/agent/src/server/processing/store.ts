import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventEnvelope } from "agent_domain/common";

export interface ProcessingJob { eventId: string; attemptId: string; event: EventEnvelope; }
export interface ProcessingCounts { ready: number; running: number; failed: number; readyOldestMs: number; expiredLeases: number; }
export interface PrunedOperationalRows { processingJobs: number; deliveries: number; }

/** Durable scheduler input. PGMQ is acknowledged only after this row exists. */
export class ProcessingStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_processing_job (
      event_id text PRIMARY KEY, event jsonb NOT NULL, status text NOT NULL DEFAULT 'ready',
      lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(), attempt_id text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (status IN ('ready','running','completed','failed')))`);
    await this.pool.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'event_processing_job'::regclass AND conname = 'event_processing_job_status_check' AND pg_get_constraintdef(oid) NOT LIKE '%failed%') THEN
        ALTER TABLE event_processing_job DROP CONSTRAINT event_processing_job_status_check;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'event_processing_job'::regclass AND conname = 'event_processing_job_status_check') THEN
        ALTER TABLE event_processing_job ADD CONSTRAINT event_processing_job_status_check CHECK (status IN ('ready','running','completed','failed'));
      END IF;
    END $$`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_processing_dlq (
      event_id text PRIMARY KEY, event jsonb NOT NULL, attempts integer NOT NULL, error text NOT NULL, failed_at timestamptz NOT NULL DEFAULT now())`);
    await this.pool.query("ALTER TABLE event_processing_job ADD COLUMN IF NOT EXISTS attempt_id text");
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_processing_job_claim_idx ON event_processing_job (retry_at, created_at) WHERE status = 'ready'");
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_processing_job_running_lease_idx ON event_processing_job (lease_until) WHERE status = 'running'");
  }

  async enqueue(event: EventEnvelope): Promise<void> {
    await this.pool.query(`INSERT INTO event_processing_job (event_id, event) VALUES ($1, $2::jsonb)
      ON CONFLICT (event_id) DO NOTHING`, [event.eventId, JSON.stringify(event)]);
  }

  async claimNext(): Promise<ProcessingJob | undefined> {
    const attemptId = randomUUID();
    const result = await this.pool.query<{ event_id: string; attempt_id: string; event: EventEnvelope }>(`WITH candidate AS (
      SELECT event_id FROM event_processing_job
      WHERE (status = 'ready' AND retry_at <= now()) OR (status = 'running' AND (lease_until IS NULL OR lease_until < now()))
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

  async retryLater(eventId: string, attemptId: string, maxAttempts: number, baseRetryMs: number, error: string): Promise<"retry" | "dead" | "lost"> {
    const result = await this.pool.query<{ status: "ready" | "failed" }>(`WITH owned AS (
      SELECT event_id, event, attempts FROM event_processing_job WHERE event_id = $1 AND status = 'running' AND attempt_id = $2 FOR UPDATE
    ), transitioned AS (
      UPDATE event_processing_job job SET status = CASE WHEN owned.attempts >= $3 THEN 'failed' ELSE 'ready' END,
        lease_until = NULL, attempt_id = NULL,
        retry_at = CASE WHEN owned.attempts >= $3 THEN retry_at ELSE now() + make_interval(secs => LEAST(($4::numeric / 1000) * power(2, owned.attempts - 1), 300)::double precision) END,
        updated_at = now() FROM owned WHERE job.event_id = owned.event_id RETURNING job.status, owned.event, owned.attempts
    ), archived AS (
      INSERT INTO event_processing_dlq (event_id, event, attempts, error) SELECT $1, event, attempts, $5 FROM transitioned WHERE status = 'failed'
      ON CONFLICT (event_id) DO NOTHING
    ) SELECT status FROM transitioned`, [eventId, attemptId, maxAttempts, baseRetryMs, error]);
    return result.rows[0]?.status === "failed" ? "dead" : result.rows[0] ? "retry" : "lost";
  }

  /** A duplicate request joins the durable owner; it must not independently retry or produce another result. */
  async join(eventId: string, attemptId: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE event_processing_job SET status = 'completed', lease_until = NULL, updated_at = now() WHERE event_id = $1 AND status = 'running' AND attempt_id = $2", [eventId, attemptId]);
    return Boolean(result.rowCount);
  }

  /** Removes only derived operational ledgers; immutable event_store and idempotency claims remain intact. */
  async pruneOperationalLedgers(retentionDays: number): Promise<PrunedOperationalRows> {
    const jobs = await this.pool.query("DELETE FROM event_processing_job WHERE status IN ('completed', 'failed') AND updated_at < now() - make_interval(days => $1)", [retentionDays]);
    const deliveries = await this.pool.query("DELETE FROM event_delivery WHERE delivered_at IS NOT NULL AND delivered_at < now() - make_interval(days => $1)", [retentionDays]);
    return { processingJobs: jobs.rowCount ?? 0, deliveries: deliveries.rowCount ?? 0 };
  }

  async counts(): Promise<ProcessingCounts> {
    const result = await this.pool.query<{ ready: string; running: string; failed: string; ready_oldest_ms: string; expired_leases: string }>(`SELECT
      count(*) FILTER (WHERE status = 'ready')::text AS ready,
      count(*) FILTER (WHERE status = 'running')::text AS running,
      count(*) FILTER (WHERE status = 'failed')::text AS failed,
      coalesce(floor(extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'ready'))) * 1000), 0)::text AS ready_oldest_ms,
      count(*) FILTER (WHERE status = 'running' AND lease_until < now())::text AS expired_leases
      FROM event_processing_job WHERE status IN ('ready','running','failed')`);
    const row = result.rows[0];
    return { ready: Number(row?.ready ?? 0), running: Number(row?.running ?? 0), failed: Number(row?.failed ?? 0), readyOldestMs: Number(row?.ready_oldest_ms ?? 0), expiredLeases: Number(row?.expired_leases ?? 0) };
  }
}
