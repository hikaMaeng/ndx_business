import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AuthSettings, LoginResponse, PendingUser, SessionDeviceSummary, SessionSummary, SignupMetadata, SignupResponse, UpdateSettingsRequest, UserSummary } from "../../common/protocol/auth/index.js";
import { hashPassword, verifyPassword } from "./password.js";
import { readSettings, updateSettings } from "../settings/index.js";
import { positional, queries, type AdminDatabase } from "../database/index.js";

type UserRow = { id: string; email: string; password_hash: string; status: UserSummary["status"] };
type SessionRow = { id: string; user_id: string; email: string; created_at: string; last_used_at: string; expires_at: string; metadata_json: unknown; token_value: string | null; revoked_at: string | null; status: UserSummary["status"] };
function masterEmails(): Set<string> { return new Set((process.env.MASTER_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)); }

function normalizeEmail(email: string): string { const normalized = email.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Invalid email address"); return normalized; }

/**
 * Metadata, however the driver hands it over.
 *
 * These columns are `jsonb`, so the driver parses them before this sees them.
 * A string is accepted too: a value stored as text by an older writer survives
 * in a restored dump, and refusing it would lose the metadata.
 */
function parseMetadata(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || value === "") return {};
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}
function filterMatches(metadata: SignupMetadata, filter: Record<string, unknown> | null): boolean { if (!filter) return true; return Object.entries(filter).every(([key, expected]) => JSON.stringify(metadata[key]) === JSON.stringify(expected)); }
function toUserSummary(row: UserRow): UserSummary { return { id: row.id, email: String(row.email), status: row.status, isMasterAdmin: masterEmails().has(String(row.email).toLowerCase()) }; }
function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
async function cleanExpired(database: AdminDatabase, settings: AuthSettings): Promise<void> { const now = new Date().toISOString(); if (settings.expiredSessionRetentionMode === "none") { await queries(database).run("DELETE FROM sessions WHERE revoked_at IS NOT NULL OR expires_at <= ?", now); return; } if (settings.expiredSessionRetentionSeconds > 0) { const cutoff = new Date(Date.now() - settings.expiredSessionRetentionSeconds * 1000).toISOString(); await queries(database).run("DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at <= ?) OR expires_at <= ?", cutoff, cutoff); } }

