import { VibeClient, type TurnView, type ToolRun } from "vibeagent_domain/front";
import "./styles.css";

/**
 * The screen.
 *
 * It owns no transport and no event interpretation: the library handles the
 * socket, and `VibeClient` turns events into state. This file renders that
 * state and forwards two user intents — sign in, and run a turn.
 */
const app = document.querySelector<HTMLElement>("#app");
const TOKEN_KEY = "vibe.session.token";

let notice = "";
let busy = false;

const token = (): string => sessionStorage.getItem(TOKEN_KEY) ?? "";
const setToken = (value?: string): void => { if (value) sessionStorage.setItem(TOKEN_KEY, value); else sessionStorage.removeItem(TOKEN_KEY); };

const client = new VibeClient({ token, onChange: () => render() });

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function api(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(pathname, { ...init, headers: { "content-type": "application/json", ...(token() ? { authorization: `Bearer ${token()}` } : {}), ...(init.headers ?? {}) } });
}

// ---------------------------------------------------------------- render ----

function renderTool(tool: ToolRun): string {
  const status = tool.done ? (tool.timedOut ? "timeout" : tool.exitCode === 0 ? "ok" : "fail") : "running";
  const body = [tool.stdout, tool.stderr].filter((part) => part.trim()).join("\n");
  return `<div class="tool" data-testid="tool-run" data-status="${status}">
    <div class="tool-head">
      <span class="tool-badge ${status}" data-testid="tool-status">${status}</span>
      <code class="tool-command" data-testid="tool-command">${escapeHtml(tool.command)}</code>
      ${tool.done ? `<span class="tool-meta">exit ${tool.exitCode ?? "—"} · ${tool.durationMs}ms</span>` : `<span class="tool-meta">…</span>`}
    </div>
    ${body ? `<pre class="tool-output" data-testid="tool-output">${escapeHtml(body.slice(-4000))}</pre>` : ""}
  </div>`;
}

function renderTurn(turn: TurnView): string {
  return `<article class="turn" data-testid="turn" data-turn-key="${turn.turnKey}" data-phase="${turn.phase}">
    <header class="turn-head">
      <span class="phase-pill ${turn.phase}" data-testid="turn-phase">${turn.phase}</span>
      <p class="turn-prompt">${escapeHtml(turn.prompt)}</p>
    </header>
    ${turn.reasoning.length ? `<details class="reasoning"><summary>reasoning (${turn.reasoning.length})</summary><pre>${escapeHtml(turn.reasoning.join("\n\n").slice(-6000))}</pre></details>` : ""}
    ${turn.tools.map(renderTool).join("")}
    ${turn.messages.map((message) => `<p class="assistant-note">${escapeHtml(message)}</p>`).join("")}
    ${turn.answer ? `<div class="answer" data-testid="turn-answer">${escapeHtml(turn.answer)}</div>` : ""}
    ${turn.error ? `<div class="turn-error" data-testid="turn-error">${escapeHtml(turn.error)}</div>` : ""}
  </article>`;
}

function renderLogin(): string {
  return `<main class="auth-shell">
    <section class="auth-card panel">
      <h1>Vibe coding</h1>
      <p class="auth-copy">Sign in with your account. New accounts follow the administrator's signup policy — they may be active immediately or wait for approval.</p>
      ${notice ? `<p class="notice" role="status" data-testid="auth-notice">${escapeHtml(notice)}</p>` : ""}
      <form data-form="login" class="auth-form">
        <label>Email<input name="email" type="email" autocomplete="username" required aria-label="Email"/></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required aria-label="Password"/></label>
        <div class="auth-actions">
          <button class="primary-button" type="submit" name="mode" value="login" data-testid="login-submit">Sign in</button>
          <button class="secondary-button" type="submit" name="mode" value="signup" data-testid="signup-submit">Create account</button>
        </div>
      </form>
    </section>
  </main>`;
}

