import type { IncomingMessage } from "node:http";
import type { GatewaySocketPolicy } from "../transport/websocket.js";
import type { createSessionVerifier } from "../auth/index.js";

function tokenFrom(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7).trim();
  // A browser cannot set headers on a WebSocket handshake, so the token rides in
  // the query string. The upgrade is the only place it appears.
  const url = new URL(request.url ?? "/", "http://placeholder");
  return url.searchParams.get("session") ?? undefined;
}

export interface SocketPolicyInput {
  verifier: ReturnType<typeof createSessionVerifier>;
  /** Actions a client may submit. Configuration, not code: the broker never learns what they mean. */
  allowedActions: readonly string[];
  /** Reply channel is derived from session identity, so a client cannot address another session. */
  replyChannelFor(sessionId: string): string;
}

/**
 * The broker's only judgement calls: who may open a socket, and whether a frame
 * is one this deployment accepts.
 *
 * It reads the envelope and nothing else. `payload` is opaque here by design —
 * the envelope contract is fixed and independent of what any action carries, so
 * a new action never requires a change in the broker.
 */
export function createSocketPolicy(input: SocketPolicyInput): GatewaySocketPolicy {
  const allowed = new Set(input.allowedActions);
  return {
    async verifyUpgrade(request) {
      const token = tokenFrom(request);
      if (!token) return null;
      try {
        const user = await input.verifier.verify(token);
        return { userId: user.id, email: user.email };
      } catch { return null; }
    },

    guardIngress(frame, context) {
      const userId = typeof context?.userId === "string" ? context.userId : "";
      if (!userId) return null;
      if (!allowed.has(frame.action)) return null;

      // Session identity is an envelope field, not payload. A session id carries
      // its owner, so a id minted for another account cannot be replayed here.
      const sessionId = frame.sessionId ?? "";
      if (!sessionId || !sessionId.startsWith(`${userId}-`)) return null;
      if (!frame.transactionKey) return null;

      return {
        ...frame,
        sessionId,
        // The connection is the only authority on who this is. Everything else
        // the client sent passes through untouched — reading it is the worker's
        // business, not the broker's.
        payload: { ...frame.payload, userId },
        replyChannel: input.replyChannelFor(sessionId),
      };
    },
  };
}
