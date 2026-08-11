import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import adminPackage from "../../package.json";
import {
  Building2,
  ChevronDown,
  Globe2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Server,
  ShieldCheck,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { direction, resolveLanguage, texts } from "./i18n";
import { RSC } from "./resource";
import "./styles.css";

const language = resolveLanguage();
const t = texts(language);
const applicationVersion = `v${adminPackage.version}`;
document.documentElement.lang = language;
document.documentElement.dir = direction(language);

type Settings = {
  signupAcceptanceMode: "auto" | "filter" | "approval";
  signupFilter: Record<string, unknown> | null;
  sessionIdleTimeoutSeconds: number;
  expiredSessionRetentionMode: "none" | "retain";
  expiredSessionRetentionSeconds: number;
  sessionHeaderName: string;
  sessionCookieName: string;
};
type SessionDevice = {
  id: string;
  deviceKey: string;
  label: string;
  firstSeenAt: string;
  lastRequestAt: string;
  requestCount: number;
  revokedAt: string | null;
};
type Session = {
  id: string;
  email: string;
  lastUsedAt: string;
  expiresAt: string;
  metadata: Record<string, unknown>;
  devices: SessionDevice[];
};
type PendingUser = {
  id: string;
  email: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};
type Organization = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
};
type OrganizationMember = {
  organizationId: string;
  userId: string;
  email: string;
};
type OrganizationResponsibility = {
  organizationId: string;
  userId: string;
  scope: "node" | "subtree";
  email: string;
};
type OrganizationSnapshot = {
  organizations: Organization[];
  members: OrganizationMember[];
  responsibilities: OrganizationResponsibility[];
};
type Account = {
  id: string;
  email: string;
  status: "active" | "pending" | "rejected";
  isMasterAdmin?: boolean;
};

async function api(path: string, options: RequestInit = {}, token?: string) {
  const deviceKey =
    localStorage.getItem("admin.device") ??
    (() => {
      const value = crypto.randomUUID();
      localStorage.setItem("admin.device", value);
      return value;
    })();
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "content-type": "application/json",
      "X-Session-Device": deviceKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? t[RSC.AUTH_ERROR_ALERT]);
  return payload;
}

