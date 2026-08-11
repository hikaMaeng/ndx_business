import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const schema = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS auth_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  signup_acceptance_mode TEXT NOT NULL CHECK (signup_acceptance_mode IN ('auto', 'filter', 'approval')) DEFAULT 'auto',
  signup_filter_json TEXT,
  session_idle_timeout_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (session_idle_timeout_seconds >= 60),
  expired_session_retention_mode TEXT NOT NULL CHECK (expired_session_retention_mode IN ('none', 'retain')) DEFAULT 'none',
  expired_session_retention_seconds INTEGER NOT NULL DEFAULT 0 CHECK (expired_session_retention_seconds >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'pending', 'rejected')),
  signup_metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_status_created ON users(status, created_at DESC);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  token_value TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_last_used ON sessions(user_id, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry_revoked ON sessions(expires_at, revoked_at);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE TABLE IF NOT EXISTS session_devices (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  device_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Unknown client',
  first_seen_at TEXT NOT NULL,
  last_request_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  UNIQUE(session_id, device_key)
);
CREATE INDEX IF NOT EXISTS idx_session_devices_session_last ON session_devices(session_id, last_request_at DESC);
CREATE TABLE IF NOT EXISTS session_request_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES session_devices(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_request_logs_device_time ON session_request_logs(device_id, requested_at DESC);
CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES organizations(id) ON DELETE CASCADE, color TEXT NOT NULL DEFAULT 'blue', icon TEXT NOT NULL DEFAULT 'building', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_organizations_parent ON organizations(parent_id);
CREATE TABLE IF NOT EXISTS organization_members (organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (organization_id, user_id));
CREATE TABLE IF NOT EXISTS organization_responsibilities (organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL CHECK (scope IN ('node', 'subtree')), PRIMARY KEY (organization_id, user_id));
CREATE TABLE IF NOT EXISTS model_endpoints (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, header_name TEXT NOT NULL DEFAULT '', header_value TEXT NOT NULL DEFAULT '', api_type TEXT NOT NULL CHECK (api_type IN ('openai-chat-completion', 'openai-responses', 'anthropic', 'gemini')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS model_definitions (id TEXT PRIMARY KEY, endpoint_id TEXT NOT NULL REFERENCES model_endpoints(id) ON DELETE CASCADE, identifier TEXT NOT NULL, context_size INTEGER NOT NULL DEFAULT 0 CHECK (context_size >= 0), temperature REAL NOT NULL DEFAULT 1, min_p REAL NOT NULL DEFAULT 0 CHECK (min_p >= 0 AND min_p <= 1), top_p REAL NOT NULL DEFAULT 1 CHECK (top_p >= 0 AND top_p <= 1), top_k INTEGER NOT NULL DEFAULT 0 CHECK (top_k >= 0), repeat_penalty REAL NOT NULL DEFAULT 1, reasoning INTEGER NOT NULL DEFAULT 0 CHECK (reasoning IN (0, 1)), supports_text INTEGER NOT NULL DEFAULT 1 CHECK (supports_text IN (0, 1)), supports_image INTEGER NOT NULL DEFAULT 0 CHECK (supports_image IN (0, 1)), supports_sound INTEGER NOT NULL DEFAULT 0 CHECK (supports_sound IN (0, 1)), supports_video INTEGER NOT NULL DEFAULT 0 CHECK (supports_video IN (0, 1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(endpoint_id, identifier));
CREATE INDEX IF NOT EXISTS idx_model_definitions_endpoint ON model_definitions(endpoint_id, identifier);
`;

export function openAuthDatabase(filename: string): DatabaseSync {
  mkdirSync(path.dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec(schema);
  for (const statement of [
    "ALTER TABLE sessions ADD COLUMN token_value TEXT",
    "ALTER TABLE auth_settings ADD COLUMN session_header_name TEXT NOT NULL DEFAULT 'X-Admin-Session'",
    "ALTER TABLE auth_settings ADD COLUMN session_cookie_name TEXT NOT NULL DEFAULT 'admin_session'",
    "ALTER TABLE organizations ADD COLUMN color TEXT NOT NULL DEFAULT 'blue'",
    "ALTER TABLE organizations ADD COLUMN icon TEXT NOT NULL DEFAULT 'building'"
  ]) {
    try { database.exec(statement); } catch { /* Existing databases already have the column. */ }
  }
  database.prepare(`INSERT INTO auth_settings (id, updated_at) VALUES (1, ?) ON CONFLICT(id) DO NOTHING`).run(new Date().toISOString());
  return database;
}
