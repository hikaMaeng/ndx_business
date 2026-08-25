import type { Pool } from "pg";
import type { EventEnvelope } from "../../common/index.js";

/** Records every Router-to-Gateway handoff before its result-queue source is acknowledged. */
export class GatewayOutboxStore {
  constructor(private readonly pool: Pool) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS agent_gateway_delivery (
      event_id text NOT NULL, gateway_id text NOT NULL, queue_name text NOT NULL, event jsonb NOT NULL,
      status text NOT NULL DEFAULT 'ready', attempts integer NOT NULL DEFAULT 0, delivered_at timestamptz, last_error text,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (event_id, gateway_id))`);
    await this.pool.query("CREATE INDEX IF NOT EXISTS agent_gateway_delivery_retention_idx ON agent_gateway_delivery (delivered_at) WHERE status = 'delivered'");
  }

  async record(event: EventEnvelope, gateways: readonly { gatewayId: string; queueName: string }[]): Promise<void> {
    if (!gateways.length) return;
    await this.pool.query(`INSERT INTO agent_gateway_delivery (event_id, gateway_id, queue_name, event)
      SELECT $1, gateway_id, queue_name, $2::jsonb FROM unnest($3::text[], $4::text[]) AS target(gateway_id, queue_name)
      ON CONFLICT (event_id, gateway_id) DO NOTHING`, [event.eventId, JSON.stringify(event), gateways.map((gateway) => gateway.gatewayId), gateways.map((gateway) => gateway.queueName)]);
  }

  async pending(eventId: string, gatewayIds: readonly string[]): Promise<string[]> {
    const result = await this.pool.query<{ gateway_id: string }>("SELECT gateway_id FROM agent_gateway_delivery WHERE event_id = $1 AND gateway_id = ANY($2::text[]) AND status = 'ready'", [eventId, gatewayIds]);
    return result.rows.map((row) => row.gateway_id);
  }

  async delivered(eventId: string, gatewayId: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE agent_gateway_delivery SET status='delivered', attempts=attempts+1, delivered_at=now(), updated_at=now(), last_error=NULL WHERE event_id=$1 AND gateway_id=$2 AND status = 'ready' RETURNING event_id", [eventId, gatewayId]);
    return Boolean(result.rowCount);
  }

  /** Records a failed handoff. A dead row is terminal and deliberately retained for operators. */
  async failed(eventId: string, gatewayId: string, maxAttempts: number, error: string): Promise<"retry" | "dead" | "unchanged"> {
    const result = await this.pool.query<{ status: "ready" | "dead" }>(`UPDATE agent_gateway_delivery
      SET attempts=attempts+1, status=CASE WHEN attempts+1 >= $3 THEN 'dead' ELSE 'ready' END,
        updated_at=now(), last_error=$4
      WHERE event_id=$1 AND gateway_id=$2 AND status = 'ready'
      RETURNING status`, [eventId, gatewayId, maxAttempts, error]);
    if (!result.rowCount) return "unchanged";
    return result.rows[0]?.status === "dead" ? "dead" : "retry";
  }

  async prune(retentionDays: number): Promise<number> {
    const result = await this.pool.query("DELETE FROM agent_gateway_delivery WHERE status='delivered' AND delivered_at < now() - make_interval(days => $1)", [retentionDays]);
    return result.rowCount ?? 0;
  }
}
