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
    return (await this.claimMany(1))[0];
  }
  async claimMany(limit: number): Promise<Array<Exclude<DeliveryClaim, undefined>>> {
    const result = await this.pool.query<{ event: EventEnvelope; queue_name: string; attempt_id: string }>(`WITH next AS (
      SELECT event_id FROM agent_result_delivery WHERE (status='ready' AND retry_at <= now()) OR (status='running' AND lease_until < now())
      ORDER BY retry_at, created_at FOR UPDATE SKIP LOCKED LIMIT $2
    ) UPDATE agent_result_delivery SET status='running', attempt_id=gen_random_uuid()::text, attempts=attempts+1,
      lease_until=now()+make_interval(secs=>$1) WHERE event_id IN (SELECT event_id FROM next)
      RETURNING event, queue_name, attempt_id`, [this.leaseSeconds, limit]);
    return result.rows.map((row) => ({ event: row.event, queueName: row.queue_name, attemptId: row.attempt_id }));
  }
  async complete(eventId: string, attemptId: string): Promise<boolean> {
    return (await this.completeMany([{ eventId, attemptId }])) === 1;
  }
  async retry(eventId: string, attemptId: string): Promise<void> {
    await this.retryMany([{ eventId, attemptId }]);
  }
  async completeMany(claims: ReadonlyArray<{ eventId: string; attemptId: string }>): Promise<number> {
    if (!claims.length) return 0;
    const result = await this.pool.query(`UPDATE agent_result_delivery AS delivery SET status='delivered', delivered_at=now(), lease_until=NULL
      FROM unnest($1::text[], $2::text[]) AS claimed(event_id, attempt_id)
      WHERE delivery.event_id=claimed.event_id AND delivery.status='running' AND delivery.attempt_id=claimed.attempt_id`,
    [claims.map((claim) => claim.eventId), claims.map((claim) => claim.attemptId)]);
    return result.rowCount ?? 0;
  }
  async retryMany(claims: ReadonlyArray<{ eventId: string; attemptId: string }>): Promise<void> {
    if (!claims.length) return;
    await this.pool.query(`UPDATE agent_result_delivery AS delivery SET status='ready', retry_at=now()+make_interval(secs=>LEAST(60, attempts)), lease_until=NULL
      FROM unnest($1::text[], $2::text[]) AS claimed(event_id, attempt_id)
      WHERE delivery.event_id=claimed.event_id AND delivery.status='running' AND delivery.attempt_id=claimed.attempt_id`,
    [claims.map((claim) => claim.eventId), claims.map((claim) => claim.attemptId)]);
  }
  /** Delivered rows are operational ledger entries; pending rows are never retention-pruned. */
  async prune(retentionDays: number): Promise<number> {
    const result = await this.pool.query("DELETE FROM agent_result_delivery WHERE status='delivered' AND delivered_at < now() - make_interval(days => $1)", [retentionDays]);
    return result.rowCount ?? 0;
  }
}