function renderWorkspace(): string {
  const snapshot = client.model.getSnapshot();
  const running = snapshot.turns.some((turn) => turn.phase === "running");
  return `<div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup"><span class="brand-mark" aria-hidden="true">◈</span>
        <div><p class="eyebrow">VIBE CODING</p><h1>Coding agent</h1></div></div>
      <div class="topbar-meta">
        <span class="live-dot ${client.getConnection()}"></span>
        <span data-testid="connection-state">${client.getConnection()}</span>
        <span class="system-chip" data-testid="session-user">${escapeHtml(snapshot.userEmail)}</span>
        <button class="text-button" data-action="logout" data-testid="logout">Sign out</button>
      </div>
    </header>
    <section class="session-strip panel">
      <div><p class="section-kicker">Session</p><strong data-testid="session-key">${escapeHtml(snapshot.sessionId || "—")}</strong></div>
      <div><span>turns</span><strong data-testid="turn-count">${snapshot.turns.length}</strong></div>
      <div><span>tool</span><strong>bash (separate process)</strong></div>
      <div><a class="text-button" href="/workspace/${encodeURIComponent(snapshot.sessionId)}/" target="_blank" rel="noopener" data-testid="open-workspace">Open workspace ↗</a></div>
    </section>
    <main class="workspace">
      <section class="stream-column">
        <div class="stream-header"><div><p class="section-kicker">TRANSCRIPT</p><h2>Turns</h2></div></div>
        <div class="timeline panel" data-testid="transcript">
          ${snapshot.turns.length ? snapshot.turns.map(renderTurn).join("") : `<div class="empty-state"><span class="empty-orbit">◎</span><h3>No turns yet</h3><p>Describe what you want built. The agent works only through bash.</p></div>`}
        </div>
      </section>
      <aside class="composer panel">
        <div class="panel-heading"><div><p class="section-kicker">NEW TURN</p><h2>Ask the agent</h2></div></div>
        ${notice ? `<p class="notice" role="status" data-testid="workspace-notice">${escapeHtml(notice)}</p>` : ""}
        <form data-form="turn" class="event-form">
          <label>Prompt<textarea name="prompt" rows="10" aria-label="Prompt" data-testid="prompt-input" placeholder="Build a simple calculator web page in index.html"></textarea></label>
          <div class="form-footer">
            <span class="key-hint">${running ? "a turn is running" : "ready"}</span>
            <button class="primary-button" type="submit" data-testid="run-turn" ${busy || running ? "disabled" : ""}>Run turn</button>
          </div>
        </form>
      </aside>
    </main>
  </div>`;
}

function render(): void {
  if (!app) return;
  app.innerHTML = token() && client.getSessionId() ? renderWorkspace() : renderLogin();
}

// ----------------------------------------------------------------- flows ----

async function bootstrap(): Promise<void> {
  if (!token()) { render(); return; }
  const me = await api("/api/auth/me");
  if (!me.ok) { setToken(undefined); notice = "Session expired. Sign in again."; render(); return; }
  const user = await me.json() as { id: string; email: string };
  client.open(user.id, user.email);
}

async function submitAuth(mode: string, email: string, password: string): Promise<void> {
  notice = "";
  try {
    // Same origin: the broker forwards to the account service, which a browser
    // cannot reach directly.
    const response = await api(`/api/auth/${mode === "signup" ? "signup" : "login"}`, { method: "POST", body: JSON.stringify({ email, password }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { notice = String(body.error ?? "Request failed."); render(); return; }
    if (mode === "signup") {
      notice = body.status === "active" ? "Account created and active. Sign in now." : "Account created and waiting for administrator approval.";
      render();
      return;
    }
    setToken(body.sessionToken);
    client.open(String(body.user?.id ?? ""), String(body.user?.email ?? email));
  } catch (error) {
    notice = error instanceof Error ? error.message : "Request failed.";
    render();
  }
}

// ---------------------------------------------------------------- events ----

app?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  if (form.dataset.form === "login") {
    void submitAuth(String((event.submitter as HTMLButtonElement)?.value ?? "login"), String(data.get("email") ?? ""), String(data.get("password") ?? ""));
    return;
  }
  if (form.dataset.form === "turn") {
    busy = true;
    const turnKey = client.submit(String(data.get("prompt") ?? ""));
    busy = false;
    if (!turnKey) notice = "Not connected. Reconnecting…";
    render();
  }
});

app?.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).dataset.action !== "logout") return;
  setToken(undefined);
  client.close();
  notice = "Signed out.";
  render();
});

render();
void bootstrap();
