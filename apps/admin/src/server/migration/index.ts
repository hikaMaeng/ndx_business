import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { Pool } from "pg";

const sourcePath = process.env.AUTH_DATABASE_PATH ?? path.resolve("../../apps/admin/data/admin.sqlite");
const targetUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:15432/ndx_business";

const schema = [
  `CREATE TABLE IF NOT EXISTS auth_settings (id integer PRIMARY KEY CHECK (id = 1), signup_acceptance_mode text NOT NULL CHECK (signup_acceptance_mode IN ('auto', 'filter', 'approval')) DEFAULT 'auto', signup_filter_json jsonb, session_idle_timeout_seconds integer NOT NULL DEFAULT 3600 CHECK (session_idle_timeout_seconds >= 60), expired_session_retention_mode text NOT NULL CHECK (expired_session_retention_mode IN ('none', 'retain')) DEFAULT 'none', expired_session_retention_seconds integer NOT NULL DEFAULT 0 CHECK (expired_session_retention_seconds >= 0), updated_at text NOT NULL, session_header_name text NOT NULL DEFAULT 'X-Admin-Session', session_cookie_name text NOT NULL DEFAULT 'admin_session')`,
  `CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, status text NOT NULL CHECK (status IN ('active', 'pending', 'rejected')), signup_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at text NOT NULL, approved_at text)`,
  `CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, created_at text NOT NULL, last_used_at text NOT NULL, expires_at text NOT NULL, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, revoked_at text, token_value text)`,
  `CREATE TABLE IF NOT EXISTS session_devices (id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, device_key text NOT NULL, label text NOT NULL DEFAULT 'Unknown client', first_seen_at text NOT NULL, last_request_at text NOT NULL, request_count integer NOT NULL DEFAULT 0, revoked_at text, UNIQUE(session_id, device_key))`,
  `CREATE TABLE IF NOT EXISTS session_request_logs (id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, device_id text NOT NULL REFERENCES session_devices(id) ON DELETE CASCADE, requested_at text NOT NULL, method text NOT NULL, path text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS organizations (id text PRIMARY KEY, name text NOT NULL, parent_id text REFERENCES organizations(id) ON DELETE CASCADE, created_at text NOT NULL, color text NOT NULL DEFAULT 'blue', icon text NOT NULL DEFAULT 'building')`,
  `CREATE TABLE IF NOT EXISTS organization_members (organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (organization_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS organization_responsibilities (organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope text NOT NULL CHECK (scope IN ('node', 'subtree')), PRIMARY KEY (organization_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS model_endpoints (id text PRIMARY KEY, name text NOT NULL, url text NOT NULL, header_name text NOT NULL DEFAULT '', header_value text NOT NULL DEFAULT '', api_type text NOT NULL CHECK (api_type IN ('openai-chat-completion', 'openai-responses', 'anthropic', 'gemini')), created_at text NOT NULL, updated_at text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS model_definitions (id text PRIMARY KEY, endpoint_id text NOT NULL REFERENCES model_endpoints(id) ON DELETE CASCADE, identifier text NOT NULL, context_size integer NOT NULL DEFAULT 0, temperature double precision NOT NULL DEFAULT 1, min_p double precision NOT NULL DEFAULT 0, top_p double precision NOT NULL DEFAULT 1, top_k integer NOT NULL DEFAULT 0, repeat_penalty double precision NOT NULL DEFAULT 1, reasoning integer NOT NULL DEFAULT 0, supports_text integer NOT NULL DEFAULT 1, supports_image integer NOT NULL DEFAULT 0, supports_sound integer NOT NULL DEFAULT 0, supports_video integer NOT NULL DEFAULT 0, created_at text NOT NULL, updated_at text NOT NULL, UNIQUE(endpoint_id, identifier))`,
  `CREATE TABLE IF NOT EXISTS organization_inference_services (organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, endpoint_id text NOT NULL REFERENCES model_endpoints(id) ON DELETE CASCADE, PRIMARY KEY (organization_id, endpoint_id))`,
  `CREATE TABLE IF NOT EXISTS organization_inference_models (organization_id text NOT NULL, endpoint_id text NOT NULL, model_id text NOT NULL REFERENCES model_definitions(id) ON DELETE CASCADE, active integer NOT NULL DEFAULT 1, PRIMARY KEY (organization_id, endpoint_id, model_id), FOREIGN KEY (organization_id, endpoint_id) REFERENCES organization_inference_services(organization_id, endpoint_id) ON DELETE CASCADE)`,
];

const columns: Record<string, string[]> = {
  auth_settings: ["id", "signup_acceptance_mode", "signup_filter_json", "session_idle_timeout_seconds", "expired_session_retention_mode", "expired_session_retention_seconds", "updated_at", "session_header_name", "session_cookie_name"],
  users: ["id", "email", "password_hash", "status", "signup_metadata_json", "created_at", "approved_at"],
  sessions: ["id", "user_id", "token_hash", "created_at", "last_used_at", "expires_at", "metadata_json", "revoked_at", "token_value"],
  session_devices: ["id", "session_id", "device_key", "label", "first_seen_at", "last_request_at", "request_count", "revoked_at"],
  session_request_logs: ["id", "session_id", "device_id", "requested_at", "method", "path"],
  organizations: ["id", "name", "parent_id", "created_at", "color", "icon"],
  organization_members: ["organization_id", "user_id"],
  organization_responsibilities: ["organization_id", "user_id", "scope"],
  model_endpoints: ["id", "name", "url", "header_name", "header_value", "api_type", "created_at", "updated_at"],
  model_definitions: ["id", "endpoint_id", "identifier", "context_size", "temperature", "min_p", "top_p", "top_k", "repeat_penalty", "reasoning", "supports_text", "supports_image", "supports_sound", "supports_video", "created_at", "updated_at"],
  organization_inference_services: ["organization_id", "endpoint_id"],
  organization_inference_models: ["organization_id", "endpoint_id", "model_id", "active"],
};

const jsonColumns = new Set(["signup_filter_json", "signup_metadata_json", "metadata_json"]);
const conflictTargets: Record<string, string> = { auth_settings: "id", users: "id", sessions: "id", session_devices: "id", session_request_logs: "id", organizations: "id", model_endpoints: "id", model_definitions: "id" };

async function main(): Promise<void> {
  const sqlite = new DatabaseSync(sourcePath);
  const pool = new Pool({ connectionString: targetUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of schema) await client.query(statement);
    for (const [table, tableColumns] of Object.entries(columns)) {
      const rows = sqlite.prepare(`SELECT ${tableColumns.join(", ")} FROM ${table}`).all() as Array<Record<string, unknown>>;
      if (!rows.length) { console.log(`migrate table=${table} rows=0`); continue; }
      for (const row of rows) {
        const placeholders = tableColumns.map((column, index) => jsonColumns.has(column) ? `$${index + 1}::jsonb` : `$${index + 1}`);
        const target = conflictTargets[table] ? ` ON CONFLICT (${conflictTargets[table]}) DO NOTHING` : " ON CONFLICT DO NOTHING";
        await client.query(`INSERT INTO ${table} (${tableColumns.join(", ")}) VALUES (${placeholders.join(", ")})${target}`, tableColumns.map((column) => jsonColumns.has(column) && row[column] !== null ? JSON.stringify(row[column]) : row[column]));
      }
      console.log(`migrate table=${table} rows=${rows.length}`);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); sqlite.close(); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
