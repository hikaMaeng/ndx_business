import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AgentEvent } from "agent_domain/common";

export type Claim = { kind: "claimed" } | { kind: "duplicate"; completed: boolean; result?: unknown } | { kind: "conflict"; reason: string };

function payloadHash(event: AgentEvent): string {
  return createHash("sha256").update(JSON.stringify({ action: event.action, payload: event.payload })).digest("hex");
}

export async function ensureExecutionSchema(pool: Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_execution (
    transaction_key text PRIMARY KEY,
    request_event_id text NOT NULL,
    payload_hash text,
    status text NOT NULL DEFAULT 'running',
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
  )`);
  await pool.query("ALTER TABLE agent_execution ADD COLUMN IF NOT EXISTS payload_hash text");
  await pool.query("ALTER TABLE agent_execution DROP CONSTRAINT IF EXISTS agent_execution_status_check");
  await pool.query("ALTER TABLE agent_execution ADD CONSTRAINT agent_execution_status_check CHECK (status IN ('running','completed','failed','timed_out','cancelled'))");
}

export async function claimExecution(pool: Pool, event: AgentEvent): Promise<Claim> {
  const hash = payloadHash(event);
  const inserted = await pool.query(
    "INSERT INTO agent_execution (transaction_key, request_event_id, payload_hash, status) VALUES ($1, $2, $3, 'running') ON CONFLICT (transaction_key) DO NOTHING RETURNING transaction_key",
    [event.transactionKey, event.eventId, hash],
  );
  if (inserted.rowCount) return { kind: "claimed" };
  const existing = await pool.query<{ status: string; result: unknown; payload_hash: string | null }>("SELECT status, result, payload_hash FROM agent_execution WHERE transaction_key = $1", [event.transactionKey]);
  const row = existing.rows[0];
  if (!row) return { kind: "conflict", reason: "transaction claim disappeared" };
  if (row.payload_hash && row.payload_hash !== hash) return { kind: "conflict", reason: "transactionKey reused with a different action or payload" };
  return { kind: "duplicate", completed: ["completed", "failed", "timed_out", "cancelled"].includes(row.status), result: row.result };
}

export async function completeExecution(pool: Pool, transactionKey: string, result: unknown, status: "completed" | "failed" | "timed_out" | "cancelled" = "completed"): Promise<void> {
  await pool.query("UPDATE agent_execution SET status = $2, result = $3::jsonb, updated_at = now(), completed_at = now() WHERE transaction_key = $1", [transactionKey, status, JSON.stringify(result)]);
}
