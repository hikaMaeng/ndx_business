import { createApp } from "./app.js";
import { readEnv } from "./env.js";
import { Pool } from "pg";

const env = readEnv();
const database = new Pool({ connectionString: env.databaseUrl });
const app = createApp(database);

const server = app.listen(env.port, () => {
  console.log(`admin listening on ${env.port}`);
});

// The container stops by signal. Without this the process ignores SIGTERM and
// the runtime waits out its kill timeout on every restart and deploy.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`admin received ${signal}, closing`);
    server.close(() => void database.end().finally(() => process.exit(0)));
  });
}
