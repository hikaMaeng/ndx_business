// Static key map for this folder's components.
//
// A component reads only the keys its own folder declares here, never the
// whole resource file. That keeps the surface small enough to hold in view
// and makes an invented key a compile error instead of a blank label.
//
// Enum name is the key uppercased with dots as underscores. `check-i18n.sh`
// enforces that, so the mapping stays mechanical rather than a naming choice.
export enum RSC {
  AUTH_BADGE_TEXT = "auth.badge.text",
  AUTH_TITLE_TEXT = "auth.title.text",
  AUTH_SUBTITLE_TEXT = "auth.subtitle.text",
  AUTH_EMAIL_LABEL = "auth.email.label",
  AUTH_PASSWORD_LABEL = "auth.password.label",
  AUTH_LOGIN_BUTTON = "auth.login.button",
  AUTH_SIGNUP_BUTTON = "auth.signup.button",
  AUTH_LOGOUT_BUTTON = "auth.logout.button",
  AUTH_SIGNUP_ACTIVE_STATUS = "auth.signup.active.status",
  AUTH_SIGNUP_PENDING_STATUS = "auth.signup.pending.status",
  AUTH_ERROR_ALERT = "auth.error.alert",
  ADMIN_BADGE_TEXT = "admin.badge.text",
  ADMIN_TITLE_TEXT = "admin.title.text",
  ADMIN_POLICY_TITLE_TEXT = "admin.policy.title.text",
  ADMIN_POLICY_SUBTITLE_TEXT = "admin.policy.subtitle.text",
  ADMIN_ACCEPTANCE_LABEL = "admin.acceptance.label",
  ADMIN_AUTO_OPTION = "admin.auto.option",
  ADMIN_FILTER_OPTION = "admin.filter.option",
  ADMIN_APPROVAL_OPTION = "admin.approval.option",
  ADMIN_FILTER_LABEL = "admin.filter.label",
  ADMIN_FILTER_PLACEHOLDER = "admin.filter.placeholder",
  ADMIN_IDLE_LABEL = "admin.idle.label",
  ADMIN_RETENTION_MODE_LABEL = "admin.retention.mode.label",
  ADMIN_RETENTION_NONE_OPTION = "admin.retention.none.option",
  ADMIN_RETENTION_RETAIN_OPTION = "admin.retention.retain.option",
  ADMIN_RETENTION_SECONDS_LABEL = "admin.retention.seconds.label",
  ADMIN_SAVE_BUTTON = "admin.save.button",
  ADMIN_SAVED_STATUS = "admin.saved.status",
  ADMIN_LOADING_STATUS = "admin.loading.status",
  ADMIN_SESSIONS_TITLE_TEXT = "admin.sessions.title.text",
  ADMIN_SESSIONS_SUBTITLE_TEXT = "admin.sessions.subtitle.text",
  ADMIN_SESSIONS_EMPTY_MESSAGE = "admin.sessions.empty.message",
  ADMIN_LAST_USED_LABEL = "admin.last.used.label",
  ADMIN_EXPIRES_LABEL = "admin.expires.label",
  ADMIN_REVOKE_BUTTON = "admin.revoke.button",
  ADMIN_PENDING_TITLE_TEXT = "admin.pending.title.text",
  ADMIN_PENDING_SUBTITLE_TEXT = "admin.pending.subtitle.text",
  ADMIN_PENDING_EMPTY_MESSAGE = "admin.pending.empty.message",
  ADMIN_APPROVE_BUTTON = "admin.approve.button",
  ADMIN_REJECT_BUTTON = "admin.reject.button"
  ,ADMIN_NAV_OVERVIEW = "admin.nav.overview"
  ,ADMIN_NAV_DASHBOARD = "admin.nav.dashboard"
  ,ADMIN_NAV_POLICY = "admin.nav.policy"
  ,ADMIN_NAV_ACCOUNTS = "admin.nav.accounts"
  ,ADMIN_NAV_SESSIONS = "admin.nav.sessions"
  ,ADMIN_NAV_SYSTEM = "admin.nav.system"
  ,ADMIN_NAV_SECTION = "admin.nav.section"
  ,ADMIN_ACCOUNT_TAB_APPROVAL = "admin.account.tab.approval"
  ,ADMIN_ACCOUNT_TAB_SESSIONS = "admin.account.tab.sessions"
  ,ADMIN_ACCOUNT_TAB_POLICY = "admin.account.tab.policy"
  ,ADMIN_BRAND_TEXT = "admin.brand.text"
  ,ADMIN_BRAND_VERSION = "admin.brand.version"
  ,ADMIN_OVERVIEW_TITLE = "admin.overview.title"
  ,ADMIN_OVERVIEW_MESSAGE = "admin.overview.message"
  ,ADMIN_SYSTEM_TITLE = "admin.system.title"
  ,ADMIN_SYSTEM_MESSAGE = "admin.system.message"
  ,ADMIN_SESSION_HEADER_LABEL = "admin.session.header.label"
  ,ADMIN_SESSION_COOKIE_LABEL = "admin.session.cookie.label"
  ,ADMIN_SESSION_TRANSPORT_TITLE = "admin.session.transport.title"
  ,ADMIN_SESSION_TRANSPORT_SUBTITLE = "admin.session.transport.subtitle"
  ,ADMIN_SESSION_DEVICES_TITLE = "admin.session.devices.title"
  ,ADMIN_SESSION_DEVICE_REQUESTS_LABEL = "admin.session.device.requests.label"
  ,ADMIN_SESSION_DEVICE_LAST_REQUEST_LABEL = "admin.session.device.last.request.label"
  ,ADMIN_SESSION_DEVICES_EMPTY_MESSAGE = "admin.session.devices.empty.message"
  ,ADMIN_LANGUAGE_LABEL = "admin.language.label"
  ,ADMIN_LANGUAGE_EN = "admin.language.en"
  ,ADMIN_LANGUAGE_KO = "admin.language.ko"
  ,ADMIN_LANGUAGE_ZH = "admin.language.zh"
  ,ADMIN_LANGUAGE_ES = "admin.language.es"
  ,ADMIN_LANGUAGE_HI = "admin.language.hi"
  ,ADMIN_LANGUAGE_AR = "admin.language.ar"
  ,ADMIN_LANGUAGE_FR = "admin.language.fr"
  ,ADMIN_LANGUAGE_PT = "admin.language.pt"
  ,ADMIN_NAV_ORGANIZATIONS = "admin.nav.organizations"
  ,ADMIN_ORGANIZATIONS_TITLE = "admin.organizations.title"
  ,ADMIN_ORGANIZATIONS_MESSAGE = "admin.organizations.message"
  ,ADMIN_ORGANIZATIONS_REFRESH_BUTTON = "admin.organizations.refresh.button"
  ,ORGANIZATION_NODE_DETAIL_TEXT = "organization.node.detail.text"
  ,ORGANIZATION_NODE_CREATE_CHILD_BUTTON = "organization.node.create.child.button"
  ,ORGANIZATION_NODE_MEMBER_LABEL = "organization.node.member.label"
  ,ORGANIZATION_NODE_RESPONSIBLE_LABEL = "organization.node.responsible.label"
  ,ORGANIZATION_NODE_SCOPE_LABEL = "organization.node.scope.label"
  ,ORGANIZATION_NODE_ASSIGN_MEMBER_BUTTON = "organization.node.assign.member.button"
  ,ORGANIZATION_NODE_ASSIGN_RESPONSIBLE_BUTTON = "organization.node.assign.responsible.button"
  ,ORGANIZATION_NODE_CLOSE_BUTTON = "organization.node.close.button"
  ,ORGANIZATION_NODE_EMPTY_MESSAGE = "organization.node.empty.message"
}
