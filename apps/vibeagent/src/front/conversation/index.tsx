import { useRef, useState } from "react";
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
          <strong data-testid="session-workspace">{workspace || "—"}</strong>
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
