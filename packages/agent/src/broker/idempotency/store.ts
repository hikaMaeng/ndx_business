import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { EventEnvelope, ResultPayload } from "../../common/index.js";

export type ExecutionClaim =
  | { kind: "claimed"; attemptId: string; attempts: number }
  | { kind: "joined"; requestEventId: string; completed: boolean; result?: ResultPayload }
  | { kind: "conflict"; reason: string };


function payloadHash(event: EventEnvelope): string {
  return createHash("sha256").update(JSON.stringify({ action: event.action, payload: event.payload })).digest("hex");
}

function recipientEvent(event: EventEnvelope): EventEnvelope {
  return { ...(event.replyChannel ? event : { ...event, replyChannel: "agent.results" }), payload: {} };
}

async function addRecipient(pool: Pool, event: EventEnvelope): Promise<void> {
  const recipient = recipientEvent(event);
  await pool.query(`INSERT INTO agent_execution_recipient (transaction_key, reply_channel, stream_id, request_event)
    VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (transaction_key, reply_channel, stream_id) DO NOTHING`,
  [recipient.transactionKey, recipient.replyChannel, recipient.streamId, JSON.stringify(recipient)]);
}

/** Durable transaction-key coordination. It deduplicates work; it never schedules it. */
export type { ResultPayload };

export class ExecutionStore {
  constructor(private readonly pool: Pool, private readonly leaseSeconds: number) {}