function Login({
  onLogin,
  onSignup,
}: {
  onLogin: (token: string) => void;
  onSignup: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onLogin(result.sessionToken);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t[RSC.AUTH_ERROR_ALERT],
      );
    }
  }
  async function signupAccount() {
    try {
      const result = await api("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onSignup(
        result.status === "active"
          ? t[RSC.AUTH_SIGNUP_ACTIVE_STATUS]
          : t[RSC.AUTH_SIGNUP_PENDING_STATUS],
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t[RSC.AUTH_ERROR_ALERT],
      );
    }
  }
  return (
    <main className="auth-layout" aria-labelledby="page-title">
      <Card className="auth-card">
        <CardHeader>
          <div className="eyebrow">
            <KeyRound aria-hidden="true" />
            {t[RSC.AUTH_BADGE_TEXT]}
          </div>
          <CardTitle id="page-title">{t[RSC.AUTH_TITLE_TEXT]}</CardTitle>
          <p>{t[RSC.AUTH_SUBTITLE_TEXT]}</p>
        </CardHeader>
        <CardContent>
          <form className="form-stack" onSubmit={submit}>
            <label>
              {t[RSC.AUTH_EMAIL_LABEL]}
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              {t[RSC.AUTH_PASSWORD_LABEL]}
              <input
                required
                minLength={8}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <Button type="submit">{t[RSC.AUTH_LOGIN_BUTTON]}</Button>
            <Button type="button" variant="outline" onClick={signupAccount}>
              {t[RSC.AUTH_SIGNUP_BUTTON]}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function LanguageSwitcher() {
  const options: Array<[string, RSC]> = [
    ["en", RSC.ADMIN_LANGUAGE_EN],
    ["ko", RSC.ADMIN_LANGUAGE_KO],
    ["zh", RSC.ADMIN_LANGUAGE_ZH],
    ["es", RSC.ADMIN_LANGUAGE_ES],
    ["hi", RSC.ADMIN_LANGUAGE_HI],
    ["ar", RSC.ADMIN_LANGUAGE_AR],
    ["fr", RSC.ADMIN_LANGUAGE_FR],
    ["pt", RSC.ADMIN_LANGUAGE_PT],
  ];
  return (
    <label className="language-switcher">
      <Globe2 aria-hidden="true" />
      <span className="sr-only">{t[RSC.ADMIN_LANGUAGE_LABEL]}</span>
      <select
        aria-label={t[RSC.ADMIN_LANGUAGE_LABEL]}
        value={language}
        onChange={(event) => {
          localStorage.setItem("admin.language", event.target.value);
          window.location.reload();
        }}
      >
        {options.map(([code, key]) => (
          <option key={code} value={code}>
            {t[key]}
          </option>
        ))}
      </select>
    </label>
  );
}

function OrganizationScreen({ token }: { token: string }) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedNode, setSelectedNode] = useState<Organization | null>(null);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<"root" | "sibling" | "child">(
    "root",
  );
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [memberOrganizationId, setMemberOrganizationId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [ownerOrganizationId, setOwnerOrganizationId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerScope, setOwnerScope] = useState<"node" | "subtree">("node");
  const [error, setError] = useState("");
  async function loadOrganizations() {
    try {
      const [organizationResult, accountResult] = await Promise.all([
        api("/api/organizations", {}, token),
        api("/api/admin/users", {}, token),
      ]);
      setSnapshot(organizationResult);
      setAccounts(accountResult.users);
      setMemberOrganizationId(
        (current) => current || organizationResult.organizations[0]?.id || "",
      );
      setOwnerOrganizationId(
        (current) => current || organizationResult.organizations[0]?.id || "",
      );
      setMemberId((current) => current || accountResult.users[0]?.id || "");
      setOwnerId((current) => current || accountResult.users[0]?.id || "");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t[RSC.AUTH_ERROR_ALERT],
      );
    }
  }
  async function createOrganization(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await api(
        "/api/organizations",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            parentId: createMode === "root" ? null : createParentId,
          }),
        },
        token,
      );
      setName("");
      await loadOrganizations();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t[RSC.AUTH_ERROR_ALERT],
      );
    }
  }
  function openCreate(mode: "root" | "sibling" | "child", node?: Organization) {
    setCreateMode(mode);
    setCreateParentId(
      mode === "root"
        ? null
        : mode === "child"
          ? (node?.id ?? null)
          : (node?.parentId ?? null),
    );
    setSelectedNode({
      id: mode === "root" ? "" : (node?.id ?? ""),
      name:
        mode === "root" ? t[RSC.ADMIN_ORGANIZATIONS_TITLE] : (node?.name ?? ""),
      parentId: node?.parentId ?? null,
      createdAt: "",
    });
    setName("");
  }
  async function removeOrganization(organization: Organization) {
    if (!window.confirm(organization.name)) return;
    try {
      await api(
        `/api/organizations/${organization.id}`,
        { method: "DELETE" },
        token,
      );
      await loadOrganizations();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t[RSC.AUTH_ERROR_ALERT],
      );
    }
  }
  async function assignMember(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api(
        `/api/organizations/${memberOrganizationId}/members`,
        { method: "POST", body: JSON.stringify({ userId: memberId }) },
        token,
      );
      await loadOrganizations();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t[RSC.AUTH_ERROR_ALERT],
      );
    }
  }
  async function assignOwner(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api(
        `/api/organizations/${ownerOrganizationId}/responsibilities`,
        {
          method: "POST",
          body: JSON.stringify({ userId: ownerId, scope: ownerScope }),
        },
        token,
      );
      await loadOrganizations();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t[RSC.AUTH_ERROR_ALERT],
      );
    }
  }
  useEffect(() => {
    loadOrganizations();
  }, []);
  function children(parentId: string | null): Organization[] {
    return (
      snapshot?.organizations.filter(
        (organization) => organization.parentId === parentId,
      ) ?? []
    );
  }
  function renderNode(organization: Organization): React.ReactNode {
    const members =
      snapshot?.members.filter(
        (member) => member.organizationId === organization.id,
      ) ?? [];
    const owners =
      snapshot?.responsibilities.filter(
        (responsibility) => responsibility.organizationId === organization.id,
      ) ?? [];
    return (
      <div className="organization-branch" key={organization.id}>
        <div
          className="organization-node"
          role="button"
          tabIndex={0}
          onClick={() => {
            setSelectedNode(organization);
            setMemberOrganizationId(organization.id);
            setOwnerOrganizationId(organization.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") setSelectedNode(organization);
          }}
        >
          <div className="organization-node-heading">
            <Building2 aria-hidden="true" />
            <strong>{organization.name}</strong>
            <span>
              {members.length} · {owners.length}
            </span>
            <span
              className="organization-node-actions"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                aria-label={t[RSC.ORGANIZATION_NODE_CREATE_CHILD_BUTTON]}
                onClick={() => openCreate("sibling", organization)}
              >
                <Plus aria-hidden="true" />
              </button>
              <button
                aria-label={t[RSC.ORGANIZATION_NODE_CREATE_CHILD_BUTTON]}
                onClick={() => openCreate("child", organization)}
              >
                <ChevronDown aria-hidden="true" />
              </button>
              <button
                aria-label={t[RSC.ORGANIZATION_NODE_CLOSE_BUTTON]}
                onClick={() => removeOrganization(organization)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </span>
          </div>
        </div>
        {members.length > 0 && (
          <p className="organization-meta">
            {members.map((member) => member.email).join(", ")}
          </p>
        )}
        {owners.length > 0 && (
          <p className="organization-meta">
            {owners
              .map((owner) => `${owner.email} (${owner.scope})`)
              .join(", ")}
          </p>
        )}
        {children(organization.id).length > 0 && (
          <div className="organization-children">
            {children(organization.id).map((child) => renderNode(child))}
          </div>
        )}
      </div>
    );
  }
  if (!snapshot)
    return (
      <main className="auth-layout">
        <p role="status">{t[RSC.ADMIN_LOADING_STATUS]}</p>
      </main>
    );
  return (
    <div className="organization-panel">
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t[RSC.ADMIN_BADGE_TEXT]}</div>
          <h1>{t[RSC.ADMIN_ORGANIZATIONS_TITLE]}</h1>
          <p>{t[RSC.ADMIN_ORGANIZATIONS_MESSAGE]}</p>
        </div>
        <Button variant="outline" onClick={loadOrganizations}>
          {t[RSC.ADMIN_ORGANIZATIONS_REFRESH_BUTTON]}
        </Button>
        <Button
          variant="outline"
          data-testid="organization-root-create"
          aria-label={t[RSC.ORGANIZATION_NODE_CREATE_CHILD_BUTTON]}
          onClick={() => openCreate("root")}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="organization-actions">
        <Card>
          <CardHeader>
            <CardTitle>{t[RSC.ADMIN_ORGANIZATIONS_TITLE]}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="form-stack" onSubmit={createOrganization}>
              <label>
                {t[RSC.ADMIN_ORGANIZATIONS_TITLE]}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label>
                {t[RSC.ADMIN_ORGANIZATIONS_MESSAGE]}
                <select
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                >
                  <option value="">{t[RSC.ADMIN_NAV_DASHBOARD]}</option>
                  {snapshot.organizations.map((organization) => (
                    <option value={organization.id} key={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit">{t[RSC.ADMIN_SAVE_BUTTON]}</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t[RSC.ADMIN_ACCOUNT_TAB_APPROVAL]}</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedNode && (
              <form className="form-stack" onSubmit={assignMember}>
                <label>
                  {t[RSC.ADMIN_ORGANIZATIONS_TITLE]}
                  <select
                    value={memberOrganizationId}
                    onChange={(event) =>
                      setMemberOrganizationId(event.target.value)
                    }
                  >
                    {snapshot.organizations.map((organization) => (
                      <option value={organization.id} key={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t[RSC.ADMIN_NAV_ACCOUNTS]}
                  <select
                    value={memberId}
                    onChange={(event) => setMemberId(event.target.value)}
                  >
                    {accounts.map((account) => (
                      <option value={account.id} key={account.id}>
                        {account.email}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit">{t[RSC.ADMIN_APPROVE_BUTTON]}</Button>
              </form>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t[RSC.ADMIN_ACCOUNT_TAB_POLICY]}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="form-stack" onSubmit={assignOwner}>
              <label>
                {t[RSC.ADMIN_ORGANIZATIONS_TITLE]}
                <select
                  value={ownerOrganizationId}
                  onChange={(event) =>
                    setOwnerOrganizationId(event.target.value)
                  }
                >
                  {snapshot.organizations.map((organization) => (
                    <option value={organization.id} key={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t[RSC.ADMIN_NAV_ACCOUNTS]}
                <select
                  value={ownerId}
                  onChange={(event) => setOwnerId(event.target.value)}
                >
                  {accounts.map((account) => (
                    <option value={account.id} key={account.id}>
                      {account.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t[RSC.ADMIN_ACCOUNT_TAB_POLICY]}
                <select
                  value={ownerScope}
                  onChange={(event) =>
                    setOwnerScope(event.target.value as "node" | "subtree")
                  }
                >
                  <option value="node">
                    {t[RSC.ORGANIZATION_SCOPE_NODE_OPTION]}
                  </option>
                  <option value="subtree">
                    {t[RSC.ORGANIZATION_SCOPE_SUBTREE_OPTION]}
                  </option>
                </select>
              </label>
              <Button type="submit">{t[RSC.ADMIN_APPROVE_BUTTON]}</Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <div
        className="organization-tree"
        aria-label={t[RSC.ADMIN_ORGANIZATIONS_TITLE]}
      >
        {snapshot.organizations.length === 0 ? (
          <p>{t[RSC.ADMIN_ORGANIZATIONS_MESSAGE]}</p>
        ) : (
          children(null).map((root) => renderNode(root))
        )}
      </div>
      {selectedNode && (
        <div
          className="organization-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedNode(null);
          }}
        >
          <section
            className="organization-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="organization-node-dialog-title"
          >
            <div className="organization-modal-heading">
              <div>
                <div className="eyebrow">
                  {t[RSC.ORGANIZATION_NODE_DETAIL_TEXT]}
                </div>
                <h2 id="organization-node-dialog-title">{selectedNode.name}</h2>
              </div>
              <Button variant="outline" onClick={() => setSelectedNode(null)}>
                {t[RSC.ORGANIZATION_NODE_CLOSE_BUTTON]}
              </Button>
            </div>
            <form
              className="form-stack"
              onSubmit={async (event) => {
                event.preventDefault();
                await createOrganization(event);
                setSelectedNode(null);
              }}
            >
              <label>
                {t[RSC.ORGANIZATION_NODE_CREATE_CHILD_BUTTON]}
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setParentId(selectedNode.id);
                  }}
                  required
                />
              </label>
              <Button type="submit">
                {t[RSC.ORGANIZATION_NODE_CREATE_CHILD_BUTTON]}
              </Button>
            </form>
            {selectedNode.id && (
              <form className="form-stack" onSubmit={assignMember}>
                <label>
                  {t[RSC.ORGANIZATION_NODE_MEMBER_LABEL]}
                  <select
                    value={memberId}
                    onChange={(event) => setMemberId(event.target.value)}
                  >
                    {accounts.map((account) => (
                      <option value={account.id} key={account.id}>
                        {account.email}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit">
                  {t[RSC.ORGANIZATION_NODE_ASSIGN_MEMBER_BUTTON]}
                </Button>
              </form>
            )}
            {selectedNode.id && (
              <form className="form-stack" onSubmit={assignOwner}>
                <label>
                  {t[RSC.ORGANIZATION_NODE_RESPONSIBLE_LABEL]}
                  <select
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                  >
                    {accounts.map((account) => (
                      <option value={account.id} key={account.id}>
                        {account.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t[RSC.ORGANIZATION_NODE_SCOPE_LABEL]}
                  <select
                    value={ownerScope}
                    onChange={(event) =>
                      setOwnerScope(event.target.value as "node" | "subtree")
                    }
                  >
                    <option value="node">
                      {t[RSC.ORGANIZATION_SCOPE_NODE_OPTION]}
                    </option>
                    <option value="subtree">
                      {t[RSC.ORGANIZATION_SCOPE_SUBTREE_OPTION]}
                    </option>
                  </select>
                </label>
                <Button type="submit">
                  {t[RSC.ORGANIZATION_NODE_ASSIGN_RESPONSIBLE_BUTTON]}
                </Button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Admin({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [filterText, setFilterText] = useState("");
  const [message, setMessage] = useState("");
  const [activeView, setActiveView] = useState<
    "dashboard" | "accounts" | "system" | "organizations"
  >("dashboard");
  const [accountTab, setAccountTab] = useState<
    "approval" | "sessions" | "policy"
  >("approval");
  async function load() {
    const result = await api("/api/admin/settings", {}, token);
    setSettings(result.settings);
    setSessions(result.sessions);
    setPendingUsers(result.pendingUsers);
    setFilterText(
      result.settings.signupFilter
        ? JSON.stringify(result.settings.signupFilter, null, 2)
        : "",
    );
  }
  useEffect(() => {
    load().catch(() => onLogout());
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    try {
      const result = await api(
        "/api/admin/settings",
        {
          method: "PUT",
          body: JSON.stringify({
            ...settings,
            signupFilter: filterText.trim() ? JSON.parse(filterText) : null,
          }),
        },
        token,
      );
      setSettings(result.settings);
      setSessions(result.sessions);
      setMessage(t[RSC.ADMIN_SAVED_STATUS]);
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : t[RSC.AUTH_ERROR_ALERT],
      );
    }
  }
  async function revoke(id: string) {
    await api(`/api/admin/sessions/${id}`, { method: "DELETE" }, token);
    setSessions(sessions.filter((session) => session.id !== id));
  }
  async function decide(id: string, decision: "approve" | "reject") {
    await api(`/api/admin/users/${id}/${decision}`, { method: "POST" }, token);
    setPendingUsers(pendingUsers.filter((user) => user.id !== id));
  }
  if (!settings)
    return (
      <main className="auth-layout">
        <p role="status">{t[RSC.ADMIN_LOADING_STATUS]}</p>
      </main>
    );
  const nav = [
    {
      id: "dashboard",
      icon: LayoutDashboard,
      label: t[RSC.ADMIN_NAV_DASHBOARD],
      count: undefined,
    },
    {
      id: "organizations",
      icon: Building2,
      label: t[RSC.ADMIN_NAV_ORGANIZATIONS],
      count: undefined,
    },
    {
      id: "accounts",
      icon: Users,
      label: t[RSC.ADMIN_NAV_ACCOUNTS],
      count: pendingUsers.length,
    },
    {
      id: "system",
      icon: Server,
      label: t[RSC.ADMIN_NAV_SYSTEM],
      count: undefined,
    },
  ] as const;
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark">
            <ShieldCheck aria-hidden="true" />
          </span>
          <span>
            <strong>{t[RSC.ADMIN_BRAND_TEXT]}</strong>
            <small>{applicationVersion}</small>
          </span>
          <LanguageSwitcher />
        </div>
        <p className="admin-nav-label">{t[RSC.ADMIN_NAV_SECTION]}</p>
        <nav aria-label={t[RSC.ADMIN_NAV_SECTION]}>
          {nav.map(({ id, icon: Icon, label, count }) => (
            <button
              className={`admin-nav-item ${activeView === id ? "is-active" : ""}`}
              key={id}
              onClick={() => setActiveView(id)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {count ? <b>{count}</b> : null}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <span className="admin-status-dot" aria-hidden="true" />
          {t[RSC.ADMIN_BADGE_TEXT]}
          <button className="admin-logout" onClick={onLogout}>
            <LogOut aria-hidden="true" />
            {t[RSC.AUTH_LOGOUT_BUTTON]}
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-content">
          {activeView !== "organizations" && (
            <div className="page-heading">
              <div>
                <div className="eyebrow">{t[RSC.ADMIN_BADGE_TEXT]}</div>
                <h1>
                  {activeView === "dashboard"
                    ? t[RSC.ADMIN_OVERVIEW_TITLE]
                    : activeView === "system"
                      ? t[RSC.ADMIN_SYSTEM_TITLE]
                      : t[RSC.ADMIN_NAV_ACCOUNTS]}
                </h1>
              </div>
            </div>
          )}
          {activeView === "dashboard" ? (
            <Card>
              <CardHeader>
                <CardTitle>{t[RSC.ADMIN_OVERVIEW_TITLE]}</CardTitle>
              </CardHeader>
              <CardContent>
                <p>{t[RSC.ADMIN_OVERVIEW_MESSAGE]}</p>
              </CardContent>
            </Card>
          ) : activeView === "system" ? (
            <Card>
              <CardHeader>
                <CardTitle>{t[RSC.ADMIN_SYSTEM_TITLE]}</CardTitle>
              </CardHeader>
              <CardContent>
                <p>{t[RSC.ADMIN_SYSTEM_MESSAGE]}</p>
              </CardContent>
            </Card>
          ) : activeView === "organizations" ? (
            <OrganizationScreen token={token} />
          ) : (
            <>
              {activeView === "accounts" && (
                <div
                  className="account-tabs"
                  role="tablist"
                  aria-label={t[RSC.ADMIN_NAV_ACCOUNTS]}
                >
                  <button
                    role="tab"
                    aria-selected={accountTab === "approval"}
                    className={accountTab === "approval" ? "is-active" : ""}
                    onClick={() => setAccountTab("approval")}
                  >
                    {t[RSC.ADMIN_ACCOUNT_TAB_APPROVAL]}
                  </button>
                  <button
                    role="tab"
                    aria-selected={accountTab === "sessions"}
                    className={accountTab === "sessions" ? "is-active" : ""}
                    onClick={() => setAccountTab("sessions")}
                  >
                    {t[RSC.ADMIN_ACCOUNT_TAB_SESSIONS]}
                  </button>
                  <button
                    role="tab"
                    aria-selected={accountTab === "policy"}
                    className={accountTab === "policy" ? "is-active" : ""}
                    onClick={() => setAccountTab("policy")}
                  >
                    {t[RSC.ADMIN_ACCOUNT_TAB_POLICY]}
                  </button>
                </div>
              )}
              <div className="admin-grid">
                {activeView === "accounts" && accountTab === "policy" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t[RSC.ADMIN_POLICY_TITLE_TEXT]}</CardTitle>
                      <p>{t[RSC.ADMIN_POLICY_SUBTITLE_TEXT]}</p>
                    </CardHeader>
                    <CardContent>
                      <form className="form-stack" onSubmit={save}>
                        <label>
                          {t[RSC.ADMIN_ACCEPTANCE_LABEL]}
                          <select
                            value={settings.signupAcceptanceMode}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                signupAcceptanceMode: event.target
                                  .value as Settings["signupAcceptanceMode"],
                              })
                            }
                          >
                            <option value="auto">
                              {t[RSC.ADMIN_AUTO_OPTION]}
                            </option>
                            <option value="filter">
                              {t[RSC.ADMIN_FILTER_OPTION]}
                            </option>
                            <option value="approval">
                              {t[RSC.ADMIN_APPROVAL_OPTION]}
                            </option>
                          </select>
                        </label>
                        <label>
                          {t[RSC.ADMIN_FILTER_LABEL]}
                          <textarea
                            rows={5}
                            value={filterText}
                            onChange={(event) =>
                              setFilterText(event.target.value)
                            }
                            placeholder={t[RSC.ADMIN_FILTER_PLACEHOLDER]}
                          />
                        </label>
                        <label>
                          {t[RSC.ADMIN_IDLE_LABEL]}
                          <input
                            min={60}
                            type="number"
                            value={settings.sessionIdleTimeoutSeconds}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                sessionIdleTimeoutSeconds: Number(
                                  event.target.value,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          {t[RSC.ADMIN_RETENTION_MODE_LABEL]}
                          <select
                            value={settings.expiredSessionRetentionMode}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                expiredSessionRetentionMode: event.target
                                  .value as Settings["expiredSessionRetentionMode"],
                              })
                            }
                          >
                            <option value="none">
                              {t[RSC.ADMIN_RETENTION_NONE_OPTION]}
                            </option>
                            <option value="retain">
                              {t[RSC.ADMIN_RETENTION_RETAIN_OPTION]}
                            </option>
                          </select>
                        </label>
                        <label>
                          {t[RSC.ADMIN_RETENTION_SECONDS_LABEL]}
                          <input
                            min={0}
                            type="number"
                            value={settings.expiredSessionRetentionSeconds}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                expiredSessionRetentionSeconds: Number(
                                  event.target.value,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          {t[RSC.ADMIN_SESSION_HEADER_LABEL]}
                          <input
                            value={settings.sessionHeaderName}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                sessionHeaderName: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          {t[RSC.ADMIN_SESSION_COOKIE_LABEL]}
                          <input
                            value={settings.sessionCookieName}
                            onChange={(event) =>
                              setSettings({
                                ...settings,
                                sessionCookieName: event.target.value,
                              })
                            }
                          />
                        </label>
                        {message && <p role="status">{message}</p>}
                        <Button type="submit">
                          {t[RSC.ADMIN_SAVE_BUTTON]}
                        </Button>
                      </form>
                    </CardContent>
                  </Card>
                )}
                {activeView === "accounts" && accountTab === "approval" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t[RSC.ADMIN_PENDING_TITLE_TEXT]}</CardTitle>
                      <p>{t[RSC.ADMIN_PENDING_SUBTITLE_TEXT]}</p>
                    </CardHeader>
                    <CardContent>
                      <div className="session-list">
                        {pendingUsers.length === 0 ? (
                          <p>{t[RSC.ADMIN_PENDING_EMPTY_MESSAGE]}</p>
                        ) : (
                          pendingUsers.map((user) => (
                            <article className="session-row" key={user.id}>
                              <div>
                                <strong>{user.email}</strong>
                                <code>{JSON.stringify(user.metadata)}</code>
                              </div>
                              <span className="decision-buttons">
                                <Button
                                  size="sm"
                                  onClick={() => decide(user.id, "approve")}
                                >
                                  {t[RSC.ADMIN_APPROVE_BUTTON]}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => decide(user.id, "reject")}
                                >
                                  {t[RSC.ADMIN_REJECT_BUTTON]}
                                </Button>
                              </span>
                            </article>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {activeView === "accounts" && accountTab === "sessions" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t[RSC.ADMIN_SESSIONS_TITLE_TEXT]}</CardTitle>
                      <p>{t[RSC.ADMIN_SESSIONS_SUBTITLE_TEXT]}</p>
                    </CardHeader>
                    <CardContent>
                      <div className="session-list">
                        {sessions.length === 0 ? (
                          <p>{t[RSC.ADMIN_SESSIONS_EMPTY_MESSAGE]}</p>
                        ) : (
                          sessions.map((session) => (
                            <article className="session-row" key={session.id}>
                              <div>
                                <strong>{session.email}</strong>
                                <span>
                                  {t[RSC.ADMIN_LAST_USED_LABEL]}{" "}
                                  {new Date(
                                    session.lastUsedAt,
                                  ).toLocaleString()}
                                </span>
                                <span>
                                  {t[RSC.ADMIN_EXPIRES_LABEL]}{" "}
                                  {new Date(session.expiresAt).toLocaleString()}
                                </span>
                                <div className="session-devices">
                                  <strong>
                                    {t[RSC.ADMIN_SESSION_DEVICES_TITLE]}
                                  </strong>
                                  {session.devices.length === 0 ? (
                                    <p>
                                      {
                                        t[
                                          RSC
                                            .ADMIN_SESSION_DEVICES_EMPTY_MESSAGE
                                        ]
                                      }
                                    </p>
                                  ) : (
                                    session.devices.map((device) => (
                                      <div
                                        className="device-row"
                                        key={device.id}
                                      >
                                        <span>{device.label}</span>
                                        <small>
                                          {
                                            t[
                                              RSC
                                                .ADMIN_SESSION_DEVICE_REQUESTS_LABEL
                                            ]
                                          }
                                          : {device.requestCount} ·{" "}
                                          {
                                            t[
                                              RSC
                                                .ADMIN_SESSION_DEVICE_LAST_REQUEST_LABEL
                                            ]
                                          }
                                          :{" "}
                                          {new Date(
                                            device.lastRequestAt,
                                          ).toLocaleString()}
                                        </small>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => revoke(session.id)}
                              >
                                <Trash2 aria-hidden="true" />
                                {t[RSC.ADMIN_REVOKE_BUTTON]}
                              </Button>
                            </article>
                          ))
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem("admin.session") ?? "",
  );
  if (!token)
    return (
      <Login
        onLogin={(value) => {
          sessionStorage.setItem("admin.session", value);
          setToken(value);
        }}
        onSignup={(message) => window.alert(message)}
      />
    );
  return (
    <Admin
      token={token}
      onLogout={() => {
        sessionStorage.removeItem("admin.session");
        setToken("");
      }}
    />
  );
}
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
