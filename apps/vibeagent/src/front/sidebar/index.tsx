import { workspaceDisplayName } from "vibeagent_domain/common";
import { useState } from "react";
import type { VibeClient, VibeProject, VibeSessionListItem } from "vibeagent_domain/front";
import { useModel } from "../model/useModel.js";

function relativeTime(iso: string): string {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "방금";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간 전`;
  return `${Math.floor(seconds / 86400)}일 전`;
}

function SessionRow({ item, active, onOpen }: { item: VibeSessionListItem; active: boolean; onOpen: (id: string) => void }): React.JSX.Element {
  return (
    <button
      className={`session-item${active ? " active" : ""}`}
      data-session={item.sessionId}
      data-testid="session-item"
      title={item.title}
      onClick={() => onOpen(item.sessionId)}
    >
      <span className="session-title">{item.title}</span>
      <span className="session-meta">턴 {item.turns} · bash {item.toolCalls} · {relativeTime(item.lastActivityAt)}</span>
    </button>
  );
}

/**
 * A project row owns whether it is expanded.
 *
 * Collapsing one project is not a fact about the session or the app, and
 * nothing else reads it, so it stays here. Keeping it in a shared set higher up
 * would make every row re-render whenever any row was toggled.
 */
function Project({ project, activeSession, onOpen, onNewSession }: {
  project: VibeProject;
  activeSession: string;
  onOpen: (id: string) => void;
  onNewSession: (workspace: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(true);

  return (
    <section className="project" data-testid="project" data-workspace={project.workspace}>
      <div className="project-head">
        <button
          className="project-toggle"
          data-toggle-project={project.workspace}
          data-testid="project-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="project-caret">{open ? "▾" : "▸"}</span>
          <span className="project-name" data-testid="project-name">{workspaceDisplayName(project.workspace)}</span>
          <span className="project-count">{project.sessions.length}</span>
        </button>
        <button
          className="project-new"
          data-new-session={project.workspace}
          data-testid="new-session"
          title="이 프로젝트에 새 세션"
          onClick={() => onNewSession(project.workspace)}
        >＋</button>
      </div>
      {open ? (
        <div className="session-list" data-testid="session-list">
          {project.sessions.length
            ? project.sessions.map((item) => (
                <SessionRow key={item.sessionId} item={item} active={item.sessionId === activeSession} onOpen={onOpen} />
              ))
            : <p className="sidebar-empty">아직 세션이 없습니다. ＋ 로 시작하세요.</p>}
        </div>
      ) : null}
    </section>
  );
}

/** Adding a project owns its own form, including the error the typist must read. */
function AddProject({ client }: { client: VibeClient }): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  if (!adding) {
    return (
      <button className="new-session" data-testid="add-project" onClick={() => { setAdding(true); setError(""); }}>
        ＋ 프로젝트 추가
      </button>
    );
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get("workspace");
    void client.addProject(String(input ?? "")).then((failure) => {
      setError(failure ?? "");
      setAdding(Boolean(failure));
    });
  };

  return (
    <form className="project-form" onSubmit={submit}>
      <input name="workspace" placeholder="폴더 이름 또는 group/name" aria-label="프로젝트 폴더" data-testid="project-input" autoFocus />
      <div className="project-form-actions">
        <button className="primary-button" type="submit" data-testid="project-create">추가</button>
        <button className="text-button" type="button" onClick={() => { setAdding(false); setError(""); }}>취소</button>
      </div>
      {error ? <p className="notice" role="status" data-testid="project-error">{error}</p> : null}
    </form>
  );
}

/**
 * Projects first, sessions under them.
 *
 * A session cannot exist without a folder, and creating it inside a project is
 * how the folder reaches it — nobody types a path at session time.
 *
 * This subscribes to the session list, the folder list and the open session id.
 * It does not subscribe to any turn, which is the point: a streamed token used
 * to rebuild all of this, and it was eighty five percent of every repaint.
 */
export function Sidebar({ client, onLogout }: { client: VibeClient; onLogout: () => void }): React.JSX.Element {
  useModel(client.sessions);
  useModel(client.folders);
  const active = useModel(client.sessionId).value;
  const connection = useModel(client.connection).value;
  const email = useModel(client.model.identity).value.userEmail;
  const projects = client.getProjects();

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="sidebar-head">
        <span className="brand-mark" aria-hidden="true">◈</span>
        <strong>Vibe coding</strong>
      </div>

      <div className="project-add"><AddProject client={client} /></div>

      <div className="project-list" data-testid="project-list">
        {projects.length
          ? projects.map((project) => (
              <Project
                key={project.workspace}
                project={project}
                activeSession={active}
                onOpen={(id) => { void client.openExisting(id); }}
                onNewSession={(workspace) => { client.openNew(workspace); }}
              />
            ))
          : <p className="sidebar-empty">프로젝트가 없습니다. 폴더를 추가하면 그 안에서 세션을 만들 수 있습니다.</p>}
      </div>

      <div className="sidebar-foot">
        <span className={`live-dot ${connection}`} />
        <span data-testid="connection-state">{connection}</span>
        <span className="who" data-testid="session-user">{email}</span>
        <button className="text-button" data-testid="logout" onClick={onLogout}>로그아웃</button>
      </div>
    </aside>
  );
}
