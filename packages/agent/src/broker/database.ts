import { Pool } from "pg";

/**
 * A pool that survives losing an idle connection.
 *
 * `pg` raises an `error` event on the pool when a client that nobody is using
 * drops — a database restart says exactly that, with "terminating connection
 * due to administrator command". Node treats an unhandled `error` event as
 * fatal, so without this listener the process dies. It really did: redeploying
 * Admin restarts the database every service shares, and the broker went down
 * with it and came back up in standby.
 *
 * Losing an idle client is not a failure. The pool discards it and opens
 * another on the next query, so the only thing needed is to say so out loud.
 */
export function createDatabasePool(databaseUrl: string, max = 16): Pool {
  const pool = new Pool({ connectionString: databaseUrl, max });
  pool.on("error", (error) => {
    console.warn(JSON.stringify({
      event: "database.pool.idle.dropped",
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  return pool;
}

export type DatabasePoolSnapshot = { total: number; idle: number; waiting: number };

/** pg exposes these counters synchronously; sampling them never consumes a connection. */
export function snapshotDatabasePool(pool: Pool): DatabasePoolSnapshot {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}
