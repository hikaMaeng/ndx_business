CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgmq;

SELECT pgmq.create('agent_requests')
WHERE NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'agent_requests');
SELECT pgmq.create('agent_results')
WHERE NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'agent_results');

CREATE TABLE IF NOT EXISTS auth_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  signup_acceptance_mode text NOT NULL CHECK (signup_acceptance_mode IN ('auto', 'filter', 'approval')) DEFAULT 'auto',
  signup_filter_json jsonb,
  session_idle_timeout_seconds integer NOT NULL DEFAULT 3600 CHECK (session_idle_timeout_seconds >= 60),
  expired_session_retention_mode text NOT NULL CHECK (expired_session_retention_mode IN ('none', 'retain')) DEFAULT 'none',
  expired_session_retention_seconds integer NOT NULL DEFAULT 0 CHECK (expired_session_retention_seconds >= 0),
  updated_at text NOT NULL,
  session_header_name text NOT NULL DEFAULT 'X-Admin-Session',
  session_cookie_name text NOT NULL DEFAULT 'admin_session'
);
INSERT INTO auth_settings (id, updated_at) VALUES (1, now()::text) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'pending', 'rejected')),
  signup_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at text NOT NULL, approved_at text
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, created_at text NOT NULL, last_used_at text NOT NULL,
  expires_at text NOT NULL, metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, revoked_at text, token_value text
);
CREATE TABLE IF NOT EXISTS session_devices (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  device_key text NOT NULL, label text NOT NULL DEFAULT 'Unknown client', first_seen_at text NOT NULL,
  last_request_at text NOT NULL, request_count integer NOT NULL DEFAULT 0, revoked_at text,
  UNIQUE(session_id, device_key)
);
CREATE TABLE IF NOT EXISTS session_request_logs (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES session_devices(id) ON DELETE CASCADE,
  requested_at text NOT NULL, method text NOT NULL, path text NOT NULL
);
CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY, name text NOT NULL, parent_id text REFERENCES organizations(id) ON DELETE CASCADE,
  created_at text NOT NULL, color text NOT NULL DEFAULT 'blue', icon text NOT NULL DEFAULT 'building'
);
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE IF NOT EXISTS organization_responsibilities (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('node', 'subtree')),
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE IF NOT EXISTS model_endpoints (
  id text PRIMARY KEY, name text NOT NULL, url text NOT NULL, header_name text NOT NULL DEFAULT '',
  header_value text NOT NULL DEFAULT '', api_type text NOT NULL CHECK (api_type IN ('openai-chat-completion', 'openai-responses', 'anthropic', 'gemini')),
  created_at text NOT NULL, updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS model_definitions (
  id text PRIMARY KEY, endpoint_id text NOT NULL REFERENCES model_endpoints(id) ON DELETE CASCADE,
  identifier text NOT NULL, context_size integer NOT NULL DEFAULT 0, temperature double precision NOT NULL DEFAULT 1,
  min_p double precision NOT NULL DEFAULT 0, top_p double precision NOT NULL DEFAULT 1, top_k integer NOT NULL DEFAULT 0,
  repeat_penalty double precision NOT NULL DEFAULT 1, reasoning integer NOT NULL DEFAULT 0,
  supports_text integer NOT NULL DEFAULT 1, supports_image integer NOT NULL DEFAULT 0,
  supports_sound integer NOT NULL DEFAULT 0, supports_video integer NOT NULL DEFAULT 0,
  created_at text NOT NULL, updated_at text NOT NULL, UNIQUE(endpoint_id, identifier)
);
CREATE TABLE IF NOT EXISTS organization_inference_services (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint_id text NOT NULL REFERENCES model_endpoints(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, endpoint_id)
);
CREATE TABLE IF NOT EXISTS organization_inference_models (
  organization_id text NOT NULL, endpoint_id text NOT NULL,
  model_id text NOT NULL REFERENCES model_definitions(id) ON DELETE CASCADE,
  active integer NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, endpoint_id, model_id),
  FOREIGN KEY (organization_id, endpoint_id)
    REFERENCES organization_inference_services(organization_id, endpoint_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_execution (
  transaction_key text PRIMARY KEY, request_event_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed')),
  result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS agent_events (
  event_id text PRIMARY KEY, transaction_key text NOT NULL, action text NOT NULL, kind text NOT NULL,
  channel text NOT NULL, source text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_events_transaction_idx ON agent_events (transaction_key, created_at);
