import type { DatabaseSync } from "node:sqlite";
import type { AuthSettings, UpdateSettingsRequest } from "../../common/protocol/auth/index.js";

type SettingsRow = {
  signup_acceptance_mode: AuthSettings["signupAcceptanceMode"];
  signup_filter_json: string | null;
  session_idle_timeout_seconds: number;
  expired_session_retention_mode: AuthSettings["expiredSessionRetentionMode"];
  expired_session_retention_seconds: number;
  session_header_name: string;
  session_cookie_name: string;
};

const defaults: AuthSettings = { signupAcceptanceMode: "auto", signupFilter: null, sessionIdleTimeoutSeconds: 3600, expiredSessionRetentionMode: "none", expiredSessionRetentionSeconds: 0, sessionHeaderName: "X-Admin-Session", sessionCookieName: "admin_session" };

function parseFilter(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("signup_filter_json must be an object");
  return parsed as Record<string, unknown>;
}

export function readSettings(database: DatabaseSync): AuthSettings {
  const row = database.prepare("SELECT * FROM auth_settings WHERE id = 1").get() as SettingsRow | undefined;
  if (!row) return defaults;
  return { signupAcceptanceMode: row.signup_acceptance_mode, signupFilter: parseFilter(row.signup_filter_json), sessionIdleTimeoutSeconds: row.session_idle_timeout_seconds, expiredSessionRetentionMode: row.expired_session_retention_mode, expiredSessionRetentionSeconds: row.expired_session_retention_seconds, sessionHeaderName: row.session_header_name || defaults.sessionHeaderName, sessionCookieName: row.session_cookie_name || defaults.sessionCookieName };
}

export function updateSettings(database: DatabaseSync, input: UpdateSettingsRequest): AuthSettings {
  const current = readSettings(database);
  const next: AuthSettings = { signupAcceptanceMode: input.signupAcceptanceMode ?? current.signupAcceptanceMode, signupFilter: input.signupFilter === undefined ? current.signupFilter : input.signupFilter, sessionIdleTimeoutSeconds: input.sessionIdleTimeoutSeconds ?? current.sessionIdleTimeoutSeconds, expiredSessionRetentionMode: input.expiredSessionRetentionMode ?? current.expiredSessionRetentionMode, expiredSessionRetentionSeconds: input.expiredSessionRetentionSeconds ?? current.expiredSessionRetentionSeconds, sessionHeaderName: input.sessionHeaderName ?? current.sessionHeaderName, sessionCookieName: input.sessionCookieName ?? current.sessionCookieName };
  if (!Number.isInteger(next.sessionIdleTimeoutSeconds) || next.sessionIdleTimeoutSeconds < 60) throw new Error("sessionIdleTimeoutSeconds must be an integer >= 60");
  if (!Number.isInteger(next.expiredSessionRetentionSeconds) || next.expiredSessionRetentionSeconds < 0) throw new Error("expiredSessionRetentionSeconds must be an integer >= 0");
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(next.sessionHeaderName)) throw new Error("sessionHeaderName must be a valid HTTP header name");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(next.sessionCookieName)) throw new Error("sessionCookieName must be a valid cookie name");
  database.prepare(`UPDATE auth_settings SET signup_acceptance_mode = ?, signup_filter_json = ?, session_idle_timeout_seconds = ?, expired_session_retention_mode = ?, expired_session_retention_seconds = ?, session_header_name = ?, session_cookie_name = ?, updated_at = ? WHERE id = 1`).run(next.signupAcceptanceMode, next.signupFilter === null ? null : JSON.stringify(next.signupFilter), next.sessionIdleTimeoutSeconds, next.expiredSessionRetentionMode, next.expiredSessionRetentionSeconds, next.sessionHeaderName, next.sessionCookieName, new Date().toISOString());
  return next;
}
