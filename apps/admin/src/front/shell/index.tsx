import { useEffect, useRef, useState } from "react";
import { Building2, Boxes, Globe2, LayoutDashboard, LogOut, Server, ShieldCheck, Sparkles, Users } from "lucide-react";
import adminPackage from "../../../package.json";
import { parseUserSummary, type UserSummary } from "admin_domain/common";
import { api } from "../api";
import { AccountScreen } from "../account";
import { DashboardScreen } from "../dashboard";
import { ModelsScreen } from "../models";
import { OrganizationScreen } from "../organization";
import { PolicyScreen } from "../policy";
import { direction, resolveLanguage, texts } from "../i18n";
import { RSC } from "../resource";
import { SystemScreen } from "../system";

type View = "dashboard" | "accounts" | "system" | "organizations" | "models" | "policy";

function LanguageSwitcher({ text, language }: { text: Record<string, string>; language: string }) {
  const options: Array<[string, RSC]> = [["en", RSC.ADMIN_LANGUAGE_EN], ["ko", RSC.ADMIN_LANGUAGE_KO], ["zh", RSC.ADMIN_LANGUAGE_ZH], ["es", RSC.ADMIN_LANGUAGE_ES], ["hi", RSC.ADMIN_LANGUAGE_HI], ["ar", RSC.ADMIN_LANGUAGE_AR], ["fr", RSC.ADMIN_LANGUAGE_FR], ["pt", RSC.ADMIN_LANGUAGE_PT]];
  return <label className="language-switcher"><Globe2 aria-hidden="true" /><span className="sr-only">{text[RSC.ADMIN_LANGUAGE_LABEL]}</span><select aria-label={text[RSC.ADMIN_LANGUAGE_LABEL]} value={language} onChange={(event) => { localStorage.setItem("admin.language", event.target.value); window.location.reload(); }}>{options.map(([code, key]) => <option key={code} value={code}>{text[key]}</option>)}</select></label>;
}

export function AdminShell({ token, onLogout }: { token: string; onLogout: () => void }) {
  const language = resolveLanguage();
  const text = texts(language);
  const [currentUser, setCurrentUser] = useState<UserSummary | null>(null);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const isMasterAdmin = Boolean(currentUser?.isMasterAdmin);

  /**
   * The words are read at call time, not depended on.
   *
   * `texts()` builds a fresh object on every render, so listing it here made
   * this effect re-run after its own `setCurrentUser` — which rendered, which
   * built new words, which re-ran the effect. It called `/api/auth/me` about
   * thirty-seven times a second for as long as the page stayed open, and
   * nothing about it looked wrong on screen.
   */
  const words = useRef(text);
  words.current = text;

  useEffect(() => {
    api("/api/auth/me", {}, token).then((value) => {
      const user = parseUserSummary(value);
      if (!user) throw new Error(words.current[RSC.AUTH_ERROR_ALERT]);
      setCurrentUser(user);
    }).catch(onLogout);
  }, [onLogout, token]);

  useEffect(() => {
    if (!isMasterAdmin && (activeView === "accounts" || activeView === "system" || activeView === "models")) setActiveView("dashboard");
  }, [activeView, isMasterAdmin]);

  if (!currentUser) return <main className="auth-layout" aria-busy="true" />;

  const nav: Array<{ id: View; icon: typeof LayoutDashboard; label: string }> = [
    { id: "dashboard", icon: LayoutDashboard, label: text[RSC.ADMIN_NAV_DASHBOARD] },
    ...(isMasterAdmin ? [{ id: "accounts" as const, icon: Users, label: text[RSC.ADMIN_NAV_ACCOUNTS] }] : []),
    { id: "organizations", icon: Building2, label: text[RSC.ADMIN_NAV_ORGANIZATIONS] },
    // Available to everybody: the account layer is a person's own, and needs no
    // authority beyond being signed in.
    { id: "policy", icon: Sparkles, label: text[RSC.ADMIN_NAV_POLICY] },
    ...(isMasterAdmin ? [{ id: "models" as const, icon: Boxes, label: text[RSC.ADMIN_NAV_MODELS] }, { id: "system" as const, icon: Server, label: text[RSC.ADMIN_NAV_SYSTEM] }] : []),
  ];

  return <div className="admin-shell" data-testid="admin-shell">
    <aside className="admin-sidebar"><div className="admin-brand"><span className="admin-brand-mark"><ShieldCheck aria-hidden="true" /></span><span><strong>{text[RSC.ADMIN_BRAND_TEXT]}</strong><small>v{adminPackage.version}</small></span><LanguageSwitcher text={text} language={language} /></div><p className="admin-nav-label">{text[RSC.ADMIN_NAV_SECTION]}</p><nav aria-label={text[RSC.ADMIN_NAV_SECTION]}>{nav.map(({ id, icon: Icon, label }) => <button className={`admin-nav-item ${activeView === id ? "is-active" : ""}`} data-testid={`nav-${id}`} key={id} onClick={() => setActiveView(id)}><Icon aria-hidden="true" /><span>{label}</span></button>)}</nav><div className="admin-sidebar-footer"><span className="admin-status-dot" aria-hidden="true" />{text[RSC.ADMIN_BADGE_TEXT]}<button className="admin-logout" onClick={onLogout}><LogOut aria-hidden="true" />{text[RSC.AUTH_LOGOUT_BUTTON]}</button></div></aside>
    <main className="admin-main"><div className="admin-content">{activeView !== "organizations" && activeView !== "models" && activeView !== "policy" && <div className="page-heading"><div><div className="eyebrow">{text[RSC.ADMIN_BADGE_TEXT]}</div><h1>{activeView === "dashboard" ? text[RSC.ADMIN_OVERVIEW_TITLE] : activeView === "system" ? text[RSC.ADMIN_SYSTEM_TITLE] : text[RSC.ADMIN_NAV_ACCOUNTS]}</h1></div></div>}{activeView === "dashboard" ? <DashboardScreen text={text} /> : activeView === "system" ? <SystemScreen text={text} /> : activeView === "policy" ? <PolicyScreen token={token} request={api} text={text} organizations={[]} /> : activeView === "organizations" ? <OrganizationScreen token={token} request={api} /> : activeView === "models" ? <ModelsScreen token={token} request={api} /> : <AccountScreen token={token} request={api} />}</div></main>
  </div>;
}
