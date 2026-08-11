import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuthSettings, LoginResponse, PendingUser, SessionDeviceSummary, SessionSummary, SignupMetadata, SignupResponse, UpdateSettingsRequest, UserSummary } from "../../common/protocol/auth/index.js";
import { hashPassword, verifyPassword } from "./password.js";
import { readSettings, updateSettings } from "../settings/index.js";

type UserRow = { id: string; email: string; password_hash: string; status: UserSummary["status"] };
type SessionRow = { id: string; user_id: string; email: string; created_at: string; last_used_at: string; expires_at: string; metadata_json: string; token_value: string | null; revoked_at: string | null; status: UserSummary["status"] };
function masterEmails(): Set<string> { return new Set((process.env.MASTER_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)); }

function normalizeEmail(email: string): string { const normalized = email.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Invalid email address"); return normalized; }
function parseMetadata(value: string): Record<string, unknown> { const parsed: unknown = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
function filterMatches(metadata: SignupMetadata, filter: Record<string, unknown> | null): boolean { if (!filter) return true; return Object.entries(filter).every(([key, expected]) => JSON.stringify(metadata[key]) === JSON.stringify(expected)); }
function toUserSummary(row: UserRow): UserSummary { return { id: row.id, email: row.email, status: row.status, isMasterAdmin: masterEmails().has(row.email.toLowerCase()) }; }
function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function cleanExpired(database: DatabaseSync, settings: AuthSettings): void { const now = new Date().toISOString(); if (settings.expiredSessionRetentionMode === "none") { database.prepare("DELETE FROM sessions WHERE revoked_at IS NOT NULL OR expires_at <= ?").run(now); return; } if (settings.expiredSessionRetentionSeconds > 0) { const cutoff = new Date(Date.now() - settings.expiredSessionRetentionSeconds * 1000).toISOString(); database.prepare("DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at <= ?) OR expires_at <= ?").run(cutoff, cutoff); } }

export function signup(database: DatabaseSync, email: string, password: string, metadata: SignupMetadata = {}): SignupResponse { if (password.length < 8) throw new Error("Password must contain at least 8 characters"); const normalizedEmail = normalizeEmail(email); const settings = readSettings(database); const accepted = settings.signupAcceptanceMode === "auto" || (settings.signupAcceptanceMode === "filter" && filterMatches(metadata, settings.signupFilter)); const status: UserSummary["status"] = accepted ? "active" : "pending"; const id = randomUUID(); database.prepare("INSERT INTO users (id, email, password_hash, status, signup_metadata_json, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, normalizedEmail, hashPassword(password), status, JSON.stringify(metadata), new Date().toISOString(), accepted ? new Date().toISOString() : null); return { userId: id, status }; }

export function login(database: DatabaseSync, email: string, password: string, metadata: Record<string, unknown> = {}): LoginResponse { const row = database.prepare("SELECT id, email, password_hash, status FROM users WHERE email = ?").get(normalizeEmail(email)) as UserRow | undefined; if (!row || !verifyPassword(password, row.password_hash) || row.status !== "active") throw new Error("Invalid credentials or account is not active"); const settings = readSettings(database); const now = new Date(); const existing = database.prepare("SELECT s.*, u.email, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_used_at DESC LIMIT 1").get(row.id, now.toISOString()) as SessionRow | undefined; const token = existing?.token_value ?? randomBytes(32).toString("base64url"); const sessionId = existing?.id ?? randomUUID(); const expiresAt = new Date(now.getTime() + settings.sessionIdleTimeoutSeconds * 1000).toISOString(); if (existing) { database.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ?, token_value = ?, token_hash = ?, metadata_json = ? WHERE id = ?").run(now.toISOString(), expiresAt, token, tokenHash(token), JSON.stringify(metadata), sessionId); database.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL").run(now.toISOString(), row.id, sessionId); } else { database.prepare("INSERT INTO sessions (id, user_id, token_hash, token_value, created_at, last_used_at, expires_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(sessionId, row.id, tokenHash(token), token, now.toISOString(), now.toISOString(), expiresAt, JSON.stringify(metadata)); } cleanExpired(database, settings); return { sessionToken: token, expiresAt, user: toUserSummary(row) }; }

export function authenticate(database: DatabaseSync, token: string, deviceKey = "unknown-client", label = "Unknown client", request?: { method: string; path: string }): UserSummary {
  const row = database.prepare("SELECT s.*, u.email, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").get(tokenHash(token)) as SessionRow | undefined;
  const now = new Date();
  if (!row || row.revoked_at || row.status !== "active" || new Date(row.expires_at) <= now) {
    if (row) database.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(now.toISOString(), row.id);
    throw new Error("Session expired or invalid");
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const expiresAt = new Date(now.getTime() + readSettings(database).sessionIdleTimeoutSeconds * 1000).toISOString();
    database.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL").run(now.toISOString(), expiresAt, row.id);
    let device = database.prepare("SELECT id FROM session_devices WHERE session_id = ? AND device_key = ?").get(row.id, deviceKey) as { id: string } | undefined;
    if (!device) {
      device = { id: randomUUID() };
      database.prepare("INSERT INTO session_devices (id, session_id, device_key, label, first_seen_at, last_request_at, request_count) VALUES (?, ?, ?, ?, ?, ?, 1)").run(device.id, row.id, deviceKey, label, now.toISOString(), now.toISOString());
    } else {
      database.prepare("UPDATE session_devices SET last_request_at = ?, request_count = request_count + 1, label = ?, revoked_at = NULL WHERE id = ?").run(now.toISOString(), label, device.id);
    }
    if (request) database.prepare("INSERT INTO session_request_logs (id, session_id, device_id, requested_at, method, path) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), row.id, device.id, now.toISOString(), request.method, request.path);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return { id: row.user_id, email: row.email, status: row.status, isMasterAdmin: masterEmails().has(row.email.toLowerCase()) };
}

export function revokeSession(database: DatabaseSync, token: string): void { database.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(new Date().toISOString(), tokenHash(token)); }
export function revokeSessionById(database: DatabaseSync, id: string): void { database.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), id); }
function listDevices(database: DatabaseSync, sessionId: string): SessionDeviceSummary[] { const rows = database.prepare("SELECT id, device_key, label, first_seen_at, last_request_at, request_count, revoked_at FROM session_devices WHERE session_id = ? ORDER BY last_request_at DESC").all(sessionId) as Array<{ id: string; device_key: string; label: string; first_seen_at: string; last_request_at: string; request_count: number; revoked_at: string | null }>; return rows.map((row) => ({ id: row.id, deviceKey: row.device_key, label: row.label, firstSeenAt: row.first_seen_at, lastRequestAt: row.last_request_at, requestCount: row.request_count, revokedAt: row.revoked_at })); }
export function listSessions(database: DatabaseSync): SessionSummary[] { const settings = readSettings(database); cleanExpired(database, settings); const rows = database.prepare("SELECT s.id, s.user_id, u.email, s.created_at, s.last_used_at, s.expires_at, s.metadata_json, s.token_value, s.revoked_at, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_used_at DESC").all(new Date().toISOString()) as SessionRow[]; return rows.map((row) => ({ id: row.id, userId: row.user_id, email: row.email, createdAt: row.created_at, lastUsedAt: row.last_used_at, expiresAt: row.expires_at, metadata: parseMetadata(row.metadata_json), devices: listDevices(database, row.id) })); }
export function listPendingUsers(database: DatabaseSync): PendingUser[] { const rows = database.prepare("SELECT id, email, created_at, signup_metadata_json FROM users WHERE status = 'pending' ORDER BY created_at ASC").all() as Array<{ id: string; email: string; created_at: string; signup_metadata_json: string }>; return rows.map((row) => ({ id: row.id, email: row.email, createdAt: row.created_at, metadata: parseMetadata(row.signup_metadata_json) })); }
export function listUsers(database: DatabaseSync): UserSummary[] { const rows = database.prepare("SELECT id, email, status FROM users WHERE status = 'active' ORDER BY email").all() as UserRow[]; return rows.map(toUserSummary); }
export function setUserStatus(database: DatabaseSync, id: string, status: "active" | "rejected"): void { database.prepare("UPDATE users SET status = ?, approved_at = ? WHERE id = ? AND status = 'pending'").run(status, status === "active" ? new Date().toISOString() : null, id); }
export function getSettings(database: DatabaseSync) { return { settings: readSettings(database), sessions: listSessions(database), pendingUsers: listPendingUsers(database) }; }
export function saveSettings(database: DatabaseSync, input: UpdateSettingsRequest) { return { settings: updateSettings(database, input), sessions: listSessions(database), pendingUsers: listPendingUsers(database) }; }
