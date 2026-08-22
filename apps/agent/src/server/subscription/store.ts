import type { Pool } from "pg";

/** Durable routing registry. See docs/internals.md#broker-topology. */
export class GatewaySubscriptionStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS agent_gateway_subscription (
      gateway_id text NOT NULL, connection_id text NOT NULL, channel text NOT NULL,
      lease_until timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (gateway_id, connection_id, channel))`);
    await this.pool.query("CREATE INDEX IF NOT EXISTS agent_gateway_subscription_channel_idx ON agent_gateway_subscription (channel, lease_until)");
  }

  async replaceConnection(gatewayId: string, connectionId: string, channels: readonly string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM agent_gateway_subscription WHERE gateway_id = $1 AND connection_id = $2", [gatewayId, connectionId]);
      for (const channel of [...new Set(channels)]) {
        await client.query(`INSERT INTO agent_gateway_subscription (gateway_id, connection_id, channel, lease_until)
          VALUES ($1, $2, $3, now() + make_interval(secs => $4))`, [gatewayId, connectionId, channel, this.leaseSeconds]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async removeConnection(gatewayId: string, connectionId: string): Promise<void> {
    await this.pool.query("DELETE FROM agent_gateway_subscription WHERE gateway_id = $1 AND connection_id = $2", [gatewayId, connectionId]);
  }

  async renewGateway(gatewayId: string): Promise<void> {
    await this.pool.query("UPDATE agent_gateway_subscription SET lease_until = now() + make_interval(secs => $2), updated_at = now() WHERE gateway_id = $1", [gatewayId, this.leaseSeconds]);
  }

  async gatewaysFor(channel: string): Promise<string[]> {
    const rows = await this.pool.query<{ gateway_id: string }>("SELECT DISTINCT gateway_id FROM agent_gateway_subscription WHERE channel = $1 AND lease_until > now()", [channel]);
    return rows.rows.map((row) => row.gateway_id);
  }
}
