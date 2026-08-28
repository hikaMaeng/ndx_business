import { Pool } from "pg";

/**
 * Admin's store.
 *
 * A `Pool`, and every domain function here takes one. Every one of them is
 * async because of it — 44 domain functions and 29 route handlers — which is
 * the part of adopting PostgreSQL that translating the DDL never showed.
 */
export type AdminDatabase = Pool;

/**
 * Admin's tables live in their own schema.
 *
 * One PostgreSQL server now holds the event log, the queues and this. `users`,
 * `sessions` and `organizations` are names any of them might have wanted, so
 * they are namespaced rather than left to collide by luck.
 */
export const ADMIN_SCHEMA = "admin";

const statements: readonly string[] = [
  `CREATE SCHEMA IF NOT EXISTS ${ADMIN_SCHEMA}`,
  // `citext`, so uniqueness is case-insensitive: `A@x.com` and `a@x.com` are
  // one account and not two.
  "CREATE EXTENSION IF NOT EXISTS citext",
  "CREATE TABLE IF NOT EXISTS auth_settings (id integer PRIMARY KEY CHECK (id = 1), signup_acceptance_mode text NOT NULL CHECK (signup_acceptance_mode IN ('auto', 'filter', 'approval')) DEFAULT 'auto', signup_filter_json jsonb, session_idle_timeout_seconds integer NOT NULL DEFAULT 3600 CHECK (session_idle_timeout_seconds >= 60), expired_session_retention_mode text NOT NULL CHECK (expired_session_retention_mode IN ('none', 'retain')) DEFAULT 'none', expired_session_retention_seconds integer NOT NULL DEFAULT 0 CHECK (expired_session_retention_seconds >= 0), updated_at text NOT NULL, session_header_name text NOT NULL DEFAULT 'X-Admin-Session', session_cookie_name text NOT NULL DEFAULT 'admin_session')",
  "CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email citext NOT NULL UNIQUE, password_hash text NOT NULL, status text NOT NULL CHECK (status IN ('active', 'pending', 'rejected')), signup_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at text NOT NULL, approved_at text)",
  "CREATE INDEX IF NOT EXISTS idx_users_status_created ON users(status, created_at DESC)",
  "CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, created_at text NOT NULL, last_used_at text NOT NULL, expires_at text NOT NULL, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, revoked_at text, token_value text)",
  "CREATE TABLE IF NOT EXISTS session_devices (id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, device_key text NOT NULL, label text NOT NULL DEFAULT 'Unknown client', first_seen_at text NOT NULL, last_request_at text NOT NULL, request_count integer NOT NULL DEFAULT 0, revoked_at text, UNIQUE(session_id, device_key))",
  "CREATE TABLE IF NOT EXISTS session_request_logs (id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, device_id text NOT NULL REFERENCES session_devices(id) ON DELETE CASCADE, requested_at text NOT NULL, method text NOT NULL, path text NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_session_request_logs_device_time ON session_request_logs(device_id, requested_at DESC)",
  "CREATE TABLE IF NOT EXISTS organizations (id text PRIMARY KEY, name text NOT NULL, parent_id text REFERENCES organizations(id) ON DELETE CASCADE, created_at text NOT NULL, color text NOT NULL DEFAULT 'blue', icon text NOT NULL DEFAULT 'building')",
  "CREATE INDEX IF NOT EXISTS idx_organizations_parent ON organizations(parent_id)",
  "CREATE TABLE IF NOT EXISTS organization_members (organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (organization_id, user_id))",
  "CREATE TABLE IF NOT EXISTS organization_responsibilities (organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope text NOT NULL CHECK (scope IN ('node', 'subtree')), PRIMARY KEY (organization_id, user_id))",
  "CREATE TABLE IF NOT EXISTS model_endpoints (id text PRIMARY KEY, name text NOT NULL, url text NOT NULL, header_name text NOT NULL DEFAULT '', header_value text NOT NULL DEFAULT '', api_type text NOT NULL CHECK (api_type IN ('openai-chat-completion', 'openai-responses', 'anthropic', 'gemini')), created_at text NOT NULL, updated_at text NOT NULL)",
  "CREATE TABLE IF NOT EXISTS model_definitions (id text PRIMARY KEY, endpoint_id text NOT NULL REFERENCES model_endpoints(id) ON DELETE CASCADE, identifier text NOT NULL, context_size integer NOT NULL DEFAULT 0 CHECK (context_size >= 0), temperature double precision NOT NULL DEFAULT 1, min_p double precision NOT NULL DEFAULT 0 CHECK (min_p >= 0 AND min_p <= 1), top_p double precision NOT NULL DEFAULT 1 CHECK (top_p >= 0 AND top_p <= 1), top_k integer NOT NULL DEFAULT 0 CHECK (top_k >= 0), repeat_penalty double precision NOT NULL DEFAULT 1, reasoning integer NOT NULL DEFAULT 0 CHECK (reasoning IN (0, 1)), supports_text integer NOT NULL DEFAULT 1 CHECK (supports_text IN (0, 1)), supports_image integer NOT NULL DEFAULT 0 CHECK (supports_image IN (0, 1)), supports_sound integer NOT NULL DEFAULT 0 CHECK (supports_sound IN (0, 1)), supports_video integer NOT NULL DEFAULT 0 CHECK (supports_video IN (0, 1)), created_at text NOT NULL, updated_at text NOT NULL, UNIQUE(endpoint_id, identifier))",
  "CREATE INDEX IF NOT EXISTS idx_model_definitions_endpoint ON model_definitions(endpoint_id, identifier)",
  "CREATE TABLE IF NOT EXISTS organization_inference_services (organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, endpoint_id text NOT NULL REFERENCES model_endpoints(id) ON DELETE CASCADE, PRIMARY KEY (organization_id, endpoint_id))",
  "CREATE TABLE IF NOT EXISTS organization_inference_models (organization_id text NOT NULL, endpoint_id text NOT NULL, model_id text NOT NULL REFERENCES model_definitions(id) ON DELETE CASCADE, active integer NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), PRIMARY KEY (organization_id, endpoint_id, model_id), FOREIGN KEY (organization_id, endpoint_id) REFERENCES organization_inference_services(organization_id, endpoint_id) ON DELETE CASCADE)",
  "CREATE INDEX IF NOT EXISTS idx_organization_inference_models_service ON organization_inference_models(organization_id, endpoint_id)",

  // A project is a folder, and a record. The folder is where the work happens;
  // the record says who it belongs to and under whose policy it runs, which a
  // directory entry cannot. organization_id is null for a personal project, and
  // RESTRICT rather than CASCADE on purpose: removing an organisation must not
  // silently orphan folders that still exist on disk.
  "CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, organization_id text REFERENCES organizations(id) ON DELETE RESTRICT, name text NOT NULL, created_at text NOT NULL, UNIQUE(owner_id, name))",
  "CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id, name)",
  "CREATE INDEX IF NOT EXISTS idx_projects_organization ON projects(organization_id)",

  // Files every new project starts with, edited in Admin rather than baked into
  // an image. Keyed by name so a second one is a row and not a migration.
  "CREATE TABLE IF NOT EXISTS project_defaults (name text PRIMARY KEY, content text NOT NULL, updated_at text NOT NULL)",

  /*
   * What a session is given: skills, MCP servers, commands, hooks.
   *
   * One table for every kind because the merge is the same for all of them and
   * writing it four times is how four of them end up disagreeing. `kind` says
   * which; `value` is whatever that kind needs and this layer never reads.
   *
   * An entry belongs to exactly one place. Either an organisation set it, or an
   * account did — globally, or for one of its projects. The CHECK is what keeps
   * a row from claiming two of those at once and making its precedence a
   * question rather than a fact.
   *
   * `mode` is the whole reason organisations can have policy at all. A
   * `default` is a suggestion an account may override; `enforced` cannot be
   * overridden or removed by anyone below, and between organisations the
   * outermost one wins. Without the distinction a parent that sets anything
   * freezes it for the entire tree, and sub-organisation settings become inert.
   */
  `CREATE TABLE IF NOT EXISTS policy (
     id text PRIMARY KEY,
     kind text NOT NULL CHECK (kind IN ('skill', 'mcp', 'command', 'hook', 'prompt')),
     name text NOT NULL,
     organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
     owner_id text REFERENCES users(id) ON DELETE CASCADE,
     project_id text REFERENCES projects(id) ON DELETE CASCADE,
     mode text NOT NULL DEFAULT 'default' CHECK (mode IN ('default', 'enforced')),
     enabled boolean NOT NULL DEFAULT true,
     value jsonb NOT NULL DEFAULT '{}'::jsonb,
     updated_at text NOT NULL,
     CHECK (
       (organization_id IS NOT NULL AND owner_id IS NULL AND project_id IS NULL)
       OR (organization_id IS NULL AND owner_id IS NOT NULL)
     ),
     CHECK (mode = 'default' OR organization_id IS NOT NULL)
   )`,
  // One entry per key per place. The partial indexes are how "one per place"
  // is said when two of the three columns are null.
  // The kinds grew after the table shipped, and CREATE TABLE IF NOT EXISTS will
  // not widen a CHECK on a table that already exists.
  "ALTER TABLE policy DROP CONSTRAINT IF EXISTS policy_kind_check",
  "ALTER TABLE policy ADD CONSTRAINT policy_kind_check CHECK (kind IN ('skill', 'mcp', 'command', 'hook', 'prompt'))",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_organization ON policy(organization_id, kind, name) WHERE organization_id IS NOT NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_account_global ON policy(owner_id, kind, name) WHERE owner_id IS NOT NULL AND project_id IS NULL",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_account_project ON policy(owner_id, project_id, kind, name) WHERE project_id IS NOT NULL",
];

