import { VibeClient, blocksOf, textOf, type ToolBlock, type TurnBlock, type TurnView, type VibeProject, type VibeSessionListItem } from "vibeagent_domain/front";
import "./styles.css";

/**
 * The screen.
 *
 * It owns no transport and no event interpretation: the library handles the
 * socket, and `VibeClient` turns events into state. This file renders that
 * state and forwards four user intents — sign in, add a project, open a
 * session, run a turn.
 *
 * Projects come first in the sidebar because a session cannot exist without a
 * folder. Creating the session inside a project is how the folder reaches it;
 * nobody types a path at session time, and there is no path at which a session
 * exists without one.
 */
const app = document.querySelector<HTMLElement>("#app");
const TOKEN_KEY = "vibe.session.token";

let notice = "";
let signedIn = false;
// Survives the re-render a failed sign-in causes, so the field is not wiped.
let authEmail = "";
let addingProject = false;
let projectError = "";
const collapsed = new Set<string>();

const token = (): string => sessionStorage.getItem(TOKEN_KEY) ?? "";
const setToken = (value?: string): void => { if (value) sessionStorage.setItem(TOKEN_KEY, value); else sessionStorage.removeItem(TOKEN_KEY); };

const client = new VibeClient({ token, onChange: () => render() });

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function relativeTime(iso: string): string {
  if (!iso) return "";
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

/**
 * A bash call the model asked for.
 *
 * The request and its output are labelled separately on purpose: "the model
 * wanted to run this" and "this is what the machine said back" are different
 * claims, and reading a transcript where they look alike is how people come
 * away believing the agent verified something it only proposed.
 */
function renderTool(tool: ToolBlock, live: boolean): string {
  const status = tool.done ? (tool.timedOut ? "timeout" : tool.exitCode === 0 ? "ok" : "fail") : "running";
  const out = textOf(tool.stdout);
  const err = textOf(tool.stderr);
  const body = [out, err].filter((part) => part.trim()).join("\n");
  return `<section class="block tool" data-testid="tool-run" data-status="${status}">
    <header class="block-head">
      <span class="block-kind kind-tool" data-testid="block-kind">도구 호출</span>
      <span class="tool-badge ${status}" data-testid="tool-status">${status}</span>
      ${tool.done ? `<span class="tool-meta">exit ${tool.exitCode ?? "—"} · ${tool.durationMs}ms</span>` : `<span class="tool-meta">${live ? "실행 중…" : "…"}</span>`}
    </header>
    <code class="tool-command" data-testid="tool-command">${escapeHtml(tool.command)}</code>
    ${body ? `<div class="block-sub"><span class="block-kind kind-output">출력</span></div>
      <pre class="tool-output" data-testid="tool-output">${escapeHtml(body.slice(-4000))}</pre>` : ""}
    ${tool.failure ? `<p class="tool-failure" data-testid="tool-failure">호출 실패: ${escapeHtml(tool.failure)}</p>` : ""}
  </section>`;
}

/**
 * Reasoning is the model talking to itself; a message is it talking to you.
 * Both stream, so both are shown as they arrive — but never as the same thing.
 */
function renderTextBlock(block: Extract<TurnBlock, { kind: "reasoning" | "message" }>, live: boolean): string {
  const text = textOf(block.slices);
  if (!text.trim()) return "";
  const reasoning = block.kind === "reasoning";
  const label = reasoning ? "추론" : "답변";
  const streaming = live ? `<span class="block-live" data-testid="block-live">스트리밍</span>` : "";
  if (!reasoning) {
    return `<section class="block message" data-testid="block-message">
      <header class="block-head"><span class="block-kind kind-message" data-testid="block-kind">${label}</span>${streaming}</header>
      <p class="assistant-note">${escapeHtml(text)}</p>
    </section>`;
  }
  // Open while it is still being written, folded away once it is finished:
  // reasoning is worth watching live and worth hiding afterwards.
  return `<section class="block reasoning" data-testid="block-reasoning">
    <details data-testid="reasoning"${live ? " open" : ""}>
      <summary><span class="block-kind kind-reasoning" data-testid="block-kind">${label}</span><span class="block-note">iteration ${block.iterationIndex}</span>${streaming}</summary>
      <pre>${escapeHtml(text.slice(-6000))}</pre>
    </details>
  </section>`;
}

function renderTurn(turn: TurnView): string {
  const blocks = blocksOf(turn);
  const last = blocks[blocks.length - 1];
  const running = turn.phase === "running";
  return `<article class="turn" data-testid="turn" data-turn-key="${turn.turnKey}" data-phase="${turn.phase}">
    <div class="bubble user"><p>${escapeHtml(turn.prompt)}</p></div>
    <div class="bubble agent">
      <span class="phase-pill ${turn.phase}" data-testid="turn-phase">${turn.phase}</span>
      ${blocks.map((block) => (block.kind === "tool"
        ? renderTool(block, running && !block.done)
        : renderTextBlock(block, running && block === last))).join("")}
      ${turn.answer ? `<div class="answer" data-testid="turn-answer"><span class="block-kind kind-answer">최종 답변</span>${escapeHtml(turn.answer)}</div>` : ""}
      ${turn.error ? `<div class="turn-error" data-testid="turn-error">${escapeHtml(turn.error)}</div>` : ""}
    </div>
  </article>`;
}

function renderSessionItem(item: VibeSessionListItem, active: boolean): string {
  return `<button class="session-item${active ? " active" : ""}" data-session="${escapeHtml(item.sessionId)}" data-testid="session-item" title="${escapeHtml(item.title)}">
    <span class="session-title">${escapeHtml(item.title)}</span>
    <span class="session-meta">턴 ${item.turns} · bash ${item.toolCalls} · ${relativeTime(item.lastActivityAt)}</span>
  </button>`;
}

function renderProject(project: VibeProject, activeSession: string): string {
  const open = !collapsed.has(project.workspace);
  return `<section class="project" data-testid="project" data-workspace="${escapeHtml(project.workspace)}">
    <div class="project-head">
      <button class="project-toggle" data-toggle-project="${escapeHtml(project.workspace)}" data-testid="project-toggle" aria-expanded="${open}">
        <span class="project-caret">${open ? "▾" : "▸"}</span>
        <span class="project-name" data-testid="project-name">${escapeHtml(project.workspace)}</span>
        <span class="project-count">${project.sessions.length}</span>
      </button>
      <button class="project-new" data-new-session="${escapeHtml(project.workspace)}" data-testid="new-session" title="이 프로젝트에 새 세션">＋</button>
    </div>
    ${open ? `<div class="session-list" data-testid="session-list">
      ${project.sessions.length
        ? project.sessions.map((item) => renderSessionItem(item, item.sessionId === activeSession)).join("")
        : `<p class="sidebar-empty">아직 세션이 없습니다. ＋ 로 시작하세요.</p>`}
    </div>` : ""}
  </section>`;
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
  const projects = client.getProjects();
  const running = snapshot.turns.some((turn) => turn.phase === "running");
  const active = client.getSessionId();
  const ready = client.isOpen();
  const empty = !snapshot.turns.length;

  return `<div class="vibe-shell">
    <aside class="sidebar" data-testid="sidebar">
      <div class="sidebar-head">
        <span class="brand-mark" aria-hidden="true">◈</span>
        <strong>Vibe coding</strong>
      </div>

      <div class="project-add">
        ${addingProject
          ? `<form data-form="project" class="project-form">
              <input name="workspace" placeholder="폴더 이름 또는 group/name" aria-label="프로젝트 폴더" data-testid="project-input" autofocus/>
              <div class="project-form-actions">
                <button class="primary-button" type="submit" data-testid="project-create">추가</button>
                <button class="text-button" type="button" data-action="cancel-project">취소</button>
              </div>
              ${projectError ? `<p class="notice" role="status" data-testid="project-error">${escapeHtml(projectError)}</p>` : ""}
            </form>`
          : `<button class="new-session" data-action="add-project" data-testid="add-project">＋ 프로젝트 추가</button>`}
      </div>

      <div class="project-list" data-testid="project-list">
        ${projects.length
          ? projects.map((project) => renderProject(project, active)).join("")
          : `<p class="sidebar-empty">프로젝트가 없습니다. 폴더를 추가하면 그 안에서 세션을 만들 수 있습니다.</p>`}
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
          <p class="section-kicker">프로젝트</p>
          <strong data-testid="session-workspace">${escapeHtml(snapshot.workspace || "—")}</strong>
        </div>
        <div class="head-actions">
          <span class="chip">도구: bash (별도 프로세스)</span>
          ${snapshot.workspace ? `<a class="text-button" href="/workspace/${snapshot.workspace.split("/").map(encodeURIComponent).join("/")}/" target="_blank" rel="noopener" data-testid="open-workspace">산출물 열기 ↗</a>` : ""}
        </div>
      </header>

      <div class="transcript" data-testid="transcript">
        ${snapshot.sessionError ? `<p class="notice" role="status" data-testid="session-error">${escapeHtml(snapshot.sessionError)}</p>` : ""}
        ${client.isLoadingHistory() ? `<p class="loading" data-testid="loading-history">기록을 불러오는 중…</p>` : ""}
        ${empty && !client.isLoadingHistory()
          ? `<div class="empty-state"><span class="empty-orbit">◎</span><h3>${active ? "무엇을 만들까요?" : "프로젝트를 고르세요"}</h3><p>${active ? "에이전트는 bash 하나만으로 작업합니다." : "왼쪽에서 프로젝트를 추가하고 그 안에 세션을 만드세요."}</p></div>`
          : snapshot.turns.map(renderTurn).join("")}
      </div>

      ${notice ? `<p class="notice" role="status" data-testid="workspace-notice">${escapeHtml(notice)}</p>` : ""}
      <form data-form="turn" class="composer-bar">
        <textarea name="prompt" rows="3" aria-label="Prompt" data-testid="prompt-input" ${ready ? "" : "disabled"}
          placeholder="${ready ? "예: index.html에 간단한 계산기 웹페이지를 만들어 줘" : "프로젝트 아래에서 세션을 열면 입력할 수 있습니다"}"></textarea>
        <button class="primary-button" type="submit" data-testid="run-turn" ${running || !ready ? "disabled" : ""}>${running ? "실행 중…" : "보내기"}</button>
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
  await Promise.all([client.refreshProjects(), client.refreshSessions()]);
  // Land on the most recent conversation, the way a chat client would. With no
  // sessions yet there is nothing to open — the person picks a project first.
  const recent = client.getSessions()[0];
  if (recent) await client.openExisting(recent.sessionId);
  else render();
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

  if (form.dataset.form === "project") {
    const workspace = String(data.get("workspace") ?? "");
    void client.addProject(workspace).then((error) => {
      projectError = error ?? "";
      addingProject = Boolean(error);
      render();
    });
    return;
  }

  if (form.dataset.form === "turn") {
    const prompt = String(data.get("prompt") ?? "");
    const turnKey = client.submit(prompt);
    notice = turnKey ? "" : client.isOpen() ? "연결되어 있지 않습니다. 재연결 중…" : "먼저 프로젝트 아래에서 세션을 여세요.";
    render();
    // Clearing has to happen after the render, not before: `submit` shows the
    // turn immediately, which re-renders and carries the typed text onto the
    // new textarea. Resetting the old, detached one would do nothing.
    if (turnKey) {
      const box = app?.querySelector<HTMLTextAreaElement>('[data-testid="prompt-input"]');
      if (box) { box.value = ""; box.focus(); }
    }
    // A brand-new session only appears in the list once it has an event.
    if (turnKey) window.setTimeout(() => { void client.refreshSessions(); }, 1500);
  }
});

app?.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action],[data-session],[data-new-session],[data-toggle-project]");
  if (!target) return;

  if (target.dataset.session) { void client.openExisting(target.dataset.session); return; }

  if (target.dataset.newSession) {
    // The folder comes from the project the session is created under, which is
    // why no path is ever typed here.
    client.openNew(target.dataset.newSession);
    render();
    return;
  }

  if (target.dataset.toggleProject) {
    const key = target.dataset.toggleProject;
    if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
    render();
    return;
  }

  if (target.dataset.action === "add-project") { addingProject = true; projectError = ""; render(); return; }
  if (target.dataset.action === "cancel-project") { addingProject = false; projectError = ""; render(); return; }

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
