import { Pool } from "pg";

export function createDatabasePool(databaseUrl: string, max = 16): Pool {
  return new Pool({ connectionString: databaseUrl, max });
}
