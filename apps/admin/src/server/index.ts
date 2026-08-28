import { createApp } from "./app.js";
import { readEnv } from "./env.js";
import { ensureAdminSchema, openAdminDatabase } from "admin_domain/server";

const env = readEnv();
const database = openAdminDatabase(env.databaseUrl);

// The schema is asserted before the port opens. A request that arrives against
// a database without tables fails in a way that reads like a bug in the query.
await ensureAdminSchema(database);

const app = createApp(database);
const server = app.listen(env.port, () => {
  console.log(`admin listening on ${env.port}`);
});

// The container stops by signal. Without this the process ignores SIGTERM and
// the runtime waits out its kill timeout on every restart and deploy.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`admin received ${signal}, closing`);
    server.close(() => { void database.end().then(() => process.exit(0)); });
  });
}
