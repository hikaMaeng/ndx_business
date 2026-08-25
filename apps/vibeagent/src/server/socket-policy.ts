import type { IncomingMessage } from "node:http";
import type { GatewaySocketPolicy } from "agent/broker";
import { VIBE_TURN_ACTION } from "vibeagent_domain/common";
import type { createSessionVerifier } from "./auth/index.js";

function tokenFrom(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7).trim();
  // Browsers cannot set headers on a WebSocket handshake, so the token rides in
  // the query string. It is the same short-lived session token, and the upgrade
  // is the only place it appears.
  const url = new URL(request.url ?? "/", "http://placeholder");
  return url.searchParams.get("session") ?? undefined;
}

/**
 * Everything the client does with the agent happens over this socket, so this
 * is the single place identity is enforced. HTTP is left with authentication
 * and the admin-owned account state; the event path is socket-only.
 */
export function createVibeSocketPolicy(verifier: ReturnType<typeof createSessionVerifier>): GatewaySocketPolicy {
  return {
    async verifyUpgrade(request) {
      const token = tokenFrom(request);
      if (!token) return null;
      try {
        const user = await verifier.verify(token);
        return { userId: user.id, email: user.email };
      } catch { return null; }
    },

    guardIngress(input, context) {
      const userId = typeof context?.userId === "string" ? context.userId : "";
      if (!userId) return null;
      // One action reaches the broker from a browser. Anything else would be a
      // client inventing work this service does not offer.
      if (input.action !== VIBE_TURN_ACTION) return null;

      const payload = input.payload ?? {};
      const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : "";
      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      // The session key carries its owner, so a key belonging to another account
      // cannot be replayed on this connection.
      if (!sessionKey || !sessionKey.startsWith(`${userId}-`) || !prompt) return null;

      const turnKey = typeof input.transactionKey === "string" && input.transactionKey ? input.transactionKey : "";
      if (!turnKey) return null;

      return {
        action: VIBE_TURN_ACTION,
        // userId is overwritten, never merged: the connection is the only
        // authority on who this is.
        payload: { sessionKey, turnKey, prompt, userId },
        transactionKey: turnKey,
        channel: "agent.requests",
        replyChannel: `vibe.${sessionKey}`,
      };
    },
  };
}
