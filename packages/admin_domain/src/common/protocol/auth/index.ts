export type SignupMetadata = Record<string, unknown>;

export type SignupRequest = {
  email: string;
  password: string;
  metadata?: SignupMetadata;
};

export type SignupResponse = {
  userId: string;
  status: "active" | "pending";
};

export type LoginRequest = {
  email: string;
  password: string;
  metadata?: Record<string, unknown>;
};

export type LoginResponse = {
  sessionToken: string;
  expiresAt: string;
  user: UserSummary;
};

export type UserSummary = {
  id: string;
  email: string;
  status: "active" | "pending" | "rejected";
  isMasterAdmin?: boolean;
};

export type UsersResponse = { users: UserSummary[] };

export function parseUserSummary(value: unknown): UserSummary | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string" &&
    typeof user.email === "string" &&
    (user.status === "active" ||
      user.status === "pending" ||
      user.status === "rejected") &&
    (user.isMasterAdmin === undefined ||
      typeof user.isMasterAdmin === "boolean")
    ? (user as UserSummary)
    : null;
}

export function parseUsersResponse(value: unknown): UsersResponse | null {
  if (!value || typeof value !== "object") return null;
  const users = (value as Record<string, unknown>).users;
  if (!Array.isArray(users)) return null;
  return users.every((item) => parseUserSummary(item) !== null)
    ? { users: users as UserSummary[] }
    : null;
}

export type SessionSummary = {
  id: string;
  userId: string;
  email: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  metadata: Record<string, unknown>;
  devices: SessionDeviceSummary[];
};

export type SessionDeviceSummary = {
  id: string;
  deviceKey: string;
  label: string;
  firstSeenAt: string;
  lastRequestAt: string;
  requestCount: number;
  revokedAt: string | null;
};

export type PendingUser = {
  id: string;
  email: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type AuthSettings = {
  signupAcceptanceMode: "auto" | "filter" | "approval";
  signupFilter: Record<string, unknown> | null;
  sessionIdleTimeoutSeconds: number;
  expiredSessionRetentionMode: "none" | "retain";
  expiredSessionRetentionSeconds: number;
  sessionHeaderName: string;
  sessionCookieName: string;
};

export type SettingsResponse = {
  settings: AuthSettings;
  sessions: SessionSummary[];
  pendingUsers: PendingUser[];
};

export type UpdateSettingsRequest = Partial<AuthSettings>;

export function parseSignupRequest(value: unknown): SignupRequest | null {
  if (!isRecord(value) || typeof value.email !== "string" || typeof value.password !== "string") return null;
  return { email: value.email, password: value.password, metadata: value.metadata && isRecord(value.metadata) ? value.metadata : undefined };
}

export function parseLoginRequest(value: unknown): LoginRequest | null {
  if (!isRecord(value) || typeof value.email !== "string" || typeof value.password !== "string") return null;
  return { email: value.email, password: value.password, metadata: value.metadata && isRecord(value.metadata) ? value.metadata : undefined };
}

export function parseUpdateSettingsRequest(value: unknown): UpdateSettingsRequest | null {
  return isRecord(value) ? value as UpdateSettingsRequest : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function parseSignupResponse(value: unknown): SignupResponse | null {
  if (!isRecord(value) || typeof value.userId !== "string") return null;
  return value.status === "active" || value.status === "pending"
    ? { userId: value.userId, status: value.status }
    : null;
}

export function parseLoginResponse(value: unknown): LoginResponse | null {
  if (!isRecord(value) || typeof value.sessionToken !== "string" || typeof value.expiresAt !== "string") return null;
  const user = parseUserSummary(value.user);
  return user ? { sessionToken: value.sessionToken, expiresAt: value.expiresAt, user } : null;
}

function parseSettings(value: unknown): AuthSettings | null {
  if (!isRecord(value)) return null;
  return (value.signupAcceptanceMode === "auto" || value.signupAcceptanceMode === "filter" || value.signupAcceptanceMode === "approval") &&
    (value.signupFilter === null || isRecord(value.signupFilter)) &&
    typeof value.sessionIdleTimeoutSeconds === "number" &&
    (value.expiredSessionRetentionMode === "none" || value.expiredSessionRetentionMode === "retain") &&
    typeof value.expiredSessionRetentionSeconds === "number" &&
    typeof value.sessionHeaderName === "string" &&
    typeof value.sessionCookieName === "string"
    ? value as AuthSettings
    : null;
}

export function parseSettingsResponse(value: unknown): SettingsResponse | null {
  if (!isRecord(value) || !Array.isArray(value.sessions) || !Array.isArray(value.pendingUsers)) return null;
  const settings = parseSettings(value.settings);
  if (!settings) return null;
  return { settings, sessions: value.sessions as SessionSummary[], pendingUsers: value.pendingUsers as PendingUser[] };
}

export type ApiErrorResponse = {
  error: string;
};

export type AuthRoute =
  | {
      method: "POST";
      path: "/api/auth/signup";
      request: SignupRequest;
      response: SignupResponse;
    }
  | {
      method: "POST";
      path: "/api/auth/login";
      request: LoginRequest;
      response: LoginResponse;
    }
  | {
      method: "POST";
      path: "/api/auth/logout";
      request: Record<string, never>;
      response: { ok: true };
    }
  | {
      method: "GET";
      path: "/api/auth/me";
      request: undefined;
      response: UserSummary;
    }
  | {
      method: "GET";
      path: "/api/admin/settings";
      request: undefined;
      response: SettingsResponse;
    }
  | {
      method: "PUT";
      path: "/api/admin/settings";
      request: UpdateSettingsRequest;
      response: SettingsResponse;
    }
  | {
      method: "DELETE";
      path: "/api/admin/sessions/:id";
      request: undefined;
      response: { ok: true };
    }
  | {
      method: "GET";
      path: "/api/admin/pending-users";
      request: undefined;
      response: { users: PendingUser[] };
    }
  | {
      method: "GET";
      path: "/api/admin/users";
      request: undefined;
      response: UsersResponse;
    }
  | {
      method: "POST";
      path: "/api/admin/users/:id/approve";
      request: undefined;
      response: { ok: true };
    }
  | {
      method: "POST";
      path: "/api/admin/users/:id/reject";
      request: undefined;
      response: { ok: true };
    };
