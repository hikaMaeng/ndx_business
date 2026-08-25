import { VibeClient, type TurnView, type ToolRun, type VibeSessionListItem } from "vibeagent_domain/front";
import "./styles.css";

/**
 * The screen.
 *
 * It owns no transport and no event interpretation: the library handles the
 * socket, and `VibeClient` turns events into state. This file renders that
 * state and forwards three user intents — sign in, pick a session, run a turn.
 */
const app = document.querySelector<HTMLElement>("#app");
const TOKEN_KEY = "vibe.session.token";

let notice = "";
let signedIn = false;
// Survives the re-render a failed sign-in causes, so the field is not wiped.
let authEmail = "";

const token = (): string => sessionStorage.getItem(TOKEN_KEY) ?? "";
const setToken = (value?: string): void => { if (value) sessionStorage.setItem(TOKEN_KEY, value); else sessionStorage.removeItem(TOKEN_KEY); };

const client = new VibeClient({ token, onChange: () => render() });

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "방금";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}

/**
 * The account service answers in English, and deliberately does not say which
 * half was wrong — that ambiguity is an anti-enumeration measure, so the
 * translation keeps it.
 */
function authErrorText(raw: string): string {
  if (/invalid credentials|not active/i.test(raw)) return "이메일 또는 비밀번호가 맞지 않거나, 아직 활성화되지 않은 계정입니다.";
  if (/already|exists|registered/i.test(raw)) return "이미 등록된 이메일입니다. 로그인하세요.";
  return raw || "요청이 실패했습니다.";
}

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
    <div class="bubble user"><p>${escapeHtml(turn.prompt)}</p></div>
    <div class="bubble agent">
      <span class="phase-pill ${turn.phase}" data-testid="turn-phase">${turn.phase}</span>
      ${turn.reasoning.length ? `<details class="reasoning"><summary>사고 과정 (${turn.reasoning.length})</summary><pre>${escapeHtml(turn.reasoning.join("\n\n").slice(-6000))}</pre></details>` : ""}
      ${turn.tools.map(renderTool).join("")}
      ${turn.messages.map((message) => `<p class="assistant-note">${escapeHtml(message)}</p>`).join("")}
      ${turn.answer ? `<div class="answer" data-testid="turn-answer">${escapeHtml(turn.answer)}</div>` : ""}
      ${turn.error ? `<div class="turn-error" data-testid="turn-error">${escapeHtml(turn.error)}</div>` : ""}
    </div>
  </article>`;
}

function renderSessionItem(item: VibeSessionListItem, active: boolean): string {
  return `<button class="session-item${active ? " active" : ""}" data-session="${item.sessionId}" data-testid="session-item" title="${escapeHtml(item.title)}">
    <span class="session-title">${escapeHtml(item.title)}</span>
    <span class="session-meta">턴 ${item.turns} · bash ${item.toolCalls} · ${relativeTime(item.lastActivityAt)}</span>
  </button>`;
}

function renderLogin(): string {
  return `<main class="auth-shell">
    <section class="auth-card panel">
      <h1>Vibe coding</h1>
      <p class="auth-copy">계정으로 로그인하세요. 신규 계정은 관리자의 가입 정책에 따라 즉시 활성화되거나 승인을 기다립니다.</p>
      ${notice ? `<p class="notice" role="status" data-testid="auth-notice">${escapeHtml(notice)}</p>` : ""}
      <form data-form="login" class="auth-form">
        <label>이메일<input name="email" type="email" autocomplete="username" required aria-label="Email" value="${escapeHtml(authEmail)}"/></label>
        <label>비밀번호<input name="password" type="password" autocomplete="current-password" required aria-label="Password"/></label>
        <div class="auth-actions">
          <button class="primary-button" type="submit" name="mode" value="login" data-testid="login-submit">로그인</button>
          <button class="secondary-button" type="submit" name="mode" value="signup" data-testid="signup-submit">계정 만들기</button>
        </div>
      </form>
    </section>
  </main>`;
}

function renderWorkspace(): string {
  const snapshot = client.model.getSnapshot();
  const sessions = client.getSessions();
  const running = snapshot.turns.some((turn) => turn.phase === "running");
  const active = client.getSessionId();
  const empty = !snapshot.turns.length;

  return `<div class="vibe-shell">
    <aside class="sidebar" data-testid="sidebar">
      <div class="sidebar-head">
        <span class="brand-mark" aria-hidden="true">◈</span>
        <strong>Vibe coding</strong>
      </div>
      <button class="new-session" data-action="new-session" data-testid="new-session">＋ 새 세션</button>
      <div class="session-list" data-testid="session-list">
        ${sessions.length ? sessions.map((item) => renderSessionItem(item, item.sessionId === active)).join("")
          : `<p class="sidebar-empty">아직 세션이 없습니다.</p>`}
      </div>
      <div class="sidebar-foot">
        <span class="live-dot ${client.getConnection()}"></span>
        <span data-testid="connection-state">${client.getConnection()}</span>
        <span class="who" data-testid="session-user">${escapeHtml(snapshot.userEmail)}</span>
        <button class="text-button" data-action="logout" data-testid="logout">로그아웃</button>
      </div>
    </aside>

    <main class="conversation">
      <header class="conversation-head">
        <div>
          <p class="section-kicker">세션</p>
          <strong data-testid="session-key">${escapeHtml(active || "—")}</strong>
        </div>
        <div class="head-actions">
          <span class="chip">도구: bash (별도 프로세스)</span>
          ${active ? `<a class="text-button" href="/workspace/${encodeURIComponent(active)}/" target="_blank" rel="noopener" data-testid="open-workspace">산출물 열기 ↗</a>` : ""}
        </div>
      </header>

      <div class="transcript" data-testid="transcript">
        ${client.isLoadingHistory() ? `<p class="loading" data-testid="loading-history">기록을 불러오는 중…</p>` : ""}
        ${empty && !client.isLoadingHistory()
          ? `<div class="empty-state"><span class="empty-orbit">◎</span><h3>무엇을 만들까요?</h3><p>에이전트는 bash 하나만으로 작업합니다.</p></div>`
          : snapshot.turns.map(renderTurn).join("")}
      </div>

      ${notice ? `<p class="notice" role="status" data-testid="workspace-notice">${escapeHtml(notice)}</p>` : ""}
      <form data-form="turn" class="composer-bar">
        <textarea name="prompt" rows="3" aria-label="Prompt" data-testid="prompt-input" placeholder="예: index.html에 간단한 계산기 웹페이지를 만들어 줘"></textarea>
        <button class="primary-button" type="submit" data-testid="run-turn" ${running ? "disabled" : ""}>${running ? "실행 중…" : "보내기"}</button>
      </form>
    </main>
  </div>`;
}

function render(): void {
  if (!app) return;
  const focused = document.activeElement as HTMLTextAreaElement | null;
  const keepPrompt = focused?.dataset?.testid === "prompt-input" ? focused.value : undefined;
  app.innerHTML = token() && signedIn ? renderWorkspace() : renderLogin();
  if (keepPrompt !== undefined) {
    const box = app.querySelector<HTMLTextAreaElement>('[data-testid="prompt-input"]');
    if (box) { box.value = keepPrompt; box.focus(); }
  }
}

// ----------------------------------------------------------------- flows ----

async function enter(userId: string, email: string): Promise<void> {
  signedIn = true;
  authEmail = "";
  client.setIdentity(userId, email);
  await client.refreshSessions();
  const sessions = client.getSessions();
  // Land on the most recent conversation, the way a chat client would.
  if (sessions.length) await client.openExisting(sessions[0]!.sessionId);
  else client.openNew();
}

async function bootstrap(): Promise<void> {
  if (!token()) { render(); return; }
  const me = await api("/api/auth/me");
  if (!me.ok) { setToken(undefined); notice = "세션이 만료되었습니다. 다시 로그인하세요."; render(); return; }
  const user = await me.json() as { id: string; email: string };
  await enter(user.id, user.email);
}

async function submitAuth(mode: string, email: string, password: string): Promise<void> {
  notice = "";
  authEmail = email;
  try {
    // Same origin: the broker forwards to the account service, which a browser
    // cannot reach directly.
    const response = await api(`/api/auth/${mode === "signup" ? "signup" : "login"}`, { method: "POST", body: JSON.stringify({ email, password }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      notice = authErrorText(String(body.error ?? ""));
      render();
      // Retyping the email after a typo in the password is pure friction.
      app?.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
      return;
    }
    if (mode === "signup") {
      notice = body.status === "active" ? "계정이 만들어졌습니다. 로그인하세요." : "계정이 만들어졌고 관리자 승인을 기다립니다.";
      render();
      return;
    }
    setToken(body.sessionToken);
    await enter(String(body.user?.id ?? ""), String(body.user?.email ?? email));
  } catch (error) {
    notice = error instanceof Error ? error.message : "요청이 실패했습니다.";
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
    const prompt = String(data.get("prompt") ?? "");
    const turnKey = client.submit(prompt);
    notice = turnKey ? "" : "연결되어 있지 않습니다. 재연결 중…";
    if (turnKey) form.reset();
    render();
    // A brand-new session only appears in the list once it has an event.
    if (turnKey) window.setTimeout(() => { void client.refreshSessions(); }, 1500);
  }
});

app?.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action],[data-session]");
  if (!target) return;
  if (target.dataset.session) { void client.openExisting(target.dataset.session); return; }
  if (target.dataset.action === "new-session") { client.openNew(); render(); return; }
  if (target.dataset.action === "logout") {
    setToken(undefined);
    signedIn = false;
    client.close();
    notice = "로그아웃되었습니다.";
    render();
  }
});

// Ctrl/Cmd+Enter sends, the way every chat client does.
app?.addEventListener("keydown", (event) => {
  const key = event as KeyboardEvent;
  if (key.key !== "Enter" || !(key.metaKey || key.ctrlKey)) return;
  const box = (key.target as HTMLElement).closest<HTMLTextAreaElement>('[data-testid="prompt-input"]');
  if (!box) return;
  key.preventDefault();
  box.form?.requestSubmit();
});

render();
void bootstrap();
