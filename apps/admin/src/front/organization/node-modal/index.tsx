import { useEffect, useMemo, useState } from "react";
import { Trash2, UserRound } from "lucide-react";
import {
  ORGANIZATION_COLORS,
  ORGANIZATION_ICONS,
  parseOrganizationSnapshot,
  organizationInferenceModelPath,
  organizationInferenceServicePath,
  organizationInferenceServicesPath,
  type Organization,
  type OrganizationColor,
  type OrganizationIcon,
  type OrganizationNodePermission,
  type OrganizationSnapshot,
  type UserSummary,
} from "admin_domain/common";
import { Button } from "../../components/ui/button";
import type { Texts } from "../../i18n";
import { OrganizationIconView } from "../icons";
import { RSC } from "../resource";
import type { OrganizationRequestApi } from "../types";

const colorKeys: Record<OrganizationColor, RSC> = {
  slate: RSC.ORGANIZATION_COLOR_SLATE_LABEL,
  blue: RSC.ORGANIZATION_COLOR_BLUE_LABEL,
  cyan: RSC.ORGANIZATION_COLOR_CYAN_LABEL,
  green: RSC.ORGANIZATION_COLOR_GREEN_LABEL,
  amber: RSC.ORGANIZATION_COLOR_AMBER_LABEL,
  rose: RSC.ORGANIZATION_COLOR_ROSE_LABEL,
};

const iconKeys: Record<OrganizationIcon, RSC> = {
  building: RSC.ORGANIZATION_ICON_BUILDING_LABEL,
  briefcase: RSC.ORGANIZATION_ICON_BRIEFCASE_LABEL,
  layers: RSC.ORGANIZATION_ICON_LAYERS_LABEL,
  users: RSC.ORGANIZATION_ICON_USERS_LABEL,
};

