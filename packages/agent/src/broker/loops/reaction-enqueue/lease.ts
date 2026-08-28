import type { Pool, PoolClient } from "pg";

/**
 * Leadership for the one loop that cannot be run twice.
 *
 * Routing reads a named cursor, dispatches everything past it, and writes the
 * cursor back. There is no lock on that row and no compare-and-set: two routers
 * with the same name read the same position, dispatch the same facts, and then
 * overwrite each other's idea of how far they got. Reactions are idempotent, so
 * the duplicates are absorbed — but the lost cursor write is not, and the wasted
 * inference calls are real money.
 *
 * A session-scoped advisory lock decides it. Whoever takes it routes; the others
 * idle and keep asking, so a broker that dies hands the job over without anyone
 * arranging it. The lock lives on its own connection because it is released when
 * that connection ends — which is exactly the behaviour wanted when a process
 * disappears.
 */
export class EnqueueLease {
  private client: PoolClient | undefined;

  constructor(private readonly pool: Pool, private readonly key: number) {}

  /** True while this process is the one that should route. Cheap to call in a loop. */
  async held(): Promise<boolean> {
    if (this.client) return true;
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [this.key]);
      if (result.rows[0]?.ok !== true) { client.release(); return false; }
    } catch (error) { client.release(error as Error); return false; }

    // A dropped connection releases the lock server-side, so the local belief
    // has to drop with it or this process would route without holding it.
    client.on("error", () => { this.client = undefined; });
    this.client = client;
    return true;
  }

  async release(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.client = undefined;
    try { await client.query("SELECT pg_advisory_unlock($1)", [this.key]); }
    catch { /* the connection is going away, which releases it anyway */ }
    client.release();
  }
}

/**
 * A stable 32-bit key from the table's name, so two deployments of different
 * domains do not contend for one lock.
 */
export function leaseKeyFor(name: string): number {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}
