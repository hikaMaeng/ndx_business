import type { Pool, PoolClient } from "pg";
import type { EventEnvelope } from "agent_domain/common";

export type DeliveryClaim = { event: EventEnvelope; queueName: string; attemptId: string; attempts: number } | undefined;

/** Transactional outbox: terminal event persistence and pending PGMQ delivery are one DB fact. */
export class DeliveryStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}
  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS agent_result_delivery (
      event_id text PRIMARY KEY, queue_name text NOT NULL, event jsonb NOT NULL, status text NOT NULL DEFAULT 'ready',
      attempt_id text, attempts integer NOT NULL DEFAULT 0, retry_at timestamptz NOT NULL DEFAULT now(),
      lease_until timestamptz, delivered_at timestamptz, dead_at timestamptz, last_error text,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await this.pool.query("ALTER TABLE agent_result_delivery ADD COLUMN IF NOT EXISTS dead_at timestamptz");
    await this.pool.query("ALTER TABLE agent_result_delivery ADD COLUMN IF NOT EXISTS last_error text");
    await this.pool.query("CREATE INDEX IF NOT EXISTS agent_result_delivery_ready_idx ON agent_result_delivery (retry_at, created_at) WHERE status = 'ready'");
    await this.pool.query("CREATE INDEX IF NOT EXISTS agent_result_delivery_expired_idx ON agent_result_delivery (lease_until, created_at) WHERE status = 'running'");
  }
  async enqueue(client: PoolClient, queue: string, event: EventEnvelope): Promise<void> {
    await client.query("INSERT INTO agent_result_delivery (event_id, queue_name, event) VALUES ($1,$2,$3::jsonb) ON CONFLICT (event_id) DO NOTHING", [event.eventId, queue, JSON.stringify(event)]);
  }
  async claim(): Promise<DeliveryClaim> {
    return (await this.claimMany(1))[0];
  }
  async claimMany(limit: number): Promise<Array<Exclude<DeliveryClaim, undefined>>> {
    const result = await this.pool.query<{ event: EventEnvelope; queue_name: string; attempt_id: string; attempts: number }>(`WITH ready AS (
      SELECT event_id FROM agent_result_delivery WHERE status='ready' AND retry_at <= now()
      ORDER BY retry_at, created_at FOR UPDATE SKIP LOCKED LIMIT $2
    ), expired AS (
      SELECT event_id FROM agent_result_delivery WHERE status='running' AND lease_until < now()
      ORDER BY lease_until, created_at FOR UPDATE SKIP LOCKED LIMIT $2
    ), next AS (
      SELECT event_id FROM ready UNION ALL SELECT event_id FROM expired LIMIT $2
    ) UPDATE agent_result_delivery SET status='running', attempt_id=gen_random_uuid()::text, attempts=attempts+1,
      lease_until=now()+make_interval(secs=>$1) WHERE event_id IN (SELECT event_id FROM next)
      RETURNING event, queue_name, attempt_id, attempts`, [this.leaseSeconds, limit]);
    return result.rows.map((row) => ({ event: row.event, queueName: row.queue_name, attemptId: row.attempt_id, attempts: row.attempts }));
  }
  async complete(eventId: string, attemptId: string): Promise<boolean> {
    return (await this.completeMany([{ eventId, attemptId }])).length === 1;
  }
  async retry(eventId: string, attemptId: string, maxAttempts = Number.MAX_SAFE_INTEGER, error = "delivery retry"): Promise<void> {
    await this.retryMany([{ eventId, attemptId }], maxAttempts, error);
  }
  async completeMany(claims: ReadonlyArray<{ eventId: string; attemptId: string }>): Promise<string[]> {
    if (!claims.length) return [];
    const result = await this.pool.query<{ event_id: string }>(`UPDATE agent_result_delivery AS delivery SET status='delivered', delivered_at=now(), lease_until=NULL
      FROM unnest($1::text[], $2::text[]) AS claimed(event_id, attempt_id)
      WHERE delivery.event_id=claimed.event_id AND delivery.status='running' AND delivery.attempt_id=claimed.attempt_id
      RETURNING delivery.event_id`,
    [claims.map((claim) => claim.eventId), claims.map((claim) => claim.attemptId)]);
    return result.rows.map((row) => row.event_id);
  }
  async retryMany(claims: ReadonlyArray<{ eventId: string; attemptId: string }>, maxAttempts: number, error: string): Promise<{ ready: number; dead: number }> {
    if (!claims.length) return { ready: 0, dead: 0 };
    const result = await this.pool.query<{ status: "ready" | "dead" }>(`UPDATE agent_result_delivery AS delivery SET
      status=CASE WHEN attempts >= $3 THEN 'dead' ELSE 'ready' END,
      retry_at=CASE WHEN attempts >= $3 THEN retry_at ELSE now()+make_interval(secs=>LEAST(60, attempts)) END,
      lease_until=NULL, dead_at=CASE WHEN attempts >= $3 THEN now() ELSE NULL END, last_error=$4
      FROM unnest($1::text[], $2::text[]) AS claimed(event_id, attempt_id)
      WHERE delivery.event_id=claimed.event_id AND delivery.status='running' AND delivery.attempt_id=claimed.attempt_id
      RETURNING delivery.status`, [claims.map((claim) => claim.eventId), claims.map((claim) => claim.attemptId), maxAttempts, error]);
    return result.rows.reduce((counts, row) => ({ ...counts, [row.status]: counts[row.status] + 1 }), { ready: 0, dead: 0 });
  }
  /** Delivered rows are operational ledger entries; ready/running/dead rows require explicit operational resolution. */
  async prune(retentionDays: number): Promise<number> {
    const result = await this.pool.query("DELETE FROM agent_result_delivery WHERE status='delivered' AND delivered_at < now() - make_interval(days => $1)", [retentionDays]);
    return result.rowCount ?? 0;
  }
}
