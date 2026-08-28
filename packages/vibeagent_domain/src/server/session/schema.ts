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

  /**
   * What makes a message the same message.
   *
   * A reactor that appended and then lost its execution lease is retried from
   * the top, and without this the retry would leave a second assistant reply,
   * or a second answer to one tool call, in the history that every later
   * inference call is handed. The chain's ordering was always safe; this is the
   * part that was not, because a retry is not a later step, it is the same step
   * happening twice.
   *
   * `COALESCE` because the columns are legitimately null and null never equals
   * null: the system prompt belongs to no turn, and only a tool answer has a
   * call to answer.
   */
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS vibe_session_message_identity_idx
    ON vibe_session_message (
      session_key,
      COALESCE(turn_key, ''),
      COALESCE(iteration_index, -1),
      role,
      COALESCE(tool_call_id, ''))`);

  /**
   * The latch that lets exactly one reactor declare an iteration finished.
   *
   * When the model asks for N commands, N reactors each answer one and each
   * then asks "are they all in?". The last two can both read N of N — they are
   * separate processes reading after both writes landed — and both would
   * declare the iteration ready, which runs inference twice on one iteration
   * and forks the conversation from that point.
   *
   * Serialising the read would not help: both would still see the same true
   * answer. The question is not who reads last, it is who gets to say it, and
   * that is a uniqueness problem. Inserting here is the saying; only the
   * reactor whose insert survives emits. It closes redelivery in the same
   * stroke, since a repeated fact finds the row already there.
   */
  await pool.query(`CREATE TABLE IF NOT EXISTS vibe_iteration_ready (
    session_key text NOT NULL,
    turn_key text NOT NULL,
    iteration_index integer NOT NULL,
    declared_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_key, turn_key, iteration_index))`);

  /**
   * The context this session was opened with, frozen.
   *
   * A column rather than a message row: it is not part of the conversation and
   * must not be trimmed, summarised or replayed with it. Frozen because the
   * provider caches by token prefix — recomposing it per call would throw the
   * cache away on every call, and changing a running session’s instructions
   * halfway is its own kind of wrong.
   *
   * `context_recipe` says what it was built from. The text is a projection of
   * that; keeping both means a session can be explained without the log having
   * to carry a copy of every prompt.
   */
  await pool.query("ALTER TABLE vibe_session ADD COLUMN IF NOT EXISTS context_prefix text NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE vibe_session ADD COLUMN IF NOT EXISTS context_recipe jsonb NOT NULL DEFAULT '{}'::jsonb");
  await pool.query("ALTER TABLE vibe_session ADD COLUMN IF NOT EXISTS context_suffix text NOT NULL DEFAULT ''");
}
