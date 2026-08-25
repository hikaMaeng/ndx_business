import type express from "express";

export interface AuthenticatedUser { id: string; email: string; status: string; isMasterAdmin?: boolean }
export type AuthedRequest = express.Request & { vibeUser?: AuthenticatedUser; vibeToken?: string };

/**
 * Session validation lives here, not in the broker.
 *
 * The admin service owns accounts, the signup acceptance policy, and session
 * lifetime; this layer only asks it "is this token still good, and whose is it".
 * That keeps one account store for both services — duplicating the check here
 * would let an approval in admin disagree with what this service believes.
 */
export function createSessionVerifier(input: { adminBaseUrl: string; cacheMs: number }) {
  const cache = new Map<string, { user: AuthenticatedUser; expiresAt: number }>();

  const verify = async (token: string): Promise<AuthenticatedUser> => {
    const cached = cache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    const response = await fetch(`${input.adminBaseUrl.replace(/\/+$/, "")}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      cache.delete(token);
      throw new Error("session is not valid");
    }
    const user = await response.json() as AuthenticatedUser;
    if (!user?.id || user.status !== "active") {
      cache.delete(token);
      throw new Error("account is not active");
    }
    // Short cache only. Admin slides the idle timeout on every check, so caching
    // too long would both hide a revocation and stop the session from staying alive.
    cache.set(token, { user, expiresAt: Date.now() + input.cacheMs });
    return user;
  };

  return { verify, forget: (token: string) => cache.delete(token) };
}

export function readBearer(request: express.Request): string | undefined {
  const header = request.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const custom = request.header("x-vibe-session");
  return custom || undefined;
}

/** Every client action passes through here; the broker never sees a token. */
export function requireSession(verifier: ReturnType<typeof createSessionVerifier>): express.RequestHandler {
  return (request: AuthedRequest, response, next) => {
    const token = readBearer(request);
    if (!token) { response.status(401).json({ error: "session token required" }); return; }
    verifier.verify(token)
      .then((user) => { request.vibeUser = user; request.vibeToken = token; next(); })
      .catch((error) => response.status(401).json({ error: error instanceof Error ? error.message : "unauthenticated" }));
  };
}
