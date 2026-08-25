import { parseChannelServerFrame } from "agent/common";
import { VibeSessionModel, type TurnView, type ToolRun } from "vibeagent_domain/front";
import "./styles.css";

const model = new VibeSessionModel();
const app = document.querySelector<HTMLElement>("#app");
const TOKEN_KEY = "vibe.session.token";

let sessionKey = "";
let replyChannel = "";
let socket: WebSocket | undefined;
let cursor: string | undefined;
let busy = false;
let notice = "";

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function token(): string { return sessionStorage.getItem(TOKEN_KEY) ?? ""; }
function setToken(value: string | undefined): void {
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function api(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(pathname, {
    ...init,
    headers: { "content-type": "application/json", ...(token() ? { authorization: `Bearer ${token()}` } : {}), ...(init.headers ?? {}) },
  });
}

// ---------------------------------------------------------------- render ----

function renderTool(tool: ToolRun): string {
  const status = tool.done
    ? (tool.timedOut ? "timeout" : tool.exitCode === 0 ? "ok" : "fail")
    : "running";
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

function renderWorkspace(snapshot: ReturnType<VibeSessionModel["getSnapshot"]>): string {
  const running = snapshot.turns.some((turn) => turn.phase === "running");
  return `<div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup"><span class="brand-mark" aria-hidden="true">◈</span>
        <div><p class="eyebrow">VIBE CODING</p><h1>Coding agent</h1></div></div>
      <div class="topbar-meta">
        <span class="live-dot ${snapshot.connection}"></span>
        <span data-testid="connection-state">${snapshot.connection}</span>
        <span class="system-chip" data-testid="session-user">${escapeHtml(snapshot.userEmail)}</span>
        <button class="text-button" data-action="logout" data-testid="logout">Sign out</button>
      </div>
    </header>
    <section class="session-strip panel">
      <div><p class="section-kicker">Session</p><strong data-testid="session-key">${escapeHtml(snapshot.sessionKey || "—")}</strong></div>
      <div><span>turns</span><strong data-testid="turn-count">${snapshot.turns.length}</strong></div>
      <div><span>tool</span><strong>bash (separate process)</strong></div>
      <div><a class="text-button" href="/workspace/${encodeURIComponent(snapshot.sessionKey)}/" target="_blank" rel="noopener" data-testid="open-workspace">Open workspace ↗</a></div>
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
  app.innerHTML = token() && sessionKey ? renderWorkspace(model.getSnapshot()) : renderLogin();
}

model.subscribe(render);

// ------------------------------------------------------------- transport ----

function connectStream(): void {
  socket?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  // The token rides the upgrade URL because a browser cannot set headers on a
  // WebSocket handshake. The server rejects the upgrade if it does not verify.
  socket = new WebSocket(`${protocol}//${location.host}/ws?session=${encodeURIComponent(token())}`);
  model.setConnection("connecting");
  socket.onopen = () => {
    model.setConnection("online");
    socket?.send(JSON.stringify({ type: "subscribe", channels: [replyChannel], ...(cursor ? { cursor } : {}) }));
  };
  socket.onerror = () => model.setConnection("offline");
  socket.onclose = () => {
    model.setConnection("offline");
    // The transcript is durable, so a reconnect replays from the cursor rather
    // than losing whatever arrived while the socket was down.
    window.setTimeout(() => { if (sessionKey) connectStream(); }, 1000);
  };
  socket.onmessage = (message) => {
    try {
      const frame = parseChannelServerFrame(JSON.parse(String(message.data)));
      if (!frame) return;
      if (frame.type === "subscribed" || frame.type === "replay") { cursor = frame.cursor; return; }
      if (frame.type !== "event") return;
      cursor = frame.cursor;
      const event = frame.event;
      const payload = event.payload as Record<string, unknown>;
      if (event.kind === "result" || event.kind === "failure") {
        const ok = payload.ok === true;
        const value = payload.value;
        const error = (payload.error as { message?: string } | undefined)?.message ?? "";
        const turnKey = event.transactionKey;
        model.applyTerminal(turnKey, ok, value, error);
        busy = false;
        render();
        return;
      }
      model.applyEvent(event.eventId, event.action, payload);
    } catch { /* a malformed frame is not actionable on the client */ }
  };
}

// ----------------------------------------------------------------- flows ----

async function bootstrap(): Promise<void> {
  if (!token()) { render(); return; }
  const me = await api("/api/vibe/me");
  if (!me.ok) { setToken(undefined); notice = "Session expired. Sign in again."; render(); return; }
  const user = await me.json() as { id: string; email: string };
  await openSession(user.id, user.email);
}

async function openSession(userId: string, email: string): Promise<void> {
  // The key carries its owner, so the socket guard can reject a key minted for
  // another account. Opening a session needs no HTTP round trip: the stream is
  // created by the first event that lands on it.
  sessionKey = `${userId}-${crypto.randomUUID()}`;
  replyChannel = `vibe.${sessionKey}`;
  cursor = undefined;
  model.setIdentity(sessionKey, email);
  connectStream();
  render();
}

async function submitAuth(mode: string, email: string, password: string): Promise<void> {
  notice = "";
  try {
    // Same origin: the gateway forwards to the account service, which is not
    // reachable from a browser.
    const response = await api(`/api/vibe/auth/${mode === "signup" ? "signup" : "login"}`, {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { notice = String(body.error ?? "Request failed."); render(); return; }

    if (mode === "signup") {
      notice = body.status === "active"
        ? "Account created and active. Sign in now."
        : "Account created and waiting for administrator approval.";
      render();
      return;
    }
    setToken(body.sessionToken);
    await openSession(String(body.user?.id ?? ""), String(body.user?.email ?? email));
  } catch (error) {
    notice = error instanceof Error ? error.message : "Request failed.";
    render();
  }
}

/**
 * Submitting a turn is an event on the same socket the results come back on.
 * The server re-stamps identity and ownership, so what is sent here is only a
 * proposal.
 */
function submitTurn(prompt: string): void {
  if (!prompt.trim()) return;
  if (socket?.readyState !== WebSocket.OPEN) { notice = "Not connected. Reconnecting…"; render(); return; }
  const turnKey = crypto.randomUUID();
  busy = true; notice = "";
  model.startTurn(turnKey, prompt);
  socket.send(JSON.stringify({
    type: "event",
    action: "vibe.turn.run",
    transactionKey: turnKey,
    payload: { sessionKey, prompt },
  }));
  render();
}

// ---------------------------------------------------------------- events ----

app?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  if (form.dataset.form === "login") {
    const mode = String((event.submitter as HTMLButtonElement)?.value ?? "login");
    void submitAuth(mode, String(data.get("email") ?? ""), String(data.get("password") ?? ""));
    return;
  }
  if (form.dataset.form === "turn") {
    submitTurn(String(data.get("prompt") ?? ""));
  }
});

app?.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).dataset.action;
  if (action !== "logout") return;
  setToken(undefined);
  sessionKey = ""; replyChannel = ""; socket?.close(); socket = undefined;
  notice = "Signed out.";
  render();
});

render();
void bootstrap();
