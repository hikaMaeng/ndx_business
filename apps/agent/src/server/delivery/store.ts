import type { Pool } from "pg";

/**
 * Durable claim for an egress result.
 * `delivered` means the result already reached the queue and hub, so a source redelivery may be
 * acknowledged without sending again. `leased` means another attempt holds the claim and has not
 * finished: the caller must not acknowledge its source, because that attempt may still fail.
 */
export type DeliveryClaim = "claimed" | "delivered" | "leased";

export class DeliveryStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_delivery (
      event_id text PRIMARY KEY, delivered_at timestamptz, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await this.pool.query("ALTER TABLE event_delivery ADD COLUMN IF NOT EXISTS lease_until timestamptz");
  }

  async claim(eventId: string): Promise<DeliveryClaim> {
    const claimed = await this.pool.query(`INSERT INTO event_delivery (event_id, attempts, lease_until)
      VALUES ($1, 1, now() + make_interval(secs => $2))
      ON CONFLICT (event_id) DO UPDATE SET attempts = event_delivery.attempts + 1, lease_until = now() + make_interval(secs => $2)
      WHERE event_delivery.delivered_at IS NULL AND (event_delivery.lease_until IS NULL OR event_delivery.lease_until < now())
      RETURNING event_id`, [eventId, this.leaseSeconds]);
    if (claimed.rowCount) return "claimed";
    const existing = await this.pool.query<{ delivered: boolean }>("SELECT delivered_at IS NOT NULL AS delivered FROM event_delivery WHERE event_id = $1", [eventId]);
    return existing.rows[0]?.delivered ? "delivered" : "leased";
  }

  async complete(eventId: string): Promise<void> {
    await this.pool.query("UPDATE event_delivery SET delivered_at = now(), lease_until = NULL WHERE event_id = $1", [eventId]);
  }
}
