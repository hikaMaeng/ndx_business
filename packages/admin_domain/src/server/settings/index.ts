import type { AuthSettings, UpdateSettingsRequest } from "../../common/protocol/auth/index.js";
import { queries, type AdminDatabase } from "../database/index.js";

type SettingsRow = {
  signup_acceptance_mode: AuthSettings["signupAcceptanceMode"];
  signup_filter_json: unknown;
  session_idle_timeout_seconds: number;
  expired_session_retention_mode: AuthSettings["expiredSessionRetentionMode"];
  expired_session_retention_seconds: number;
  session_header_name: string;
  session_cookie_name: string;
};

const defaults: AuthSettings = { signupAcceptanceMode: "auto", signupFilter: null, sessionIdleTimeoutSeconds: 3600, expiredSessionRetentionMode: "none", expiredSessionRetentionSeconds: 0, sessionHeaderName: "X-Admin-Session", sessionCookieName: "admin_session" };

/**
 * The filter, however the driver chose to hand it over.
 *
 * The column is `jsonb` and the driver parses it, so this normally arrives as
 * an object. A string is accepted too: a value stored as text by an older
 * writer survives in a restored dump, and refusing it would lose the setting.
 */
function parseFilter(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("signup_filter_json must be an object");
  return parsed as Record<string, unknown>;
}

export async function readSettings(database: AdminDatabase): Promise<AuthSettings> {
  const row = await queries(database).get("SELECT * FROM auth_settings WHERE id = 1") as SettingsRow | undefined;
  if (!row) return defaults;
  return { signupAcceptanceMode: row.signup_acceptance_mode, signupFilter: parseFilter(row.signup_filter_json), sessionIdleTimeoutSeconds: Number(row.session_idle_timeout_seconds), expiredSessionRetentionMode: row.expired_session_retention_mode, expiredSessionRetentionSeconds: Number(row.expired_session_retention_seconds), sessionHeaderName: row.session_header_name || defaults.sessionHeaderName, sessionCookieName: row.session_cookie_name || defaults.sessionCookieName };
}

export async function updateSettings(database: AdminDatabase, input: UpdateSettingsRequest): Promise<AuthSettings> {
  const current = await readSettings(database);
  const next: AuthSettings = { signupAcceptanceMode: input.signupAcceptanceMode ?? current.signupAcceptanceMode, signupFilter: input.signupFilter === undefined ? current.signupFilter : input.signupFilter, sessionIdleTimeoutSeconds: input.sessionIdleTimeoutSeconds ?? current.sessionIdleTimeoutSeconds, expiredSessionRetentionMode: input.expiredSessionRetentionMode ?? current.expiredSessionRetentionMode, expiredSessionRetentionSeconds: input.expiredSessionRetentionSeconds ?? current.expiredSessionRetentionSeconds, sessionHeaderName: input.sessionHeaderName ?? current.sessionHeaderName, sessionCookieName: input.sessionCookieName ?? current.sessionCookieName };
  if (!Number.isInteger(next.sessionIdleTimeoutSeconds) || next.sessionIdleTimeoutSeconds < 60) throw new Error("sessionIdleTimeoutSeconds must be an integer >= 60");
  if (!Number.isInteger(next.expiredSessionRetentionSeconds) || next.expiredSessionRetentionSeconds < 0) throw new Error("expiredSessionRetentionSeconds must be an integer >= 0");
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(next.sessionHeaderName)) throw new Error("sessionHeaderName must be a valid HTTP header name");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(next.sessionCookieName)) throw new Error("sessionCookieName must be a valid cookie name");
  await queries(database).run(
    "UPDATE auth_settings SET signup_acceptance_mode = ?, signup_filter_json = ?, session_idle_timeout_seconds = ?, expired_session_retention_mode = ?, expired_session_retention_seconds = ?, session_header_name = ?, session_cookie_name = ?, updated_at = ? WHERE id = 1",
    next.signupAcceptanceMode,
    next.signupFilter === null ? null : JSON.stringify(next.signupFilter),
    next.sessionIdleTimeoutSeconds,
    next.expiredSessionRetentionMode,
    next.expiredSessionRetentionSeconds,
    next.sessionHeaderName,
    next.sessionCookieName,
    new Date().toISOString(),
  );
  return next;
}
