import express from "express";
import type { Pool } from "pg";
import { requireSession, type AuthedRequest } from "agent/broker";
import { ViewStore, listVibeSessions, ownsVibeSession } from "vibeagent_domain/server";
import type { SessionVerifier } from "../verifier.js";

const unavailable = (response: express.Response, error: unknown, what: string): void => {
  response.status(503).json({ error: error instanceof Error ? error.message : what });
};

/**
 * Reading a session back.
 *
 * Reopening one used to mean replaying its whole log — every reasoning delta of
 * every iteration, shipped to a browser that would immediately join them back
 * into the paragraphs a worker had already assembled once. These routes are the
 * alternative: a list of turns, and one turn's bodies fetched only when
 * somebody opens it.
 *
 * Ownership is the same prefix rule the broker uses to police replay, so a
 * session id answers it without a lookup.
 */
export function sessionRoutes(pool: Pool, verifier: SessionVerifier): express.Router {
  const view = new ViewStore(pool);
  const router = express.Router();
  const guard = requireSession(verifier);

  router.get("/api/vibe/sessions", guard, async (request: AuthedRequest, response) => {
    try { response.json({ sessions: await listVibeSessions(pool, request.sessionUser!.id) }); }
    catch (error) { unavailable(response, error, "session list unavailable"); }
  });

  router.get("/api/vibe/sessions/:sessionKey/turns", guard, async (request: AuthedRequest, response) => {
    const sessionKey = String(request.params.sessionKey ?? "");
    if (!ownsVibeSession(sessionKey, request.sessionUser!.id)) { response.status(404).json({ error: "no such session" }); return; }
    try {
      let turns = await view.turns(sessionKey);
      // Incomplete projection: a session older than the projection itself, or
      // one whose facts were stranded by a broker that came up with no
      // cursor. The fold is deterministic and the log still has everything.
      //
      // The comparison is against the log rather than against zero. A
      // half-projected session is not empty, and a transcript that silently
      // stops partway is worse than none — it looks like the session, and is not.
      if (turns.length < await view.loggedTurnCount(sessionKey)) {
        await view.rebuild(sessionKey);
        turns = await view.turns(sessionKey);
      }
      response.json({ turns });
    } catch (error) { unavailable(response, error, "transcript unavailable"); }
  });

  router.get("/api/vibe/sessions/:sessionKey/turns/:turnKey", guard, async (request: AuthedRequest, response) => {
    const sessionKey = String(request.params.sessionKey ?? "");
    if (!ownsVibeSession(sessionKey, request.sessionUser!.id)) { response.status(404).json({ error: "no such session" }); return; }
    try { response.json({ blocks: await view.blocks(sessionKey, String(request.params.turnKey ?? "")) }); }
    catch (error) { unavailable(response, error, "transcript unavailable"); }
  });

  return router;
}
