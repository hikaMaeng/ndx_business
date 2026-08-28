import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownRight, Plus, Trash2 } from "lucide-react";
import { OrganizationScreenCommands, childrenOf, ensureOrganizationModel } from "admin_domain/front";
import {
  parseOrganizationSnapshot,
  parseUsersResponse,
  type Organization,
  type UserSummary,
  type OrganizationNodePermission,
  type OrganizationSnapshot,
} from "admin_domain/common";
import { Button } from "../components/ui/button";
import { resolveLanguage, texts } from "../i18n";
import { useModel } from "../model/useModel";
import { OrganizationIconView } from "./icons";
import { OrganizationNodeModal } from "./node-modal";
import { RSC } from "./resource";
import type { OrganizationRequestApi } from "./types";

export type { OrganizationRequestApi } from "./types";

type CreationTarget = {
  parentId: string | null;
  mode: "root" | "sibling" | "child";
};

export function OrganizationScreen({
  token,
  request,
}: {
  token: string;
  request: OrganizationRequestApi;
}) {
  const text = texts(resolveLanguage());
  const model = useMemo(() => ensureOrganizationModel(token), [token]);
  const snapshot = useModel(model.snapshot).value;
  const accounts = useModel(model.accounts).value;
  const selection = useModel(model.selection).value;
  const [creation, setCreation] = useState<CreationTarget | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /**
   * Loading and the two writes this screen owns.
   *
   * The words are read through a ref rather than depended on: `texts()` builds
   * a fresh object every render, so listing it would rebuild the commands every
   * render and re-run the load effect for ever. That failure has happened twice
   * in this app already.
   */
  const words = useRef(text);
  words.current = text;
  const commands = useMemo(
    () => new OrganizationScreenCommands(
      (path, options) => request(path, options, token),
      () => ({ failed: words.current[RSC.AUTH_ERROR_ALERT] }),
      (change) => {
        if (change.snapshot) model.snapshot.set(change.snapshot);
        if (change.accounts) model.accounts.set(change.accounts as UserSummary[]);
      },
      (change) => {
        if (change.busy !== undefined) setBusy(change.busy);
        if (change.error !== undefined) setError(change.error);
      },
      parseUsersResponse,
    ),
    [model, request, token],
  );

  useEffect(() => { void commands.load(); }, [commands]);

  // Closing a form and clearing a selection are this screen's business, and
  // they only happen when the command reports it worked.
  async function createOrganization(event: React.FormEvent) {
    event.preventDefault();
    if (!creation || !newName.trim()) return;
    if (await commands.create({ name: newName, mode: creation.mode, parentId: creation.parentId })) {
      setCreation(null);
      setNewName("");
    }
  }

  async function deleteOrganization(organization: Organization) {
    if (!window.confirm(organization.name)) return;
    if (await commands.remove(organization.id) && selection === organization.id) model.selection.set(null);
  }

  function openCreation(target: CreationTarget) {
    setCreation(target);
    setNewName("");
  }

  const children = (parentId: string | null): Organization[] => childrenOf(snapshot, parentId);

  function renderNode(organization: Organization): React.ReactNode {
    const permission =
      snapshot.access.nodes.find(
        (node) => node.organizationId === organization.id,
      ) ?? null;
    const memberCount = snapshot.members.filter(
      (member) => member.organizationId === organization.id,
    ).length;
    return (
      <div className="organization-branch" key={organization.id}>
        <div
          className="organization-node"
          data-color={organization.color}
          role="button"
          aria-label={organization.name}
          tabIndex={0}
          onClick={() => model.selection.set(organization.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ")
              model.selection.set(organization.id);
          }}
        >
          <div className="organization-node-heading">
            <span className="organization-node-icon">
              <OrganizationIconView icon={organization.icon} />
            </span>
            <strong>{organization.name}</strong>
            <span className="organization-node-count">{memberCount}</span>
            {permission &&
              (permission.canCreateSibling ||
                permission.canCreateChild ||
                permission.canDelete) && (
                <span
                  className="organization-node-actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  {permission.canCreateSibling && (
                    <button
                      type="button"
                      aria-label={
                        text[RSC.ORGANIZATION_CREATE_SIBLING_BUTTON]
                      }
                      onClick={() =>
                        openCreation({
                          mode: "sibling",
                          parentId: organization.parentId,
                        })
                      }
                    >
                      <Plus aria-hidden="true" />
                    </button>
                  )}
                  {permission.canCreateChild && (
                    <button
                      type="button"
                      aria-label={text[RSC.ORGANIZATION_CREATE_CHILD_BUTTON]}
                      onClick={() =>
                        openCreation({
                          mode: "child",
                          parentId: organization.id,
                        })
                      }
                    >
                      <CornerDownRight aria-hidden="true" />
                    </button>
                  )}
                  {permission.canDelete && (
                    <button
                      type="button"
                      aria-label={text[RSC.ORGANIZATION_NODE_DELETE_BUTTON]}
                      onClick={() => deleteOrganization(organization)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  )}
                </span>
              )}
          </div>
        </div>
        {children(organization.id).length > 0 && (
          <div className="organization-children">
            {children(organization.id).map(renderNode)}
          </div>
        )}
      </div>
    );
  }

  const selectedOrganization =
    snapshot.organizations.find(
      (organization) => organization.id === selection,
    ) ?? null;
  const selectedPermission: OrganizationNodePermission | null =
    snapshot.access.nodes.find(
      (node) => node.organizationId === selectedOrganization?.id,
    ) ?? null;

  return (
    <div className="organization-panel">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{text[RSC.ADMIN_BADGE_TEXT]}</div>
          <h1>{text[RSC.ADMIN_ORGANIZATIONS_TITLE]}</h1>
          <p>{text[RSC.ADMIN_ORGANIZATIONS_MESSAGE]}</p>
        </div>
        <Button variant="outline" onClick={() => { void commands.load(); }} disabled={busy}>
          {text[RSC.ADMIN_ORGANIZATIONS_REFRESH_BUTTON]}
        </Button>
        {snapshot.access.canCreateRoot && (
          <Button
            variant="outline"
            data-testid="organization-root-create"
            aria-label={text[RSC.ORGANIZATION_CREATE_ROOT_BUTTON]}
            onClick={() => openCreation({ mode: "root", parentId: null })}
          >
            <Plus aria-hidden="true" />
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}

      {creation && (
        <form
          className="organization-inline-create"
          onSubmit={createOrganization}
          data-mode={creation.mode}
        >
          <div>
            <strong>{text[RSC.ORGANIZATION_CREATE_TITLE_TEXT]}</strong>
            <label>
              {text[RSC.ORGANIZATION_CREATE_NAME_LABEL]}
              <input
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                required
              />
            </label>
          </div>
          <Button type="submit" disabled={busy}>
            {text[RSC.ORGANIZATION_CREATE_SAVE_BUTTON]}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCreation(null)}
          >
            {text[RSC.ORGANIZATION_CREATE_CANCEL_BUTTON]}
          </Button>
        </form>
      )}

      <div
        className="organization-tree"
        aria-label={text[RSC.ADMIN_ORGANIZATIONS_TITLE]}
      >
        {snapshot.organizations.length === 0 ? (
          <p>{text[RSC.ADMIN_ORGANIZATIONS_MESSAGE]}</p>
        ) : (
          children(null).map(renderNode)
        )}
      </div>

      {selectedOrganization && selectedPermission && (
        <OrganizationNodeModal
          token={token}
          organization={selectedOrganization}
          permission={selectedPermission}
          snapshot={snapshot}
          accounts={accounts}
          request={request}
          text={text}
          onSnapshot={(next) => model.snapshot.set(next)}
          onClose={() => model.selection.set(null)}
        />
      )}
    </div>
  );
}
