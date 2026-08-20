import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

/**
 * Durable claim for an egress result.
 * `delivered` means the result already reached the queue and hub, so a source redelivery may be
 * acknowledged without sending again. `leased` means another attempt holds the claim and has not
 * finished: the caller must not acknowledge its source, because that attempt may still fail.
 */
export type DeliveryClaim = { kind: "claimed"; attemptId: string } | { kind: "delivered" } | { kind: "leased" };

export class DeliveryStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_delivery (
      event_id text PRIMARY KEY, delivered_at timestamptz, lease_until timestamptz, attempt_id text, attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await this.pool.query("ALTER TABLE event_delivery ADD COLUMN IF NOT EXISTS lease_until timestamptz");
    await this.pool.query("ALTER TABLE event_delivery ADD COLUMN IF NOT EXISTS attempt_id text");
    await this.pool.query("CREATE INDEX IF NOT EXISTS event_delivery_pending_idx ON event_delivery (created_at) WHERE delivered_at IS NULL");
  }

  async claim(eventId: string): Promise<DeliveryClaim> {
    const attemptId = randomUUID();
    const claimed = await this.pool.query<{ attempt_id: string }>(`INSERT INTO event_delivery (event_id, attempts, attempt_id, lease_until)
      VALUES ($1, 1, $3, now() + make_interval(secs => $2))
      ON CONFLICT (event_id) DO UPDATE SET attempts = event_delivery.attempts + 1, attempt_id = $3, lease_until = now() + make_interval(secs => $2)
      WHERE event_delivery.delivered_at IS NULL AND (event_delivery.lease_until IS NULL OR event_delivery.lease_until < now())
      RETURNING attempt_id`, [eventId, this.leaseSeconds, attemptId]);
    if (claimed.rowCount) return { kind: "claimed", attemptId: claimed.rows[0].attempt_id };
    const existing = await this.pool.query<{ delivered: boolean }>("SELECT delivered_at IS NOT NULL AS delivered FROM event_delivery WHERE event_id = $1", [eventId]);
    return existing.rows[0]?.delivered ? { kind: "delivered" } : { kind: "leased" };
  }

  async complete(eventId: string, attemptId: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE event_delivery SET delivered_at = now(), lease_until = NULL WHERE event_id = $1 AND delivered_at IS NULL AND attempt_id = $2", [eventId, attemptId]);
    return Boolean(result.rowCount);
  }

  async pendingCount(): Promise<number> {
    const result = await this.pool.query<{ count: string }>("SELECT count(*)::text FROM event_delivery WHERE delivered_at IS NULL");
    return Number(result.rows[0]?.count ?? 0);
  }
}
