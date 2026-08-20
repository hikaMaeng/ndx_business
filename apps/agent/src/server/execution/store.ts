import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { EventEnvelope } from "agent_domain/common";

export type Claim = { kind: "claimed" } | { kind: "duplicate"; completed: boolean; result?: unknown } | { kind: "conflict"; reason: string };

function payloadHash(event: EventEnvelope): string {
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
  await pool.query("ALTER TABLE agent_execution ADD COLUMN IF NOT EXISTS attempt_id text");
  await pool.query("ALTER TABLE agent_execution ADD COLUMN IF NOT EXISTS lease_until timestamptz");
  await pool.query("ALTER TABLE agent_execution ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz");
  await pool.query("ALTER TABLE agent_execution ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE agent_execution DROP CONSTRAINT IF EXISTS agent_execution_status_check");
  await pool.query("ALTER TABLE agent_execution ADD CONSTRAINT agent_execution_status_check CHECK (status IN ('running','completed','failed','timed_out','cancelled'))");
}

export async function recoverExpiredExecutions(pool: Pool): Promise<number> {
  const result = await pool.query("UPDATE agent_execution SET lease_until = now() - interval '1 millisecond', updated_at = now() WHERE status = 'running' AND lease_until IS NULL AND updated_at < now() - interval '60 seconds'");
  return result.rowCount ?? 0;
}

export async function claimExecution(pool: Pool, event: EventEnvelope, attemptId: string, leaseSeconds: number): Promise<Claim> {
  const hash = payloadHash(event);
  const inserted = await pool.query(
    "INSERT INTO agent_execution (transaction_key, request_event_id, payload_hash, status, attempt_id, lease_until, heartbeat_at, attempts) VALUES ($1, $2, $3, 'running', $4, now() + make_interval(secs => $5), now(), 1) ON CONFLICT (transaction_key) DO NOTHING RETURNING transaction_key",
    [event.transactionKey, event.eventId, hash, attemptId, leaseSeconds],
  );
  if (inserted.rowCount) return { kind: "claimed" };
  const existing = await pool.query<{ status: string; result: unknown; payload_hash: string | null }>("SELECT status, result, payload_hash FROM agent_execution WHERE transaction_key = $1", [event.transactionKey]);
  const row = existing.rows[0];
  if (!row) return { kind: "conflict", reason: "transaction claim disappeared" };
  if (row.payload_hash && row.payload_hash !== hash) return { kind: "conflict", reason: "transactionKey reused with a different action or payload" };
  if (row.status === "running") {
    const reclaimed = await pool.query("UPDATE agent_execution SET attempt_id = $2, lease_until = now() + make_interval(secs => $3), heartbeat_at = now(), attempts = attempts + 1, updated_at = now() WHERE transaction_key = $1 AND status = 'running' AND lease_until < now() RETURNING transaction_key", [event.transactionKey, attemptId, leaseSeconds]);
    if (reclaimed.rowCount) return { kind: "claimed" };
  }
  return { kind: "duplicate", completed: ["completed", "failed", "timed_out", "cancelled"].includes(row.status), result: row.result };
}

export async function renewExecution(pool: Pool, transactionKey: string, attemptId: string, leaseSeconds: number): Promise<boolean> {
  const result = await pool.query("UPDATE agent_execution SET lease_until = now() + make_interval(secs => $3), heartbeat_at = now(), updated_at = now() WHERE transaction_key = $1 AND status = 'running' AND attempt_id = $2", [transactionKey, attemptId, leaseSeconds]);
  return Boolean(result.rowCount);
}

export async function completeExecution(pool: Pool, transactionKey: string, attemptId: string, result: unknown, status: "completed" | "failed" | "timed_out" | "cancelled" = "completed"): Promise<boolean> {
  const updated = await pool.query("UPDATE agent_execution SET status = $3, result = $4::jsonb, lease_until = NULL, updated_at = now(), completed_at = now() WHERE transaction_key = $1 AND status = 'running' AND attempt_id = $2", [transactionKey, attemptId, status, JSON.stringify(result)]);
  return Boolean(updated.rowCount);
}
