import { randomBytes } from "node:crypto";
import { ensureAdminSchema, openAdminDatabase, type AdminDatabase } from "../database/index.js";

/**
 * Where a test finds a PostgreSQL to work against.
 *
 * The deployed Admin publishes its database on this port for exactly this
 * reason: these tests exercise real SQL, so they need a real server.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:15432/ndx_business";

/**
 * A private schema per test, dropped when it ends.
 *
 * A schema rather than a database: creating one is cheap and needs no
 * privileges beyond the connection already has, and the isolation is the same —
 * two tests running side by side never see each other's rows.
 */
export async function useAdminDatabase(
  t: { after: (fn: () => void | Promise<void>) => void },
): Promise<AdminDatabase> {
  const schema = `test_${randomBytes(8).toString("hex")}`;
  const database = openAdminDatabase(TEST_DATABASE_URL, 4, schema);
  await ensureAdminSchema(database, schema);
  t.after(async () => {
    try { await database.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
    finally { await database.end(); }
  });
  return database;
}

/** True when the database this suite needs is reachable, so a run can say why it stopped. */
export async function adminDatabaseReachable(): Promise<boolean> {
  const probe = openAdminDatabase(TEST_DATABASE_URL, 1);
  try { await probe.query("SELECT 1"); return true; }
  catch { return false; }
  finally { await probe.end().catch(() => undefined); }
}
