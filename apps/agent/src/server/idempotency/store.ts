import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { EventEnvelope } from "agent_domain/common";

export type ExecutionClaim =
  | { kind: "claimed"; attemptId: string }
  | { kind: "joined"; requestEventId: string; completed: boolean; result?: ResultPayload }
  | { kind: "conflict"; reason: string };

export type ResultPayload = { ok: boolean; value?: unknown; error?: { code: string; message: string } };

function payloadHash(event: EventEnvelope): string {
  return createHash("sha256").update(JSON.stringify({ action: event.action, payload: event.payload })).digest("hex");
}

function recipientEvent(event: EventEnvelope): EventEnvelope {
  return { ...(event.replyChannel ? event : { ...event, replyChannel: "agent.results" }), payload: {} };
}

async function addRecipient(pool: Pool, event: EventEnvelope): Promise<void> {
  const recipient = recipientEvent(event);
  await pool.query(`INSERT INTO agent_execution_recipient (transaction_key, reply_channel, request_event)
    VALUES ($1, $2, $3::jsonb) ON CONFLICT (transaction_key, reply_channel) DO NOTHING`,
  [recipient.transactionKey, recipient.replyChannel, JSON.stringify(recipient)]);
}

/** Durable transaction-key coordination. It deduplicates work; it never schedules it. */
export class ExecutionStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS agent_execution (
      transaction_key text PRIMARY KEY, request_event_id text NOT NULL, payload_hash text NOT NULL, status text NOT NULL,
      result jsonb, attempt_id text, lease_until timestamptz, heartbeat_at timestamptz,
      attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS agent_execution_recipient (
      transaction_key text NOT NULL, reply_channel text NOT NULL, request_event jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (transaction_key, reply_channel)
    )`);
  }

  async claim(event: EventEnvelope, attemptId: string): Promise<ExecutionClaim> {
    const hash = payloadHash(event);
    const inserted = await this.pool.query(`INSERT INTO agent_execution
      (transaction_key, request_event_id, payload_hash, status, attempt_id, lease_until, heartbeat_at, attempts)
      VALUES ($1, $2, $3, 'running', $4, now() + make_interval(secs => $5), now(), 1)
      ON CONFLICT (transaction_key) DO NOTHING RETURNING transaction_key`, [event.transactionKey, event.eventId, hash, attemptId, this.leaseSeconds]);
    if (inserted.rowCount) { await addRecipient(this.pool, event); return { kind: "claimed", attemptId }; }
    const existing = await this.pool.query<{ request_event_id: string; status: string; result: ResultPayload | null; payload_hash: string; reclaimed: boolean }>(`WITH locked AS (
        SELECT transaction_key, request_event_id, status, result, payload_hash FROM agent_execution WHERE transaction_key = $1 FOR UPDATE
      ), recipient AS (
        INSERT INTO agent_execution_recipient (transaction_key, reply_channel, request_event)
        SELECT $1, $5, $6::jsonb FROM locked WHERE payload_hash = $2
        ON CONFLICT (transaction_key, reply_channel) DO NOTHING
      ), reclaimed AS (
        UPDATE agent_execution SET attempt_id = $3, lease_until = now() + make_interval(secs => $4), heartbeat_at = now(),
          attempts = attempts + 1, updated_at = now()
        WHERE transaction_key = $1 AND status = 'running' AND (lease_until IS NULL OR lease_until < now()) AND payload_hash = $2
        RETURNING transaction_key
      ) SELECT locked.request_event_id, locked.status, locked.result, locked.payload_hash, EXISTS(SELECT 1 FROM reclaimed) AS reclaimed FROM locked`,
    [event.transactionKey, hash, attemptId, this.leaseSeconds, recipientEvent(event).replyChannel, JSON.stringify(recipientEvent(event))]);
    const row = existing.rows[0];
    if (!row) return { kind: "conflict", reason: "transaction claim disappeared" };
    if (row.payload_hash !== hash) return { kind: "conflict", reason: "transactionKey reused with a different action or payload" };
    if (row.reclaimed) return { kind: "claimed", attemptId };
    return { kind: "joined", requestEventId: row.request_event_id, completed: row.status !== "running", ...(row.result ? { result: row.result } : {}) };
  }

  async renew(transactionKey: string, attemptId: string): Promise<boolean> {
    const updated = await this.pool.query(`UPDATE agent_execution SET lease_until = now() + make_interval(secs => $3), heartbeat_at = now(), updated_at = now()
      WHERE transaction_key = $1 AND status = 'running' AND attempt_id = $2`, [transactionKey, attemptId, this.leaseSeconds]);
    return Boolean(updated.rowCount);
  }

  async complete(transactionKey: string, attemptId: string, result: ResultPayload): Promise<boolean> {
    const updated = await this.pool.query(`UPDATE agent_execution SET status = 'completed', result = $3::jsonb, lease_until = NULL,
      updated_at = now(), completed_at = now() WHERE transaction_key = $1 AND status = 'running' AND attempt_id = $2`,
    [transactionKey, attemptId, JSON.stringify(result)]);
    return Boolean(updated.rowCount);
  }

  async recipients(transactionKey: string): Promise<EventEnvelope[]> {
    const result = await this.pool.query<{ request_event: EventEnvelope }>("SELECT request_event FROM agent_execution_recipient WHERE transaction_key = $1 ORDER BY created_at", [transactionKey]);
    return result.rows.map((row) => row.request_event);
  }
}
