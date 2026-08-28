import { useEffect, useRef, useState } from "react";
import { workspaceDisplayName } from "vibeagent_domain/common";
import type { VibeClient } from "vibeagent_domain/front";
import { useModel } from "../model/useModel.js";
import { Transcript } from "./Transcript.js";

/**
 * The composer owns its draft.
 *
 * A half-typed prompt is not domain state — nothing outside this form reads it,
 * and it means nothing once sent. Keeping it here is also what stops a keystroke
 * from reaching the model at all, so typing cannot re-render the transcript.
 */
function Composer({ client, onSent }: { client: VibeClient; onSent: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  // Both subscriptions are taken unconditionally. Folding them into one `&&`
  // short-circuited the second hook the moment the first was false, which is a
  // conditional hook — React counts them per render and refuses.
  const workspace = useModel(client.model.workspace).value;
  const sessionId = useModel(client.sessionId).value;
  const ready = workspace !== "" && sessionId !== "";
  const turns = useModel(client.model.turns).value;
  const running = turns.some((turn) => turn.phase === "running");
  const box = useRef<HTMLTextAreaElement>(null);

  /**
   * The prompts this project offers, if any.
   *
   * Fetched once per project rather than kept in the model: nothing else reads
   * them, they do not change while a session is open, and a failure to fetch
   * them must leave a working composer. An empty list renders nothing at all.
   */
  const [prompts, setPrompts] = useState<Array<{ name: string; title: string; body: string }>>([]);
  useEffect(() => {
    if (!workspace) { setPrompts([]); return; }
    let current = true;
    void client.prompts(workspace)
      .then((found) => { if (current) setPrompts(found); })
      .catch(() => { if (current) setPrompts([]); });
    return () => { current = false; };
  }, [client, workspace]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const turnKey = client.submit(draft);
    if (!turnKey) {
      setNotice(client.isOpen() ? "연결되어 있지 않습니다. 재연결 중…" : "먼저 프로젝트 아래에서 세션을 여세요.");
      return;
    }
    setNotice("");
    setDraft("");
    onSent();
    box.current?.focus();
    // A brand-new session only appears in the list once it has an event.
    window.setTimeout(() => { void client.refreshSessions(); }, 1500);
  };

  return (
    <>
      {notice ? <p className="notice" role="status" data-testid="workspace-notice">{notice}</p> : null}
      {prompts.length ? (
        <div className="prompt-bar" data-testid="prompt-bar">
          <span className="prompt-bar-label">프롬프트</span>
          {prompts.map((prompt) => (
            <button
              key={prompt.name}
              type="button"
              className="chip prompt-chip"
              data-testid="prompt-chip"
              disabled={!ready}
              /**
               * Fills the box and stops there.
               *
               * Deliberately not "send this prompt": what arrives is a starting
               * point, and the person editing it before sending is the point of
               * having them. The cursor is left at the end so typing continues
               * the text rather than replacing it.
               */
              onClick={() => {
                setDraft(prompt.body);
                const field = box.current;
                if (field) {
                  field.focus();
                  window.setTimeout(() => field.setSelectionRange(field.value.length, field.value.length), 0);
                }
              }}
            >{prompt.title}</button>
          ))}
        </div>
      ) : null}
      <form className="composer-bar" onSubmit={submit}>
        <textarea
          ref={box}
          name="prompt"
          rows={3}
          aria-label="Prompt"
          data-testid="prompt-input"
          disabled={!ready}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={ready
            ? "예: index.html에 간단한 계산기 웹페이지를 만들어 줘"
            : "프로젝트 아래에서 세션을 열면 입력할 수 있습니다"}
        />
        <button className="primary-button" type="submit" data-testid="run-turn" disabled={running || !ready}>
          {running ? "실행 중…" : "보내기"}
        </button>
      </form>
    </>
  );
}

/**
 * The conversation surface: which project, the transcript, and the composer.
 *
 * It reads `workspace` for the header and passes the client down. It does not
 * read any turn, so nothing that happens inside a turn re-renders this shell.
 */
export function Conversation({ client }: { client: VibeClient }): React.JSX.Element {
  const workspace = useModel(client.model.workspace).value;
  // Bumped when the reader asks to see the newest thing. The transcript watches
  // it rather than being told imperatively to scroll.
  const [pinnedAt, setPinnedAt] = useState(0);

  return (
    <main className="conversation">
      <header className="conversation-head">
        <div>
          <p className="section-kicker">프로젝트</p>
          <strong data-testid="session-workspace">{workspace ? workspaceDisplayName(workspace) : "—"}</strong>
        </div>
        <div className="head-actions">
          <span className="chip">도구: bash (별도 프로세스)</span>
          {workspace ? (
            <a
              className="text-button"
              href={`/workspace/${workspace.split("/").map(encodeURIComponent).join("/")}/`}
              target="_blank"
              rel="noopener"
              data-testid="open-workspace"
            >산출물 열기 ↗</a>
          ) : null}
        </div>
      </header>

      <Transcript client={client} pinnedAt={pinnedAt} />
      <Composer client={client} onSent={() => setPinnedAt(Date.now())} />
    </main>
  );
}
