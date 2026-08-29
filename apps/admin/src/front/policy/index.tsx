import { useEffect, useMemo, useRef, useState } from "react";
import {
  POLICY_KINDS,
  POLICY_VALUE_FIELDS,
  type PolicyEntry,
  type PolicyKind,
  type PolicyMode,
} from "admin_domain/common";
import { PolicyCommands, groupByKind, type PolicyScope } from "admin_domain/front";
import { Button } from "../components/ui/button";
import type { Texts } from "../i18n";
import { RSC } from "../resource";
import type { OrganizationRequestApi as RequestApi } from "../organization/types";

/**
 * What a deployment gives a session: skills, MCP servers, commands, hooks, and
 * the prompts people start from.
 *
 * One screen for all five because they are one thing with a `kind` — the merge
 * that decides which of them a session sees does not care which it is, and a
 * screen per kind would be five screens differing only in a heading.
 *
 * The form is generated from the fields each kind declares in the protocol, so
 * a sixth kind needs no new form here.
 */
export function PolicyScreen({
  token, request, text, organizations,
}: {
  token: string;
  request: RequestApi;
  text: Texts;
  /** The organisations this actor may manage. Empty means only personal layers. */
  organizations: Array<{ id: string; name: string }>;
}) {
  const [scope, setScope] = useState<PolicyScope>({ layer: "account" });
  const [entries, setEntries] = useState<PolicyEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ kind: PolicyKind; name: string; mode: PolicyMode; enabled: boolean; value: Record<string, string> } | null>(null);

  const words = useRef(text);
  words.current = text;
  const commands = useMemo(
    () => new PolicyCommands(
      (path, options) => request(path, options, token),
      () => ({ failed: words.current[RSC.AUTH_ERROR_ALERT] }),
      (change) => {
        if (change.busy !== undefined) setBusy(change.busy);
        if (change.error !== undefined) setError(change.error);
      },
    ),
    [request, token],
  );

  // Keyed on the scope, so switching layer reloads and nothing else does.
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    let current = true;
    void commands.list(JSON.parse(scopeKey) as PolicyScope).then((found) => { if (current) setEntries(found); });
    return () => { current = false; };
  }, [commands, scopeKey]);

  const reload = async () => setEntries(await commands.list(scope));

  const startDraft = (kind: PolicyKind, existing?: PolicyEntry) => setDraft({
    kind,
    name: existing?.name ?? "",
    mode: existing?.mode ?? "default",
    enabled: existing?.enabled ?? true,
    value: Object.fromEntries(
      POLICY_VALUE_FIELDS[kind].map((field) => [field, String(existing?.value[field] ?? "")]),
    ),
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft?.name.trim()) return;
    if (await commands.save(scope, draft)) { setDraft(null); await reload(); }
  };

  const remove = async (entry: PolicyEntry) => {
    if (!window.confirm(entry.name)) return;
    if (await commands.remove(scope, entry.kind, entry.name)) await reload();
  };

  return (
    <section className="policy-screen" data-testid="policy-screen">
      <header className="policy-head">
        <div>
          <div className="eyebrow">{text[RSC.ADMIN_BADGE_TEXT]}</div>
          <h1>{text[RSC.ADMIN_POLICY_TITLE]}</h1>
          <p>{text[RSC.ADMIN_POLICY_MESSAGE]}</p>
        </div>
        <Button variant="outline" onClick={() => void reload()} disabled={busy}>
          {text[RSC.ADMIN_POLICY_REFRESH_BUTTON]}
        </Button>
      </header>

      {/* The layer being edited. An organisation's entries are policy for
          everyone beneath it; the account's are only this account's. */}
      <div className="policy-scopes" data-testid="policy-scopes">
        <button
          type="button"
          className={`chip ${scope.layer === "account" ? "is-active" : ""}`}
          data-testid="scope-account"
          onClick={() => setScope({ layer: "account" })}
        >{text[RSC.ADMIN_POLICY_SCOPE_ACCOUNT]}</button>
        {organizations.map((organization) => (
          <button
            key={organization.id}
            type="button"
            className={`chip ${scope.layer === "organization" && scope.organizationId === organization.id ? "is-active" : ""}`}
            data-testid="scope-organization"
            onClick={() => setScope({ layer: "organization", organizationId: organization.id })}
          >{organization.name}</button>
        ))}
      </div>

      {error ? <p role="alert" className="error-text">{error}</p> : null}

      <div className="policy-kinds">
        {POLICY_KINDS.map((kind) => {
          const owned = groupByKind(entries).find(([which]) => which === kind)?.[1] ?? [];
          return (
            <section key={kind} className="policy-kind" data-testid="policy-kind" data-kind={kind}>
              <header>
                <h2>{text[RSC[`ADMIN_POLICY_KIND_${kind.toUpperCase()}` as keyof typeof RSC] as RSC] ?? kind}</h2>
                <button type="button" className="text-button" data-testid="policy-add" onClick={() => startDraft(kind)}>
                  {text[RSC.ADMIN_POLICY_ADD_BUTTON]}
                </button>
              </header>
              {owned.length ? (
                <ul>
                  {owned.map((entry) => (
                    <li key={entry.name} data-testid="policy-entry">
                      <span className="policy-name">{entry.name}</span>
                      {entry.mode === "enforced" ? <span className="chip policy-enforced" data-testid="policy-enforced">{text[RSC.ADMIN_POLICY_ENFORCED_LABEL]}</span> : null}
                      {entry.enabled ? null : <span className="chip policy-off" data-testid="policy-disabled">{text[RSC.ADMIN_POLICY_DISABLED_LABEL]}</span>}
                      <button type="button" className="text-button" onClick={() => startDraft(kind, entry)}>{text[RSC.ADMIN_POLICY_EDIT_BUTTON]}</button>
                      <button type="button" className="text-button" data-testid="policy-remove" onClick={() => void remove(entry)}>{text[RSC.ADMIN_POLICY_REMOVE_BUTTON]}</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="policy-empty">{text[RSC.ADMIN_POLICY_EMPTY_TEXT]}</p>}
            </section>
          );
        })}
      </div>

      {draft ? (
        <form className="policy-form" onSubmit={save} data-testid="policy-form">
          <label>
            <span>{text[RSC.ADMIN_POLICY_NAME_LABEL]}</span>
            <input
              data-testid="policy-name-input"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              required
            />
          </label>
          {/* Generated from what the kind declares it carries. */}
          {POLICY_VALUE_FIELDS[draft.kind].map((field) => (
            <label key={field}>
              <span>{field}</span>
              <textarea
                data-testid={`policy-field-${field}`}
                rows={field === "body" ? 6 : 2}
                value={draft.value[field] ?? ""}
                onChange={(event) => setDraft({ ...draft, value: { ...draft.value, [field]: event.target.value } })}
              />
            </label>
          ))}
          <label className="policy-toggle">
            <input
              type="checkbox"
              data-testid="policy-enabled"
              checked={draft.enabled}
              onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
            />
            <span>{text[RSC.ADMIN_POLICY_ENABLED_LABEL]}</span>
          </label>
          {/* Only an organisation may bind something. The control is absent
              rather than disabled on the account layer: an account has no
              enforcement to consider, so offering it would be a question with
              one answer. */}
          {scope.layer === "organization" ? (
            <label className="policy-toggle">
              <input
                type="checkbox"
                data-testid="policy-enforced-input"
                checked={draft.mode === "enforced"}
                onChange={(event) => setDraft({ ...draft, mode: event.target.checked ? "enforced" : "default" })}
              />
              <span>{text[RSC.ADMIN_POLICY_ENFORCE_LABEL]}</span>
            </label>
          ) : null}
          <div className="policy-form-actions">
            <Button type="submit" disabled={busy}>{text[RSC.ADMIN_SAVE_BUTTON]}</Button>
            <button type="button" className="text-button" onClick={() => setDraft(null)}>{text[RSC.ADMIN_POLICY_CANCEL_BUTTON]}</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
