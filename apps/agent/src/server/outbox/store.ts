import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { EventEnvelope } from "agent_domain/common";

export type OutboxMessage = { eventId: string; attemptId: string; event: EventEnvelope };
export type OutboxRetry = "retry" | "dead" | "lost";
export interface OutboxCounts { pending: number; failed: number; }

/** Durable egress reservation. It is inserted through EventStore.append's transaction callback. */
export class OutboxStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_outbox (
      event_id text PRIMARY KEY, event jsonb NOT NULL, status text NOT NULL DEFAULT 'ready',
      attempt_id text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
      CHECK (status IN ('ready','running','published','failed')))`);
    await this.pool.query("ALTER TABLE event_outbox DROP CONSTRAINT IF EXISTS event_outbox_status_check");
    await this.pool.query("ALTER TABLE event_outbox ADD CONSTRAINT event_outbox_status_check CHECK (status IN ('ready','running','published','failed'))");
    await this.pool.query("CREATE TABLE IF NOT EXISTS event_outbox_dlq (event_id text PRIMARY KEY, event jsonb NOT NULL, attempts integer NOT NULL, error text NOT NULL, failed_at timestamptz NOT NULL DEFAULT now())");
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_outbox_claim_idx ON event_outbox (available_at, created_at) WHERE status = 'ready'");
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_outbox_running_lease_idx ON event_outbox (lease_until) WHERE status = 'running'");
  }

  async enqueue(client: PoolClient, event: EventEnvelope): Promise<void> {
    await client.query("INSERT INTO event_outbox (event_id, event) VALUES ($1, $2::jsonb) ON CONFLICT (event_id) DO NOTHING", [event.eventId, JSON.stringify(event)]);
  }

  async claimNext(): Promise<OutboxMessage | undefined> {
    const attemptId = randomUUID();
    const claimed = await this.pool.query<{ event_id: string; attempt_id: string; event: EventEnvelope }>(`WITH candidate AS (
      SELECT event_id FROM event_outbox WHERE (status = 'ready' AND available_at <= now()) OR (status = 'running' AND (lease_until IS NULL OR lease_until < now()))
      ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE event_outbox outbox SET status = 'running', attempt_id = $1, lease_until = now() + make_interval(secs => $2), attempts = attempts + 1
    FROM candidate WHERE outbox.event_id = candidate.event_id RETURNING outbox.event_id, outbox.attempt_id, outbox.event`, [attemptId, this.leaseSeconds]);
    const row = claimed.rows[0];
    return row ? { eventId: row.event_id, attemptId: row.attempt_id, event: row.event } : undefined;
  }

  async complete(eventId: string, attemptId: string): Promise<boolean> {
    const completed = await this.pool.query("UPDATE event_outbox SET status = 'published', published_at = now(), lease_until = NULL WHERE event_id = $1 AND status = 'running' AND attempt_id = $2", [eventId, attemptId]);
    return Boolean(completed.rowCount);
  }

  async retry(eventId: string, attemptId: string, maxAttempts: number, baseRetryMs: number, error: string): Promise<OutboxRetry> {
    const retried = await this.pool.query<{ status: "ready" | "failed" }>(`WITH owned AS (
      SELECT event_id, event, attempts FROM event_outbox WHERE event_id = $1 AND status = 'running' AND attempt_id = $2 FOR UPDATE
    ), transitioned AS (
      UPDATE event_outbox outbox SET status = CASE WHEN owned.attempts >= $3 THEN 'failed' ELSE 'ready' END,
        attempt_id = NULL, lease_until = NULL,
        available_at = CASE WHEN owned.attempts >= $3 THEN available_at ELSE now() + make_interval(secs => LEAST(($4::numeric / 1000) * power(2, owned.attempts - 1), 300)::double precision) END
      FROM owned WHERE outbox.event_id = owned.event_id RETURNING outbox.status, owned.event, owned.attempts
    ), archived AS (
      INSERT INTO event_outbox_dlq (event_id, event, attempts, error) SELECT $1, event, attempts, $5 FROM transitioned WHERE status = 'failed'
      ON CONFLICT (event_id) DO NOTHING
    ) SELECT status FROM transitioned`, [eventId, attemptId, maxAttempts, baseRetryMs, error]);
    return retried.rows[0]?.status === "failed" ? "dead" : retried.rows[0] ? "retry" : "lost";
  }

  async counts(): Promise<OutboxCounts> {
    const result = await this.pool.query<{ pending: string; failed: string }>(`SELECT
      count(*) FILTER (WHERE status IN ('ready','running'))::text AS pending,
      count(*) FILTER (WHERE status = 'failed')::text AS failed
      FROM event_outbox WHERE status IN ('ready','running','failed')`);
    return { pending: Number(result.rows[0]?.pending ?? 0), failed: Number(result.rows[0]?.failed ?? 0) };
  }
}
