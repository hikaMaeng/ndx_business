import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { EventEnvelope } from "agent_domain/common";

export type OutboxMessage = { eventId: string; attemptId: string; event: EventEnvelope };

/** Durable egress reservation. It is inserted through EventStore.append's transaction callback. */
export class OutboxStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_outbox (
      event_id text PRIMARY KEY, event jsonb NOT NULL, status text NOT NULL DEFAULT 'ready',
      attempt_id text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
      CHECK (status IN ('ready','running','published')))`);
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

  async retry(eventId: string, attemptId: string, retryMs: number): Promise<boolean> {
    const retried = await this.pool.query("UPDATE event_outbox SET status = 'ready', attempt_id = NULL, lease_until = NULL, available_at = now() + make_interval(secs => ($3::numeric / 1000)::double precision) WHERE event_id = $1 AND status = 'running' AND attempt_id = $2", [eventId, attemptId, retryMs]);
    return Boolean(retried.rowCount);
  }

  async pendingCount(): Promise<number> {
    const count = await this.pool.query<{ count: string }>("SELECT count(*)::text FROM event_outbox WHERE status <> 'published'");
    return Number(count.rows[0]?.count ?? 0);
  }
}