export function OrganizationNodeModal({
  token,
  organization,
  permission,
  snapshot,
  accounts,
  request,
  text,
  onSnapshot,
  onClose,
}: {
  token: string;
  organization: Organization;
  permission: OrganizationNodePermission;
  snapshot: OrganizationSnapshot;
  accounts: UserSummary[];
  request: OrganizationRequestApi;
  text: Texts;
  onSnapshot: (snapshot: OrganizationSnapshot) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"info" | "members" | "models">("info");
  const [name, setName] = useState(organization.name);
  const [color, setColor] = useState<OrganizationColor>(organization.color);
  const [icon, setIcon] = useState<OrganizationIcon>(organization.icon);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const members = snapshot.members.filter(
    (member) => member.organizationId === organization.id,
  );
  const inferenceServices = snapshot.inferenceServices.filter(
    (service) => service.organizationId === organization.id,
  );
  const assignedServiceIds = new Set(
    inferenceServices.map((service) => service.endpointId),
  );
  const availableInferenceServices = snapshot.inferenceServiceOptions.filter(
    (service) => !assignedServiceIds.has(service.endpointId),
  );
  const memberIds = useMemo(
    () => new Set(members.map((member) => member.userId)),
    [members],
  );
  const suggestions = query.trim()
    ? accounts
        .filter(
          (account) =>
            account.status === "active" &&
            !memberIds.has(account.id) &&
            account.email.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .slice(0, 6)
    : [];

  useEffect(() => {
    setName(organization.name);
    setColor(organization.color);
    setIcon(organization.icon);
  }, [
    organization.id,
    organization.name,
    organization.color,
    organization.icon,
  ]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function mutate(path: string, options: RequestInit): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const next = parseOrganizationSnapshot(
        await request(path, options, token),
      );
      if (!next) throw new Error(text[RSC.AUTH_ERROR_ALERT]);
      onSnapshot(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : text[RSC.AUTH_ERROR_ALERT],
      );
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function saveInformation(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    try {
      await mutate(`/api/organizations/${organization.id}`, {
        method: "PUT",
        body: JSON.stringify({ name, color, icon }),
      });
      setSaved(true);
    } catch {
      // The shared alert already renders the request error.
    }
  }

  async function addMember(account: UserSummary) {
    try {
      await mutate(`/api/organizations/${organization.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: account.id }),
      });
      setQuery("");
    } catch {
      // The shared alert already renders the request error.
    }
  }

  async function toggleResponsibility(
    userId: string,
    scope: "node" | "subtree",
  ) {
    const active = snapshot.responsibilities.find(
      (item) =>
        item.organizationId === organization.id && item.userId === userId,
    )?.scope;
    try {
      await mutate(
        active === scope
          ? `/api/organizations/${organization.id}/responsibilities/${userId}`
          : `/api/organizations/${organization.id}/responsibilities`,
        active === scope
          ? { method: "DELETE" }
          : { method: "POST", body: JSON.stringify({ userId, scope }) },
      );
    } catch {
      // The shared alert already renders the request error.
    }
  }

  async function removeMember(userId: string) {
    try {
      await mutate(`/api/organizations/${organization.id}/members/${userId}`, {
        method: "DELETE",
      });
    } catch {
      // The shared alert already renders the request error.
    }
  }

  async function addInferenceService(endpointId: string) {
    if (!endpointId) return;
    try {
      await mutate(organizationInferenceServicesPath(organization.id), {
        method: "POST",
        body: JSON.stringify({ endpointId }),
      });
    } catch {
      // The shared alert already renders the request error.
    }
  }

  async function removeInferenceService(endpointId: string) {
    try {
      await mutate(organizationInferenceServicePath(organization.id, endpointId), {
        method: "DELETE",
      });
    } catch {
      // The shared alert already renders the request error.
    }
  }

  async function toggleInferenceModel(
    endpointId: string,
    modelId: string,
    active: boolean,
  ) {
    try {
      await mutate(
        organizationInferenceModelPath(organization.id, endpointId, modelId),
        { method: "PUT", body: JSON.stringify({ active: !active }) },
      );
    } catch {
      // The shared alert already renders the request error.
    }
  }

  return (
    <div
      className="organization-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="organization-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="organization-node-dialog-title"
        data-testid="organization-node-modal"
      >
        <header className="organization-modal-heading">
          <div className="organization-modal-title">
            <span
              className="organization-modal-icon"
              data-color={organization.color}
            >
              <OrganizationIconView icon={organization.icon} />
            </span>
            <div>
              <div className="eyebrow">
                {text[RSC.ORGANIZATION_NODE_DETAIL_TEXT]}
              </div>
              <h2 id="organization-node-dialog-title">{organization.name}</h2>
            </div>
          </div>
          <Button variant="outline" onClick={onClose}>
            {text[RSC.ORGANIZATION_NODE_CLOSE_BUTTON]}
          </Button>
        </header>

        <div
          className="organization-modal-tabs"
          role="tablist"
          aria-label={text[RSC.ORGANIZATION_NODE_DETAIL_TEXT]}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "info"}
            aria-controls="organization-info-panel"
            onClick={() => setTab("info")}
          >
            {text[RSC.ORGANIZATION_NODE_INFO_TAB_BUTTON]}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "members"}
            aria-controls="organization-members-panel"
            onClick={() => setTab("members")}
          >
            <span>{text[RSC.ORGANIZATION_NODE_MEMBERS_TAB_BUTTON]}</span>
            <span className="organization-tab-count">{members.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "models"}
            aria-controls="organization-models-panel"
            onClick={() => setTab("models")}
          >
            {text[RSC.ORGANIZATION_NODE_MODELS_TAB_BUTTON]}
          </button>
        </div>

        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}

        {tab === "info" ? (
          <form
            id="organization-info-panel"
            role="tabpanel"
            className="organization-info-form"
            onSubmit={(event) => {
              if (permission.canUpdate) void saveInformation(event);
              else event.preventDefault();
            }}
          >
            <label>
              {text[RSC.ORGANIZATION_NODE_NAME_LABEL]}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                readOnly={!permission.canUpdate}
                required
              />
            </label>
            <fieldset>
              <legend>{text[RSC.ORGANIZATION_NODE_COLOR_LABEL]}</legend>
              <div className="organization-color-options">
                {permission.canUpdate ? (
                  ORGANIZATION_COLORS.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      className="organization-color-option"
                      data-color={choice}
                      role="radio"
                      aria-checked={color === choice}
                      aria-label={text[colorKeys[choice]]}
                      onClick={() => setColor(choice)}
                    >
                      <span aria-hidden="true" />
                    </button>
                  ))
                ) : (
                  <span
                    className="organization-color-option"
                    data-color={color}
                    aria-label={text[colorKeys[color]]}
                  >
                    <span aria-hidden="true" />
                  </span>
                )}
              </div>
            </fieldset>
            <fieldset>
              <legend>{text[RSC.ORGANIZATION_NODE_ICON_LABEL]}</legend>
              <div className="organization-icon-options">
                {permission.canUpdate ? (
                  ORGANIZATION_ICONS.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      aria-pressed={icon === choice}
                      aria-label={text[iconKeys[choice]]}
                      onClick={() => setIcon(choice)}
                    >
                      <OrganizationIconView icon={choice} />
                    </button>
                  ))
                ) : (
                  <span
                    className="organization-icon-readonly"
                    aria-label={text[iconKeys[icon]]}
                  >
                    <OrganizationIconView icon={icon} />
                  </span>
                )}
              </div>
            </fieldset>
            {permission.canUpdate && (
              <div className="organization-form-footer">
                {saved && (
                  <span role="status">
                    {text[RSC.ORGANIZATION_NODE_SAVED_STATUS]}
                  </span>
                )}
                <Button type="submit" disabled={busy}>
                  {text[RSC.ORGANIZATION_NODE_SAVE_BUTTON]}
                </Button>
              </div>
            )}
          </form>
        ) : tab === "members" ? (
          <div
            id="organization-members-panel"
            role="tabpanel"
            className="organization-members-panel"
          >
            {permission.canManageMembers && (
              <div className="organization-member-search">
              <label htmlFor="organization-member-search">
                {text[RSC.ORGANIZATION_NODE_MEMBER_SEARCH_LABEL]}
              </label>
              <input
                id="organization-member-search"
                value={query}
                autoComplete="off"
                placeholder={
                  text[RSC.ORGANIZATION_NODE_MEMBER_SEARCH_PLACEHOLDER]
                }
                onChange={(event) => setQuery(event.target.value)}
              />
              {query.trim() && (
                <div
                  className="organization-member-suggestions"
                  role="listbox"
                  aria-label={
                    text[RSC.ORGANIZATION_NODE_MEMBER_SUGGESTIONS_LABEL]
                  }
                >
                  {suggestions.length ? (
                    suggestions.map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => addMember(account)}
                        disabled={busy}
                      >
                        <UserRound aria-hidden="true" />
                        <span>{account.email}</span>
                      </button>
                    ))
                  ) : (
                    <p>{text[RSC.ORGANIZATION_NODE_MEMBER_EMPTY_MESSAGE]}</p>
                  )}
                </div>
              )}
              </div>
            )}

            <div className="organization-member-list">
              {members.length ? (
                members.map((member) => {
                  const scope = snapshot.responsibilities.find(
                    (item) =>
                      item.organizationId === organization.id &&
                      item.userId === member.userId,
                  )?.scope;
                  return (
                    <article
                      className="organization-member-row"
                      key={member.userId}
                    >
                      <div className="organization-member-identity">
                        <span aria-hidden="true">
                          {member.email.slice(0, 1).toUpperCase()}
                        </span>
                        <strong>{member.email}</strong>
                      </div>
                      {(permission.canManageMembers || scope) && (
                        <div className="organization-member-actions">
                          {permission.canManageMembers ? (
                            <button
                              type="button"
                              className="organization-permission-toggle"
                              aria-pressed={scope === "node"}
                              onClick={() =>
                                toggleResponsibility(member.userId, "node")
                              }
                              disabled={busy}
                            >
                              {text[RSC.ORGANIZATION_NODE_MEMBER_ADMIN_BUTTON]}
                            </button>
                          ) : (
                            scope === "node" && (
                              <span className="organization-permission-toggle">
                                {
                                  text[
                                    RSC.ORGANIZATION_NODE_MEMBER_ADMIN_BUTTON
                                  ]
                                }
                              </span>
                            )
                          )}
                          {permission.canAssignAdminAll ? (
                            <button
                              type="button"
                              className="organization-permission-toggle"
                              aria-pressed={scope === "subtree"}
                              onClick={() =>
                                toggleResponsibility(member.userId, "subtree")
                              }
                              disabled={busy}
                            >
                              {
                                text[
                                  RSC
                                    .ORGANIZATION_NODE_MEMBER_ADMIN_ALL_BUTTON
                                ]
                              }
                            </button>
                          ) : (
                            scope === "subtree" && (
                              <span className="organization-permission-toggle">
                                {
                                  text[
                                    RSC
                                      .ORGANIZATION_NODE_MEMBER_ADMIN_ALL_BUTTON
                                  ]
                                }
                              </span>
                            )
                          )}
                          {permission.canManageMembers && (
                            <button
                              type="button"
                              className="organization-member-remove"
                              aria-label={
                                text[
                                  RSC.ORGANIZATION_NODE_MEMBER_REMOVE_BUTTON
                                ]
                              }
                              onClick={() => removeMember(member.userId)}
                              disabled={busy}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })
              ) : (
                <p className="organization-member-none">
                  {text[RSC.ORGANIZATION_NODE_MEMBER_NONE_MESSAGE]}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div
            id="organization-models-panel"
            role="tabpanel"
            className="organization-models-panel"
          >
            <label className="organization-inference-service-select">
              {text[RSC.ORGANIZATION_NODE_MODEL_SERVICE_LABEL]}
              <select
                aria-label={text[RSC.ORGANIZATION_NODE_MODEL_SERVICE_LABEL]}
                defaultValue=""
                disabled={!permission.canUpdate || busy}
                onChange={(event) => {
                  void addInferenceService(event.target.value);
                  event.currentTarget.value = "";
                }}
              >
                <option value="">
                  {text[RSC.ORGANIZATION_NODE_MODEL_SERVICE_PLACEHOLDER]}
                </option>
                {availableInferenceServices.map((service) => (
                  <option key={service.endpointId} value={service.endpointId}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
            {inferenceServices.length ? (
              <div className="organization-inference-service-list">
                {inferenceServices.map((service) => (
                  <article
                    className="organization-inference-service"
                    key={service.endpointId}
                  >
                    <header>
                      <h3>{service.name}</h3>
                      {permission.canUpdate && (
                        <button
                          type="button"
                          className="organization-inference-service-remove"
                          aria-label={
                            text[
                              RSC
                                .ORGANIZATION_NODE_MODEL_SERVICE_REMOVE_BUTTON
                            ]
                          }
                          onClick={() =>
                            void removeInferenceService(service.endpointId)
                          }
                          disabled={busy}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      )}
                    </header>
                    {service.models.length ? (
                      <div className="organization-inference-model-list">
                        {service.models.map((model) => (
                          <div
                            className="organization-inference-model"
                            key={model.modelId}
                          >
                            <strong>{model.identifier}</strong>
                            {permission.canUpdate ? (
                              <button
                                type="button"
                                className="organization-model-toggle"
                                aria-pressed={model.active}
                                onClick={() =>
                                  void toggleInferenceModel(
                                    service.endpointId,
                                    model.modelId,
                                    model.active,
                                  )
                                }
                                disabled={busy}
                              >
                                {text[
                                  model.active
                                    ? RSC.ORGANIZATION_NODE_MODEL_ACTIVE_BUTTON
                                    : RSC.ORGANIZATION_NODE_MODEL_INACTIVE_BUTTON
                                ]}
                              </button>
                            ) : (
                              <span
                                className="organization-model-toggle"
                                aria-pressed={model.active}
                              >
                                {text[
                                  model.active
                                    ? RSC.ORGANIZATION_NODE_MODEL_ACTIVE_BUTTON
                                    : RSC.ORGANIZATION_NODE_MODEL_INACTIVE_BUTTON
                                ]}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="organization-model-empty">
                        {text[RSC.ORGANIZATION_NODE_MODEL_EMPTY_MESSAGE]}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="organization-model-empty">
                {text[RSC.ORGANIZATION_NODE_MODEL_EMPTY_MESSAGE]}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
