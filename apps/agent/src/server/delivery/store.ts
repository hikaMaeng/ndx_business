import type { Pool } from "pg";

/** Durable claim for an egress result. A completed claim is never sent again for source redelivery. */
export class DeliveryStore {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS event_delivery (
      event_id text PRIMARY KEY, delivered_at timestamptz, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await this.pool.query("ALTER TABLE event_delivery ADD COLUMN IF NOT EXISTS lease_until timestamptz");
  }

  async claim(eventId: string): Promise<boolean> {
    const result = await this.pool.query(`INSERT INTO event_delivery (event_id, attempts, lease_until)
      VALUES ($1, 1, now() + interval '30 seconds')
      ON CONFLICT (event_id) DO UPDATE SET attempts = event_delivery.attempts + 1, lease_until = now() + interval '30 seconds'
      WHERE event_delivery.delivered_at IS NULL AND (event_delivery.lease_until IS NULL OR event_delivery.lease_until < now())
      RETURNING event_id`, [eventId]);
    return Boolean(result.rowCount);
  }

  async complete(eventId: string): Promise<void> {
    await this.pool.query("UPDATE event_delivery SET delivered_at = now(), lease_until = NULL WHERE event_id = $1", [eventId]);
  }
}
