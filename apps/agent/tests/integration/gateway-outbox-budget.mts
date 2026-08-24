import assert from "node:assert/strict";
import { Pool } from "pg";
import { GatewayOutboxStore } from "../../src/server/gateway-outbox/store.ts";

const databaseUrl = process.env.AGENT_INTEGRATION_DATABASE_URL;
assert.ok(databaseUrl, "AGENT_INTEGRATION_DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const store = new GatewayOutboxStore(pool);
const eventId = `gateway-outbox-budget-${Date.now()}`;
const gatewayId = "gateway-outbox-budget";

try {
  await store.ensureSchema();
  await pool.query("INSERT INTO agent_gateway_delivery (event_id, gateway_id, queue_name, event) VALUES ($1, $2, $3, '{}'::jsonb)", [eventId, gatewayId, "agent_gateway_budget"]);
  for (let attempt = 1; attempt < 10; attempt += 1) {
    assert.equal(await store.failed(eventId, gatewayId, 10, `failure-${attempt}`), "retry", `attempt ${attempt} must retain the handoff`);
    const row = await pool.query<{ attempts: number; status: string; last_error: string }>("SELECT attempts, status, last_error FROM agent_gateway_delivery WHERE event_id=$1 AND gateway_id=$2", [eventId, gatewayId]);
    assert.deepEqual(row.rows[0], { attempts: attempt, status: "ready", last_error: `failure-${attempt}` });
  }
  assert.equal(await store.failed(eventId, gatewayId, 10, "failure-10"), "dead", "the configured tenth failure must terminate the handoff");
  const row = await pool.query<{ attempts: number; status: string; last_error: string }>("SELECT attempts, status, last_error FROM agent_gateway_delivery WHERE event_id=$1 AND gateway_id=$2", [eventId, gatewayId]);
  assert.deepEqual(row.rows[0], { attempts: 10, status: "dead", last_error: "failure-10" });
  assert.deepEqual(await store.pending(eventId, [gatewayId]), [], "a dead handoff must not be retried by a later source delivery");
  console.log(JSON.stringify({ test: "gateway-outbox-budget", attempts: row.rows[0].attempts, status: row.rows[0].status, lastError: row.rows[0].last_error }));
} finally {
  await pool.query("DELETE FROM agent_gateway_delivery WHERE event_id=$1 AND gateway_id=$2", [eventId, gatewayId]);
  await pool.end();
}
