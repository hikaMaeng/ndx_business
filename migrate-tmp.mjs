/**
 * One-time move of Admin's data into PostgreSQL.
 *
 * Run inside the admin container, where both stores are reachable. Nothing in
 * the shipped code reads the old file — this exists to carry the rows across
 * once, and is thrown away afterwards.
 *
 * Idempotent: every insert skips a row that is already there, so a partial run
 * can simply be repeated.
 */
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";

const SOURCE = process.env.LEGACY_PATH ?? "/app/data/admin/admin.sqlite";
const TARGET = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/ndx_business";

// Parents before children: every foreign key must already have something to
// point at, or the insert is rejected and the row is silently left behind.
const order = [
  ["auth_settings", ["id", "signup_acceptance_mode", "signup_filter_json", "session_idle_timeout_seconds", "expired_session_retention_mode", "expired_session_retention_seconds", "updated_at", "session_header_name", "session_cookie_name"]],
  ["users", ["id", "email", "password_hash", "status", "signup_metadata_json", "created_at", "approved_at"]],
  ["sessions", ["id", "user_id", "token_hash", "created_at", "last_used_at", "expires_at", "metadata_json", "revoked_at", "token_value"]],
  ["session_devices", ["id", "session_id", "device_key", "label", "first_seen_at", "last_request_at", "request_count", "revoked_at"]],
  ["session_request_logs", ["id", "session_id", "device_id", "requested_at", "method", "path"]],
  ["organizations", ["id", "name", "parent_id", "created_at", "color", "icon"]],
  ["organization_members", ["organization_id", "user_id"]],
  ["organization_responsibilities", ["organization_id", "user_id", "scope"]],
  ["model_endpoints", ["id", "name", "url", "header_name", "header_value", "api_type", "created_at", "updated_at"]],
  ["model_definitions", ["id", "endpoint_id", "identifier", "context_size", "temperature", "min_p", "top_p", "top_k", "repeat_penalty", "reasoning", "supports_text", "supports_image", "supports_sound", "supports_video", "created_at", "updated_at"]],
  ["organization_inference_services", ["organization_id", "endpoint_id"]],
  ["organization_inference_models", ["organization_id", "endpoint_id", "model_id", "active"]],
];

const jsonColumns = new Set(["signup_filter_json", "signup_metadata_json", "metadata_json"]);

const source = new DatabaseSync(SOURCE, { readOnly: true });
const pool = new Pool({ connectionString: TARGET, options: "-c search_path=admin,public" });
const client = await pool.connect();
const report = [];

try {
  await client.query("BEGIN");
  for (const [table, columns] of order) {
    let rows;
    try { rows = source.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all(); }
    catch (error) { report.push(`${table.padEnd(32)} SKIPPED (${error.message})`); continue; }

    const placeholders = columns.map((c, i) => (jsonColumns.has(c) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ");
    let moved = 0;
    for (const row of rows) {
      const values = columns.map((c) => (jsonColumns.has(c) && row[c] !== null && typeof row[c] !== "string" ? JSON.stringify(row[c]) : row[c]));
      const result = await client.query(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values,
      );
      moved += result.rowCount ?? 0;
    }
    const after = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
    report.push(`${table.padEnd(32)} source=${String(rows.length).padStart(5)}  inserted=${String(moved).padStart(5)}  now=${String(after.rows[0].n).padStart(5)}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("ROLLED BACK:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
  source.close();
}

for (const line of report) console.log(line);