export async function signup(database: AdminDatabase, email: string, password: string, metadata: SignupMetadata = {}): Promise<SignupResponse> { if (password.length < 8) throw new Error("Password must contain at least 8 characters"); const normalizedEmail = normalizeEmail(email); const settings = await readSettings(database); const accepted = settings.signupAcceptanceMode === "auto" || (settings.signupAcceptanceMode === "filter" && filterMatches(metadata, settings.signupFilter)); const status: UserSummary["status"] = accepted ? "active" : "pending"; const id = randomUUID(); await queries(database).run("INSERT INTO users (id, email, password_hash, status, signup_metadata_json, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, normalizedEmail, hashPassword(password), status, JSON.stringify(metadata), new Date().toISOString(), accepted ? new Date().toISOString() : null); return { userId: id, status }; }

export async function login(database: AdminDatabase, email: string, password: string, metadata: Record<string, unknown> = {}): Promise<LoginResponse> { const ask = queries(database); const row = await ask.get("SELECT id, email, password_hash, status FROM users WHERE email = ?", normalizeEmail(email)) as UserRow | undefined; if (!row || !verifyPassword(password, row.password_hash) || row.status !== "active") throw new Error("Invalid credentials or account is not active"); const settings = await readSettings(database); const now = new Date(); const existing = await ask.get("SELECT s.*, u.email, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_used_at DESC LIMIT 1", row.id, now.toISOString()) as SessionRow | undefined; const token = existing?.token_value ?? randomBytes(32).toString("base64url"); const sessionId = existing?.id ?? randomUUID(); const expiresAt = new Date(now.getTime() + settings.sessionIdleTimeoutSeconds * 1000).toISOString(); if (existing) { await ask.run("UPDATE sessions SET last_used_at = ?, expires_at = ?, token_value = ?, token_hash = ?, metadata_json = ? WHERE id = ?", now.toISOString(), expiresAt, token, tokenHash(token), JSON.stringify(metadata), sessionId); await ask.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL", now.toISOString(), row.id, sessionId); } else { await ask.run("INSERT INTO sessions (id, user_id, token_hash, token_value, created_at, last_used_at, expires_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", sessionId, row.id, tokenHash(token), token, now.toISOString(), now.toISOString(), expiresAt, JSON.stringify(metadata)); } await cleanExpired(database, settings); return { sessionToken: token, expiresAt, user: toUserSummary(row) }; }

export async function authenticate(database: AdminDatabase, token: string, deviceKey = "unknown-client", label = "Unknown client", request?: { method: string; path: string }): Promise<UserSummary> {
  const ask = queries(database);
  const row = await ask.get("SELECT s.*, u.email, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?", tokenHash(token)) as SessionRow | undefined;
  const now = new Date();
  if (!row || row.revoked_at || row.status !== "active" || new Date(row.expires_at) <= now) {
    if (row) await ask.run("UPDATE sessions SET revoked_at = ? WHERE id = ?", now.toISOString(), row.id);
    throw new Error("Session expired or invalid");
  }

  const idleSeconds = (await readSettings(database)).sessionIdleTimeoutSeconds;
  // One connection for the whole thing: sliding the session, recording the
  // device and logging the request either all happened or none did, and a pool
  // does not promise the next statement lands where BEGIN did.
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const expiresAt = new Date(now.getTime() + idleSeconds * 1000).toISOString();
    await client.query(positional("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL"), [now.toISOString(), expiresAt, row.id]);
    const found = await client.query(positional("SELECT id FROM session_devices WHERE session_id = ? AND device_key = ?"), [row.id, deviceKey]);
    let deviceId = found.rows[0] ? String((found.rows[0] as { id: string }).id) : "";
    if (!deviceId) {
      deviceId = randomUUID();
      await client.query(positional("INSERT INTO session_devices (id, session_id, device_key, label, first_seen_at, last_request_at, request_count) VALUES (?, ?, ?, ?, ?, ?, 1)"), [deviceId, row.id, deviceKey, label, now.toISOString(), now.toISOString()]);
    } else {
      await client.query(positional("UPDATE session_devices SET last_request_at = ?, request_count = request_count + 1, label = ?, revoked_at = NULL WHERE id = ?"), [now.toISOString(), label, deviceId]);
    }
    if (request) await client.query(positional("INSERT INTO session_request_logs (id, session_id, device_id, requested_at, method, path) VALUES (?, ?, ?, ?, ?, ?)"), [randomUUID(), row.id, deviceId, now.toISOString(), request.method, request.path]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { id: row.user_id, email: String(row.email), status: row.status, isMasterAdmin: masterEmails().has(String(row.email).toLowerCase()) };
}

export async function revokeSession(database: AdminDatabase, token: string): Promise<void> { await queries(database).run("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL", new Date().toISOString(), tokenHash(token)); }
export async function revokeSessionById(database: AdminDatabase, id: string): Promise<void> { await queries(database).run("UPDATE sessions SET revoked_at = ? WHERE id = ?", new Date().toISOString(), id); }
async function listDevices(database: AdminDatabase, sessionId: string): Promise<SessionDeviceSummary[]> { const rows = await queries(database).all("SELECT id, device_key, label, first_seen_at, last_request_at, request_count, revoked_at FROM session_devices WHERE session_id = ? ORDER BY last_request_at DESC", sessionId) as Array<{ id: string; device_key: string; label: string; first_seen_at: string; last_request_at: string; request_count: number; revoked_at: string | null }>; return rows.map((row) => ({ id: row.id, deviceKey: row.device_key, label: row.label, firstSeenAt: row.first_seen_at, lastRequestAt: row.last_request_at, requestCount: Number(row.request_count), revokedAt: row.revoked_at })); }
export async function listSessions(database: AdminDatabase): Promise<SessionSummary[]> { const settings = await readSettings(database); await cleanExpired(database, settings); const rows = await queries(database).all("SELECT s.id, s.user_id, u.email, s.created_at, s.last_used_at, s.expires_at, s.metadata_json, s.token_value, s.revoked_at, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_used_at DESC", new Date().toISOString()) as SessionRow[]; const summaries: SessionSummary[] = []; for (const row of rows) summaries.push({ id: row.id, userId: row.user_id, email: String(row.email), createdAt: row.created_at, lastUsedAt: row.last_used_at, expiresAt: row.expires_at, metadata: parseMetadata(row.metadata_json), devices: await listDevices(database, row.id) }); return summaries; }
export async function listPendingUsers(database: AdminDatabase): Promise<PendingUser[]> { const rows = await queries(database).all("SELECT id, email, created_at, signup_metadata_json FROM users WHERE status = 'pending' ORDER BY created_at ASC") as Array<{ id: string; email: string; created_at: string; signup_metadata_json: unknown }>; return rows.map((row) => ({ id: row.id, email: String(row.email), createdAt: row.created_at, metadata: parseMetadata(row.signup_metadata_json) })); }
export async function listUsers(database: AdminDatabase): Promise<UserSummary[]> { const rows = await queries(database).all("SELECT id, email, status FROM users WHERE status = 'active' ORDER BY email") as UserRow[]; return rows.map(toUserSummary); }
export async function setUserStatus(database: AdminDatabase, id: string, status: "active" | "rejected"): Promise<void> { await queries(database).run("UPDATE users SET status = ?, approved_at = ? WHERE id = ? AND status = 'pending'", status, status === "active" ? new Date().toISOString() : null, id); }
export async function getSettings(database: AdminDatabase) { return { settings: await readSettings(database), sessions: await listSessions(database), pendingUsers: await listPendingUsers(database) }; }
export async function saveSettings(database: AdminDatabase, input: UpdateSettingsRequest) { return { settings: await updateSettings(database, input), sessions: await listSessions(database), pendingUsers: await listPendingUsers(database) }; }