/**
 * Opens the pool every domain function expects.
 *
 * `search_path` is a connection option rather than a statement issued after
 * connecting: the pool opens connections lazily and on demand, so anything set
 * by hand would have to be re-set on each one and would race the first query.
 */
export function openAdminDatabase(connectionString: string, max = 8, schema = ADMIN_SCHEMA): AdminDatabase {
  const pool = new Pool({ connectionString, max, options: `-c search_path=${schema},public` });
  /**
   * An idle connection dropping is not a failure.
   *
   * `pg` raises `error` on the pool when a client nobody is using goes away — a
   * database restart says exactly that. Node treats an unhandled `error` event
   * as fatal, so without this the process dies over a connection it was not
   * using. The pool discards it and opens another on the next query.
   */
  pool.on("error", (error) => {
    console.warn(JSON.stringify({
      event: "database.pool.idle.dropped",
      error: error instanceof Error ? error.message : String(error),
    }));
  });
  return pool;
}

export async function ensureAdminSchema(database: AdminDatabase, schema = ADMIN_SCHEMA): Promise<void> {
  for (const statement of statements) {
    await database.query(statement.replace(`CREATE SCHEMA IF NOT EXISTS ${ADMIN_SCHEMA}`, `CREATE SCHEMA IF NOT EXISTS ${schema}`));
  }
  // The settings row has to exist before anything can update it: every write is
  // an UPDATE against id = 1, which on an empty table changes nothing and
  // reports success. Seeding here is what stops a fresh deployment from
  // accepting settings and silently keeping the defaults.
  await database.query(
    "INSERT INTO auth_settings (id, updated_at) VALUES (1, $1) ON CONFLICT (id) DO NOTHING",
    [new Date().toISOString()],
  );
}

/**
 * The three shapes every query here takes, over a pool.
 *
 * Queries are written with `?` and numbered here. Renumbering `$1`, `$2` … by
 * hand across sixty-odd call sites is precisely the kind of edit that silently
 * swaps two arguments of the same type, so it happens once, in one place.
 */
export interface AdminQueries {
  get(text: string, ...params: unknown[]): Promise<Record<string, unknown> | undefined>;
  all(text: string, ...params: unknown[]): Promise<Record<string, unknown>[]>;
  run(text: string, ...params: unknown[]): Promise<{ changes: number }>;
}

/** `?` in order becomes `$1`, `$2`, … */
export function positional(text: string): string {
  let index = 0;
  return text.replace(/\?/g, () => `$${(index += 1)}`);
}

export function queries(database: AdminDatabase): AdminQueries {
  return {
    async get(text, ...params) {
      return (await database.query(positional(text), params)).rows[0] as Record<string, unknown> | undefined;
    },
    async all(text, ...params) {
      return (await database.query(positional(text), params)).rows as Record<string, unknown>[];
    },
    async run(text, ...params) {
      const result = await database.query(positional(text), params);
      return { changes: result.rowCount ?? 0 };
    },
  };
}
