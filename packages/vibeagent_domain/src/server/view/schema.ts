import type { Pool } from "pg";

/**
 * The transcript, already folded.
 *
 * The log is the truth, but it is a terrible thing to read a session from. One
 * iteration of one turn is a thousand reasoning deltas; replaying a finished
 * session to put it back on screen means shipping every one of them to a
 * browser that will immediately join them into a single paragraph. The fold is
 * the same every time, so it should happen once, on the way in.
 *
 * That is all these two tables are: the fold, written by a worker that reacts
 * to the same facts as everyone else. Nothing here is a source of truth. Drop
 * both tables and the log can rebuild them.
 *
 * `vibe_turn_view` is what a collapsed turn shows — enough to decide whether to
 * open it, and nothing more.
 *
 * `vibe_block_view` is what an opened turn shows. It is fetched only when
 * somebody actually opens that turn, which is what makes a long session cheap:
 * the client holds summaries, and bodies arrive one turn at a time.
 */
export async function ensureViewSchema(pool: Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS vibe_turn_view (
    session_key text NOT NULL,
    turn_key text NOT NULL,
    seq bigint NOT NULL DEFAULT 0,
    prompt text NOT NULL DEFAULT '',
    phase text NOT NULL DEFAULT 'running',
    answer text NOT NULL DEFAULT '',
    error text NOT NULL DEFAULT '',
    iterations integer NOT NULL DEFAULT 0,
    tool_calls integer NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    PRIMARY KEY (session_key, turn_key))`);

  await pool.query("CREATE INDEX IF NOT EXISTS vibe_turn_view_order_idx ON vibe_turn_view (session_key, seq)");

  await pool.query(`CREATE TABLE IF NOT EXISTS vibe_block_view (
    session_key text NOT NULL,
    turn_key text NOT NULL,
    seq bigint NOT NULL,
    kind text NOT NULL,
    iteration_index integer NOT NULL DEFAULT 0,
    tool_call_key text NOT NULL DEFAULT '',
    command text NOT NULL DEFAULT '',
    body text NOT NULL DEFAULT '',
    exit_code integer,
    timed_out boolean NOT NULL DEFAULT false,
    duration_ms integer NOT NULL DEFAULT 0,
    PRIMARY KEY (session_key, turn_key, seq))`);

  await pool.query("CREATE INDEX IF NOT EXISTS vibe_block_view_turn_idx ON vibe_block_view (session_key, turn_key, seq)");

  /**
   * The projection reads the log by turn, and the log's own indexes are built
   * for tailing a channel — the wrong shape entirely for "every reasoning delta
   * of this iteration". The index belongs to this access path, so it is created
   * with the thing that needs it rather than added to the library's table
   * definition, which knows nothing about turns.
   */
  await pool.query(`CREATE INDEX IF NOT EXISTS event_store_turn_fold_idx
    ON event_store (session_id, (payload->>'turnKey'), action)`);
}
