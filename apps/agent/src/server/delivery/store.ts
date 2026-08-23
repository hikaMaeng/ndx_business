import type { Pool, PoolClient } from "pg";
import type { EventEnvelope } from "agent_domain/common";

export type DeliveryClaim = { event: EventEnvelope; queueName: string; attemptId: string } | undefined;

/** Transactional outbox: terminal event persistence and pending PGMQ delivery are one DB fact. */
export class DeliveryStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}
  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS agent_result_delivery (
      event_id text PRIMARY KEY, queue_name text NOT NULL, event jsonb NOT NULL, status text NOT NULL DEFAULT 'ready',
      attempt_id text, attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(),
      lease_until timestamptz, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
    await this.pool.query("CREATE INDEX IF NOT EXISTS agent_result_delivery_ready_idx ON agent_result_delivery (retry_at, created_at) WHERE status = 'ready'");
  }
  async enqueue(client: PoolClient, queue: string, event: EventEnvelope): Promise<void> {
    await client.query("INSERT INTO agent_result_delivery (event_id, queue_name, event) VALUES ($1,$2,$3::jsonb) ON CONFLICT (event_id) DO NOTHING", [event.eventId, queue, JSON.stringify(event)]);
  }
  async claim(): Promise<DeliveryClaim> {
    const result = await this.pool.query<{ event: EventEnvelope; queue_name: string; attempt_id: string }>(`WITH next AS (
      SELECT event_id FROM agent_result_delivery WHERE (status='ready' AND retry_at <= now()) OR (status='running' AND lease_until < now())
      ORDER BY retry_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE agent_result_delivery SET status='running', attempt_id=gen_random_uuid()::text, attempts=attempts+1,
      lease_until=now()+make_interval(secs=>$1) WHERE event_id IN (SELECT event_id FROM next)
      RETURNING event, queue_name, attempt_id`, [this.leaseSeconds]);
    const row = result.rows[0]; return row && { event: row.event, queueName: row.queue_name, attemptId: row.attempt_id };
  }
  async complete(eventId: string, attemptId: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE agent_result_delivery SET status='delivered', delivered_at=now(), lease_until=NULL WHERE event_id=$1 AND status='running' AND attempt_id=$2", [eventId, attemptId]);
    return Boolean(result.rowCount);
  }
  async retry(eventId: string, attemptId: string): Promise<void> {
    await this.pool.query("UPDATE agent_result_delivery SET status='ready', retry_at=now()+make_interval(secs=>LEAST(60, attempts)), lease_until=NULL WHERE event_id=$1 AND status='running' AND attempt_id=$2", [eventId, attemptId]);
  }
}