  async ensureSchema(): Promise<void> {
    // All three roles initialise concurrently. Serialize the one-time primary-key migration.
    await this.pool.query("SELECT pg_advisory_lock(hashtextextended('agent_execution_schema', 0))");
    try {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS agent_execution (
      transaction_key text PRIMARY KEY, request_event_id text NOT NULL, payload_hash text NOT NULL, status text NOT NULL,
      result jsonb, attempt_id text, lease_until timestamptz, heartbeat_at timestamptz,
      attempts integer NOT NULL DEFAULT 0, queue_redeliveries integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS agent_execution_recipient (
      transaction_key text NOT NULL, reply_channel text NOT NULL, stream_id text NOT NULL, request_event jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (transaction_key, reply_channel, stream_id)
    )`);
    await this.pool.query("ALTER TABLE agent_execution ADD COLUMN IF NOT EXISTS queue_redeliveries integer NOT NULL DEFAULT 0");
    await this.pool.query("ALTER TABLE agent_execution_recipient ADD COLUMN IF NOT EXISTS stream_id text");
    await this.pool.query("UPDATE agent_execution_recipient SET stream_id = COALESCE(stream_id, request_event->>'streamId', 'channel:' || reply_channel) WHERE stream_id IS NULL");
    await this.pool.query("ALTER TABLE agent_execution_recipient ALTER COLUMN stream_id SET NOT NULL");
    await this.pool.query("CREATE INDEX IF NOT EXISTS agent_execution_completed_idx ON agent_execution (completed_at) WHERE status IN ('completed', 'failed')");
    await this.pool.query("CREATE INDEX IF NOT EXISTS agent_execution_running_lease_idx ON agent_execution (lease_until, updated_at) WHERE status = 'running'");
    const primaryKey = await this.pool.query<{ columns: string[] }>(`SELECT array_agg(att.attname ORDER BY key.ordinality) AS columns
      FROM pg_constraint con JOIN unnest(con.conkey) WITH ORDINALITY AS key(attnum, ordinality) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = key.attnum
      WHERE con.conrelid = 'agent_execution_recipient'::regclass AND con.contype = 'p' GROUP BY con.oid`);
    if (JSON.stringify(primaryKey.rows[0]?.columns ?? []) !== JSON.stringify(["transaction_key", "reply_channel", "stream_id"])) {
      await this.pool.query("ALTER TABLE agent_execution_recipient DROP CONSTRAINT IF EXISTS agent_execution_recipient_pkey");
      await this.pool.query("ALTER TABLE agent_execution_recipient ADD PRIMARY KEY (transaction_key, reply_channel, stream_id)");
    }
    } finally { await this.pool.query("SELECT pg_advisory_unlock(hashtextextended('agent_execution_schema', 0))"); }
  }

  async claim(event: EventEnvelope, attemptId: string): Promise<ExecutionClaim> {
    const hash = payloadHash(event);
    const inserted = await this.pool.query(`INSERT INTO agent_execution
      (transaction_key, request_event_id, payload_hash, status, attempt_id, lease_until, heartbeat_at, attempts)
      VALUES ($1, $2, $3, 'running', $4, now() + make_interval(secs => $5), now(), 1)
      ON CONFLICT (transaction_key) DO NOTHING RETURNING transaction_key`, [event.transactionKey, event.eventId, hash, attemptId, this.leaseSeconds]);
    if (inserted.rowCount) { await addRecipient(this.pool, event); return { kind: "claimed", attemptId, attempts: 1 }; }
    const existing = await this.pool.query<{ request_event_id: string; status: string; result: ResultPayload | null; payload_hash: string; claim_attempts: number; reclaimed: boolean }>(`WITH locked AS (
        SELECT transaction_key, request_event_id, status, result, payload_hash, attempts FROM agent_execution WHERE transaction_key = $1 FOR UPDATE
      ), recipient AS (
        INSERT INTO agent_execution_recipient (transaction_key, reply_channel, stream_id, request_event)
        SELECT $1, $5, $6, $7::jsonb FROM locked WHERE payload_hash = $2
        ON CONFLICT (transaction_key, reply_channel, stream_id) DO NOTHING
      ), reclaimed AS (
        UPDATE agent_execution SET attempt_id = $3, lease_until = now() + make_interval(secs => $4), heartbeat_at = now(),
          attempts = attempts + 1, updated_at = now()
        WHERE transaction_key = $1 AND status = 'running' AND (lease_until IS NULL OR lease_until < now()) AND payload_hash = $2
        RETURNING attempts
      ) SELECT locked.request_event_id, locked.status, locked.result, locked.payload_hash, COALESCE((SELECT attempts FROM reclaimed), locked.attempts) AS claim_attempts, EXISTS(SELECT 1 FROM reclaimed) AS reclaimed FROM locked`,
    [event.transactionKey, hash, attemptId, this.leaseSeconds, recipientEvent(event).replyChannel, recipientEvent(event).streamId, JSON.stringify(recipientEvent(event))]);
    const row = existing.rows[0];
    if (!row) return { kind: "conflict", reason: "transaction claim disappeared" };
    if (row.payload_hash !== hash) return { kind: "conflict", reason: "transactionKey reused with a different action or payload" };
    if (row.reclaimed) return { kind: "claimed", attemptId, attempts: row.claim_attempts };
    return { kind: "joined", requestEventId: row.request_event_id, completed: row.status !== "running", ...(row.result ? { result: row.result } : {}) };
  }

  /**
   * Which of these have already been answered.
   *
   * Used to tell a reaction that finished from one that never happened. A row
   * that is still `running` is deliberately not counted as answered: either it
   * is genuinely in flight, in which case re-sending is absorbed by the claim,
   * or its owner died and re-sending is exactly what should happen.
   */
  async settled(transactionKeys: readonly string[]): Promise<Set<string>> {
    if (!transactionKeys.length) return new Set();
    const result = await this.pool.query<{ transaction_key: string }>(
      "SELECT transaction_key FROM agent_execution WHERE transaction_key = ANY($1::text[]) AND status IN ('completed', 'failed')",
      [[...transactionKeys]],
    );
    return new Set(result.rows.map((row) => row.transaction_key));
  }

  async renew(transactionKey: string, attemptId: string): Promise<boolean> {
    const updated = await this.pool.query(`UPDATE agent_execution SET lease_until = now() + make_interval(secs => $3), heartbeat_at = now(), updated_at = now()
      WHERE transaction_key = $1 AND status = 'running' AND attempt_id = $2`, [transactionKey, attemptId, this.leaseSeconds]);
    return Boolean(updated.rowCount);
  }

  async release(transactionKey: string, attemptId: string): Promise<boolean> {
    const released = await this.pool.query("UPDATE agent_execution SET lease_until = now() - interval '1 second', updated_at = now() WHERE transaction_key = $1 AND status = 'running' AND attempt_id = $2", [transactionKey, attemptId]);
    return Boolean(released.rowCount);
  }

  async complete(transactionKey: string, attemptId: string, result: ResultPayload): Promise<boolean> {
    const updated = await this.pool.query(`UPDATE agent_execution SET status = 'completed', result = $3::jsonb, lease_until = NULL,
      updated_at = now(), completed_at = now() WHERE transaction_key = $1 AND status = 'running' AND attempt_id = $2`,
    [transactionKey, attemptId, JSON.stringify(result)]);
    return Boolean(updated.rowCount);
  }

  /** Finalises only an already abandoned execution; a live owner remains fenced by its lease. */
  async failExpired(transactionKey: string, result: ResultPayload): Promise<boolean> {
    const updated = await this.pool.query(`UPDATE agent_execution SET status = 'failed', result = $2::jsonb, lease_until = NULL,
      updated_at = now(), completed_at = now() WHERE transaction_key = $1 AND status = 'running'
      AND (lease_until IS NULL OR lease_until < now())`, [transactionKey, JSON.stringify(result)]);
    return Boolean(updated.rowCount);
  }

  async recordRedelivery(transactionKey: string): Promise<void> {
    await this.pool.query("UPDATE agent_execution SET queue_redeliveries = queue_redeliveries + 1, updated_at = now() WHERE transaction_key = $1 AND status = 'running'", [transactionKey]);
  }

  /**
   * An expired lease is deliberately observable rather than terminalised here.
   * The retained PGMQ command is the only authority that may reclaim an attempt.
   */
  async expiredRunningCount(): Promise<number> {
    const result = await this.pool.query<{ count: string | number }>("SELECT count(*)::text AS count FROM agent_execution WHERE status='running' AND (lease_until IS NULL OR lease_until < now())");
    return Number(result.rows[0]?.count ?? 0);
  }

  async prune(retentionDays: number): Promise<number> {
    const pruned = await this.pool.query(`WITH expired AS (
      DELETE FROM agent_execution WHERE completed_at < now() - make_interval(days => $1) RETURNING transaction_key
    ) DELETE FROM agent_execution_recipient WHERE transaction_key IN (SELECT transaction_key FROM expired)`, [retentionDays]);
    return pruned.rowCount ?? 0;
  }

  async recipients(transactionKey: string): Promise<EventEnvelope[]> {
    const result = await this.pool.query<{ request_event: EventEnvelope }>("SELECT request_event FROM agent_execution_recipient WHERE transaction_key = $1 ORDER BY created_at", [transactionKey]);
    return result.rows.map((row) => row.request_event);
  }
}
