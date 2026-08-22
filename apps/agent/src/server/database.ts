import { Pool } from "pg";

export function createDatabasePool(databaseUrl: string, max = 16): Pool {
  return new Pool({ connectionString: databaseUrl, max });
}

export type DatabasePoolSnapshot = { total: number; idle: number; waiting: number };

/** pg exposes these counters synchronously; sampling them never consumes a connection. */
export function snapshotDatabasePool(pool: Pool): DatabasePoolSnapshot {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}
