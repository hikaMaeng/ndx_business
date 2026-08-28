import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { ensureAccountModel } from "admin_domain/front";
import { parseSettingsResponse, type AuthSettings, type PendingUser, type SessionSummary } from "admin_domain/common";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { resolveLanguage, texts } from "../i18n";
import { api, type RequestApi } from "../api";
import { useModel } from "../model/useModel";
import { RSC } from "../resource";

type AccountTab = "approval" | "sessions" | "policy";

export function AccountScreen({ token, request = api }: { token: string; request?: RequestApi }) {
  const text = texts(resolveLanguage());
  const model = useMemo(() => ensureAccountModel(token), [token]);
  const snapshot = useModel(model.snapshot).value;
  const [tab, setTab] = useState<AccountTab>("approval");
  const [filterText, setFilterText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Read through a ref for the same reason as the shell: `texts()` is a new
  // object every render and must not decide when this effect runs.
  const words = useRef(text);
  words.current = text;

  useEffect(() => {
    if (snapshot.status !== "idle") return;
    model.snapshot.mutate((current) => { current.status = "loading"; });
    void request("/api/admin/settings", {}, token).then((value) => {
      const result = parseSettingsResponse(value);
      if (!result) throw new Error(words.current[RSC.AUTH_ERROR_ALERT]);
      model.snapshot.set({ settings: result.settings, sessions: result.sessions, pendingUsers: result.pendingUsers, status: "ready" });
      setFilterText(result.settings.signupFilter ? JSON.stringify(result.settings.signupFilter, null, 2) : "");
    }).catch((reason) => {
      model.snapshot.mutate((current) => { current.status = "failed"; });
      setError(reason instanceof Error ? reason.message : words.current[RSC.AUTH_ERROR_ALERT]);
    });
  }, [model, request, snapshot.status, token]);

  async function save(event: React.FormEvent, draft: AuthSettings = snapshot.settings as AuthSettings) {
    event.preventDefault();
    if (!snapshot.settings) return;
    setError("");
    try {
      const value = await request("/api/admin/settings", { method: "PUT", body: JSON.stringify({ ...draft, signupFilter: filterText.trim() ? JSON.parse(filterText) : null }) }, token);
      const result = parseSettingsResponse(value);
      if (!result) throw new Error(text[RSC.AUTH_ERROR_ALERT]);
      model.snapshot.set({ settings: result.settings, sessions: result.sessions, pendingUsers: result.pendingUsers, status: "ready" });
      setMessage(text[RSC.ADMIN_SAVED_STATUS]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT]);
    }
  }

  async function revoke(id: string) {
    await request(`/api/admin/sessions/${id}`, { method: "DELETE" }, token);
    model.snapshot.mutate((current) => { current.sessions = current.sessions.filter((session) => session.id !== id); });
  }

  async function decide(id: string, decision: "approve" | "reject") {
    await request(`/api/admin/users/${id}/${decision}`, { method: "POST" }, token);
    model.snapshot.mutate((current) => { current.pendingUsers = current.pendingUsers.filter((user) => user.id !== id); });
  }

  const settings = snapshot.settings;
  return <section className="account-panel">
    <div className="account-tabs" role="tablist" aria-label={text[RSC.ADMIN_NAV_ACCOUNTS]}>
      {([["approval", RSC.ADMIN_ACCOUNT_TAB_APPROVAL], ["sessions", RSC.ADMIN_ACCOUNT_TAB_SESSIONS], ["policy", RSC.ADMIN_ACCOUNT_TAB_POLICY]] as const).map(([value, label]) =>
        <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{text[label]}</button>)}
    </div>
    {error && <p role="alert" className="error-text">{error}{snapshot.status === "failed" && <> <button type="button" className="link-button" onClick={() => { setError(""); model.snapshot.mutate((current) => { current.status = "idle"; }); }}>{text[RSC.ADMIN_RETRY_BUTTON]}</button></>}</p>}
    {snapshot.status !== "ready" ? <p role="status">{text[RSC.ADMIN_LOADING_STATUS]}</p> : tab === "policy" && settings ? <PolicyForm settings={settings} filterText={filterText} setFilterText={setFilterText} message={message} onSave={save} text={text} /> : tab === "approval" ? <ApprovalPanel users={snapshot.pendingUsers} onDecision={decide} text={text} /> : <SessionsPanel sessions={snapshot.sessions} onRevoke={revoke} text={text} />}
  </section>;
}

