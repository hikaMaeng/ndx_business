import { useCallback, useEffect, useRef, useState } from "react";
import type { PolicyScope } from "admin_domain/front";
import { Button } from "../components/ui/button";
import type { Texts } from "../i18n";
import { RSC } from "../resource";
import type { OrganizationRequestApi as RequestApi } from "../organization/types";

interface BundleFile {
  path: string;
  bytes: number;
  editable: boolean;
}

const query = (scope: PolicyScope): string =>
  scope.layer === "organization" ? `?organizationId=${encodeURIComponent(scope.organizationId)}`
  : scope.layer === "project" ? `?projectId=${encodeURIComponent(scope.projectId)}`
  : "";

/**
 * A skill's files, browsed and edited in place.
 *
 * The policy row says a skill exists and what it is for; this is what it is
 * made of. Together on one screen because they are two views of one thing, and
 * a person who has just written the row is the person who wants to see whether
 * `SKILL.md` says what they think it says.
 *
 * Editing is by content, not by extension: whatever the skill is made of, if it
 * is text it opens. A skill may be a shell script, a Makefile, a Rust file or
 * something nobody here has thought of, and a list of blessed extensions would
 * show every one of those and open only the ones we guessed.
 */
export function SkillFiles({
  token, request, text, scope, name, onClose,
}: {
  token: string;
  request: RequestApi;
  text: Texts;
  scope: PolicyScope;
  name: string;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<BundleFile[]>([]);
  const [open, setOpen] = useState<string>("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  const suffix = query(scope);
  const base = `/api/skills/${encodeURIComponent(name)}`;

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError("");
    try { return await work(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null; }
    finally { setBusy(false); }
  }, []);

  const load = useCallback(async () => {
    const answer = await run(() => request(`${base}/files${suffix}`, undefined, token)) as { files?: BundleFile[] } | null;
    setFiles(answer?.files ?? []);
  }, [base, request, run, suffix, token]);

  useEffect(() => { void load(); }, [load]);

  const openFile = async (file: BundleFile) => {
    if (!file.editable) return;
    const answer = await run(() => request(
      `${base}/file${suffix ? `${suffix}&` : "?"}path=${encodeURIComponent(file.path)}`, undefined, token,
    )) as { content?: string } | null;
    if (answer) { setOpen(file.path); setContent(answer.content ?? ""); setSaved(false); }
  };

  const save = async () => {
    const answer = await run(() => request(`${base}/file${suffix}`, {
      method: "PUT",
      body: JSON.stringify({ path: open, content }),
    }, token)) as { files?: BundleFile[] } | null;
    if (answer) { setFiles(answer.files ?? files); setSaved(true); }
  };

  /**
   * The upload.
   *
   * Read here and sent as base64 rather than as a multipart form: this admin
   * speaks JSON everywhere else, and a second body format exists mainly to be
   * the one nobody remembers to bound.
   */
  const upload = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 8192) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    }
    const answer = await run(() => request(`${base}/bundle${suffix}`, {
      method: "POST",
      body: JSON.stringify({ archive: btoa(binary) }),
    }, token)) as { files?: BundleFile[] } | null;
    // A new upload replaces the folder, so whatever was open is a file from a
    // version that no longer exists.
    if (answer) { setFiles(answer.files ?? []); setOpen(""); setContent(""); }
  };

  const remove = async () => {
    if (!window.confirm(`${text[RSC.ADMIN_SKILL_DELETE_CONFIRM]}\n\n${name}`)) return;
    if (await run(() => request(`${base}/bundle${suffix}`, { method: "DELETE" }, token))) {
      setFiles([]); setOpen(""); setContent("");
    }
  };

  return (
    <section className="skill-files" data-testid="skill-files" aria-label={text[RSC.ADMIN_SKILL_FILES_TITLE]}>
      <header className="skill-files-head">
        <h3>{name}</h3>
        <div className="skill-files-actions">
          <input
            ref={picker}
            type="file"
            accept=".zip,application/zip"
            data-testid="skill-upload-input"
            hidden
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (chosen) void upload(chosen);
            }}
          />
          <Button variant="outline" data-testid="skill-upload" disabled={busy} onClick={() => picker.current?.click()}>
            {busy ? text[RSC.ADMIN_SKILL_UPLOADING_TEXT] : text[RSC.ADMIN_SKILL_UPLOAD_BUTTON]}
          </Button>
          {files.length ? (
            <button type="button" className="text-button" data-testid="skill-delete" onClick={() => void remove()}>
              {text[RSC.ADMIN_SKILL_DELETE_BUTTON]}
            </button>
          ) : null}
          <button type="button" className="text-button" data-testid="skill-close" onClick={onClose}>
            {text[RSC.ADMIN_SKILL_CLOSE_BUTTON]}
          </button>
        </div>
      </header>

      {error ? <p role="alert" className="error-text">{error}</p> : null}

      <div className={`skill-files-body ${files.length ? "" : "is-single"}`}>
        {files.length ? (
          <ul className="skill-file-list" data-testid="skill-file-list">
            {files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={`skill-file ${open === file.path ? "is-active" : ""}`}
                  data-testid="skill-file"
                  data-path={file.path}
                  disabled={!file.editable}
                  onClick={() => void openFile(file)}
                >
                  <span className="skill-file-path">{file.path}</span>
                  <span className="skill-file-meta">
                    {file.editable ? `${file.bytes}B` : text[RSC.ADMIN_SKILL_BINARY_LABEL]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="policy-empty" data-testid="skill-files-empty">{text[RSC.ADMIN_SKILL_EMPTY_TEXT]}</p>}

        {/* Which file is open is stated on the element, not implied by what the
            box happens to contain: a reader arriving mid-load — a person or a
            test — can otherwise only guess whether the text belongs to the file
            the list is highlighting. */}
        {open ? (
          <div className="skill-editor" data-testid="skill-editor" data-path={open}>
            <label>
              <span>{open}</span>
              <textarea
                data-testid="skill-editor-input"
                rows={18}
                spellCheck={false}
                value={content}
                onChange={(event) => { setContent(event.target.value); setSaved(false); }}
              />
            </label>
            <div className="policy-form-actions">
              <Button data-testid="skill-save" disabled={busy} onClick={() => void save()}>{text[RSC.ADMIN_SKILL_SAVE_BUTTON]}</Button>
              {saved ? <span className="skill-saved" data-testid="skill-saved">{text[RSC.ADMIN_SKILL_SAVED_TEXT]}</span> : null}
            </div>
          </div>
        ) : files.length ? (
          <p className="skill-editor-hint" data-testid="skill-editor-hint">{text[RSC.ADMIN_SKILL_SELECT_HINT]}</p>
        ) : null}
      </div>
    </section>
  );
}
