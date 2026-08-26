import { normaliseWorkspacePath } from "./workspace.js";

/**
 * Opening a session.
 *
 * A session is not created by working in it. It is opened deliberately, and it
 * cannot be opened without naming the folder it will work in. That folder is
 * fixed by the fact below and never changes for the life of the session.
 */

/** Payload of `vibe.session.open`. `userId` is stamped by the broker, never trusted from a client. */
export interface VibeSessionOpenRequest {
  sessionKey: string;
  userId: string;
  /** Relative to the deployment's projects root. */
  workspace: string;
}

/** What a client puts on the wire to open a session. Session identity travels in the envelope. */
export interface VibeSessionOpenSubmission {
  sessionId: string;
  workspace: string;
}

/**
 * The fact that fixes a session's folder.
 *
 * Session-scoped: it belongs to no turn. Every later turn reads its working
 * directory from this event rather than deriving one from the session id, which
 * is what makes the folder an independent, immutable property of the session.
 */
export interface VibeSessionOpened {
  sessionKey: string;
  workspace: string;
}

/** Rejects a session-open command the worker would otherwise have to guess at. */
export function parseVibeSessionOpenRequest(value: unknown): VibeSessionOpenRequest | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const text = (key: string): string | null => (typeof input[key] === "string" && (input[key] as string).length > 0 ? (input[key] as string) : null);
  const sessionKey = text("sessionKey");
  const userId = text("userId");
  const workspace = normaliseWorkspacePath(input.workspace);
  if (!sessionKey || !userId || !workspace) return null;
  return { sessionKey, userId, workspace };
}