function PolicyForm({ settings, filterText, setFilterText, message, onSave, text }: { settings: AuthSettings; filterText: string; setFilterText: (value: string) => void; message: string; onSave: (event: React.FormEvent, draft: AuthSettings) => void; text: Record<string, string> }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const update = <K extends keyof AuthSettings>(key: K, value: AuthSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return <Card><CardHeader><CardTitle>{text[RSC.ADMIN_POLICY_TITLE_TEXT]}</CardTitle><p>{text[RSC.ADMIN_POLICY_SUBTITLE_TEXT]}</p></CardHeader><CardContent><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave(event, draft); }}>
    <label>{text[RSC.ADMIN_ACCEPTANCE_LABEL]}<select value={draft.signupAcceptanceMode} onChange={(event) => update("signupAcceptanceMode", event.target.value as AuthSettings["signupAcceptanceMode"])}><option value="auto">{text[RSC.ADMIN_AUTO_OPTION]}</option><option value="filter">{text[RSC.ADMIN_FILTER_OPTION]}</option><option value="approval">{text[RSC.ADMIN_APPROVAL_OPTION]}</option></select></label>
    <label>{text[RSC.ADMIN_FILTER_LABEL]}<textarea rows={5} value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder={text[RSC.ADMIN_FILTER_PLACEHOLDER]} /></label>
    <label>{text[RSC.ADMIN_IDLE_LABEL]}<input min={60} type="number" value={draft.sessionIdleTimeoutSeconds} onChange={(event) => update("sessionIdleTimeoutSeconds", Number(event.target.value))}/></label>
    <label>{text[RSC.ADMIN_RETENTION_MODE_LABEL]}<select value={draft.expiredSessionRetentionMode} onChange={(event) => update("expiredSessionRetentionMode", event.target.value as AuthSettings["expiredSessionRetentionMode"])}><option value="none">{text[RSC.ADMIN_RETENTION_NONE_OPTION]}</option><option value="retain">{text[RSC.ADMIN_RETENTION_RETAIN_OPTION]}</option></select></label>
    <label>{text[RSC.ADMIN_RETENTION_SECONDS_LABEL]}<input min={0} type="number" value={draft.expiredSessionRetentionSeconds} onChange={(event) => update("expiredSessionRetentionSeconds", Number(event.target.value))}/></label>
    <label>{text[RSC.ADMIN_SESSION_HEADER_LABEL]}<input value={draft.sessionHeaderName} onChange={(event) => update("sessionHeaderName", event.target.value)}/></label>
    <label>{text[RSC.ADMIN_SESSION_COOKIE_LABEL]}<input value={draft.sessionCookieName} onChange={(event) => update("sessionCookieName", event.target.value)}/></label>
    {message && <p role="status">{message}</p>}<Button type="submit">{text[RSC.ADMIN_SAVE_BUTTON]}</Button>
  </form></CardContent></Card>;
}

function ApprovalPanel({ users, onDecision, text }: { users: PendingUser[]; onDecision: (id: string, decision: "approve" | "reject") => void; text: Record<string, string> }) {
  return <Card><CardHeader><CardTitle>{text[RSC.ADMIN_PENDING_TITLE_TEXT]}</CardTitle><p>{text[RSC.ADMIN_PENDING_SUBTITLE_TEXT]}</p></CardHeader><CardContent><div className="session-list">{users.length === 0 ? <p>{text[RSC.ADMIN_PENDING_EMPTY_MESSAGE]}</p> : users.map((user) => <article className="session-row" key={user.id}><div><strong>{user.email}</strong><code>{JSON.stringify(user.metadata)}</code></div><span className="decision-buttons"><Button size="sm" onClick={() => onDecision(user.id, "approve")}>{text[RSC.ADMIN_APPROVE_BUTTON]}</Button><Button variant="outline" size="sm" onClick={() => onDecision(user.id, "reject")}>{text[RSC.ADMIN_REJECT_BUTTON]}</Button></span></article>)}</div></CardContent></Card>;
}

function SessionsPanel({ sessions, onRevoke, text }: { sessions: SessionSummary[]; onRevoke: (id: string) => void; text: Record<string, string> }) {
  return <Card><CardHeader><CardTitle>{text[RSC.ADMIN_SESSIONS_TITLE_TEXT]}</CardTitle><p>{text[RSC.ADMIN_SESSIONS_SUBTITLE_TEXT]}</p></CardHeader><CardContent><div className="session-list">{sessions.length === 0 ? <p>{text[RSC.ADMIN_SESSIONS_EMPTY_MESSAGE]}</p> : sessions.map((session) => <article className="session-row" key={session.id}><div><strong>{session.email}</strong><span>{text[RSC.ADMIN_LAST_USED_LABEL]} {new Date(session.lastUsedAt).toLocaleString()}</span><span>{text[RSC.ADMIN_EXPIRES_LABEL]} {new Date(session.expiresAt).toLocaleString()}</span><div className="session-devices"><strong>{text[RSC.ADMIN_SESSION_DEVICES_TITLE]}</strong>{session.devices.length === 0 ? <p>{text[RSC.ADMIN_SESSION_DEVICES_EMPTY_MESSAGE]}</p> : session.devices.map((device) => <div className="device-row" key={device.id}><span>{device.label}</span><small>{text[RSC.ADMIN_SESSION_DEVICE_REQUESTS_LABEL]}: {device.requestCount} · {text[RSC.ADMIN_SESSION_DEVICE_LAST_REQUEST_LABEL]}: {new Date(device.lastRequestAt).toLocaleString()}</small></div>)}</div></div><Button variant="outline" size="sm" onClick={() => onRevoke(session.id)}><Trash2 aria-hidden="true" />{text[RSC.ADMIN_REVOKE_BUTTON]}</Button></article>)}</div></CardContent></Card>;
}
