import { useEffect, useMemo, useState } from "react";
import { CornerDownRight, Plus, Trash2 } from "lucide-react";
import { ensureOrganizationModel } from "admin_domain/front";
import {
  parseOrganizationSnapshot,
  parseUsersResponse,
  type Organization,
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

  async function loadOrganizations() {
    setBusy(true);
    setError("");
    try {
      const organizationValue = await request("/api/organizations", {}, token);
      const organizationResult = parseOrganizationSnapshot(organizationValue);
      if (!organizationResult)
        throw new Error(text[RSC.AUTH_ERROR_ALERT]);
      model.snapshot.set(organizationResult);
      if (
        organizationResult.access.nodes.some((node) => node.canManageMembers)
      ) {
        const accountResult = parseUsersResponse(
          await request("/api/organizations/users", {}, token),
        );
        if (!accountResult) throw new Error(text[RSC.AUTH_ERROR_ALERT]);
        model.accounts.set(accountResult.users);
      } else {
        model.accounts.set([]);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT],
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadOrganizations();
  }, [model, token]);

  async function mutate(
    path: string,
    options: RequestInit,
  ): Promise<OrganizationSnapshot | null> {
    setBusy(true);
    setError("");
    try {
      const next = parseOrganizationSnapshot(
        await request(path, options, token),
      );
      if (!next) throw new Error(text[RSC.AUTH_ERROR_ALERT]);
      model.snapshot.set(next);
      return next;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT],
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createOrganization(event: React.FormEvent) {
    event.preventDefault();
    if (!creation || !newName.trim()) return;
    const next = await mutate("/api/organizations", {
      method: "POST",
      body: JSON.stringify({
        name: newName,
        mode: creation.mode,
        parentId: creation.parentId,
      }),
    });
    if (next) {
      setCreation(null);
      setNewName("");
    }
  }

  async function deleteOrganization(organization: Organization) {
    if (!window.confirm(organization.name)) return;
    const next = await mutate(`/api/organizations/${organization.id}`, {
      method: "DELETE",
    });
    if (next && selection === organization.id) model.selection.set(null);
  }

  function openCreation(target: CreationTarget) {
    setCreation(target);
    setNewName("");
  }

  function children(parentId: string | null): Organization[] {
    return snapshot.organizations.filter(
      (organization) => organization.parentId === parentId,
    );
  }

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
        <Button variant="outline" onClick={loadOrganizations} disabled={busy}>
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
