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
