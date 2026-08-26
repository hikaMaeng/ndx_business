import type { Pool } from "pg";

/**
 * The session's context, in the database.
 *
 * It used to live in worker memory. That is not safe: worker threads are
 * separate isolates and replicas are separate machines, so "the" context was
 * really one copy per process, each drifting on its own. There is no lock that
 * spans them. PostgreSQL already has one, so the context lives where the lock is.
 *
 * Two tables, because they answer two different questions.
 *
 * `vibe_session` is the session itself: which folder it works in, and how far
 * its position counter has been handed out. One row, so it is also the thing to
 * lock when a handler needs the session to hold still.
 *
 * `vibe_session_message` is the conversation. Calling the model is not a
 * conversation with anything — each inference call is unrelated to the last and
 * remembers nothing. What actually happens is that messages accumulate here and
 * the whole pile is handed over every time. "Returning a tool result to the
 * model" is a way of speaking; appending a row is the fact.
 */
export async function ensureSessionSchema(pool: Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS vibe_session (
    session_key text PRIMARY KEY,
    workspace text NOT NULL,
    next_seq bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS vibe_session_message (
    session_key text NOT NULL,
    ordinal bigint NOT NULL,
    turn_key text,
    iteration_index integer,
    role text NOT NULL,
    content text NOT NULL DEFAULT '',
    tool_calls jsonb,
    tool_call_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_key, ordinal))`);

  await pool.query("CREATE INDEX IF NOT EXISTS vibe_session_message_turn_idx ON vibe_session_message (session_key, turn_key, ordinal)");
}
