import express from "express";
import { Pool } from "pg";
import { readEnv, createEventBroker, createWorkerServer, runService, requireSession, createSessionVerifier, type AuthedRequest } from "agent/broker";
import { VIBE_TURN_ACTION } from "vibeagent_domain/common";
import { executeHandler, listVibeSessions, ownsVibeChannel } from "vibeagent_domain/server";

/**
 * vibeagent runs two services from one image, chosen by `AGENT_ROLE`.
 *
 * The event broker arrives finished — this file connects it and launches it.
 * The worker server arrives as a frame, and the hole is filled with this
 * project's own handler.
 */
const env = readEnv();
const accountBaseUrl = process.env.VIBE_ACCOUNT_BASE_URL ?? "http://admin:18080";

if (env.role === "worker") {
  /**
   * Inline, not a thread pool.
   *
   * A vibe turn is almost entirely waiting: an inference call, then a child
   * process, then the next inference call. There is no CPU work to keep off the
   * event loop, so a worker thread would only cap concurrency at `cpus × 2`
   * while holding a V8 isolate per idle turn.
   */
  await runService(createWorkerServer({
    execute: executeHandler,
    maxConcurrent: Number(process.env.VIBE_MAX_CONCURRENT_TURNS ?? 256),
  }));
} else {
  // Listing sessions is a domain query over event history, so it belongs to
  // this app rather than the broker. Its own small pool keeps it off the
  // broker's connection budget.
  const readPool = new Pool({ connectionString: env.databaseUrl, max: 4 });
  const verifier = createSessionVerifier({ adminBaseUrl: accountBaseUrl, cacheMs: Number(process.env.VIBE_SESSION_CACHE_MS ?? 5_000) });

  await runService(createEventBroker({
    // Configuration, not implementation: the broker never learns what this does.
    allowedActions: [VIBE_TURN_ACTION],
    accountBaseUrl,
    sessionCacheMs: Number(process.env.VIBE_SESSION_CACHE_MS ?? 5_000),
    replyChannelFor: (sessionId) => `vibe.${sessionId}`,
    clientDir: process.env.VIBE_CLIENT_DIR ?? "/app/dist/front",
    assetDir: process.env.VIBE_WORKSPACE_ROOT ?? "/workspace",
    // The broker polices replay requests with this; it still has no idea what a
    // vibe channel contains, only who may read one.
    authorizeChannel: (channel, user) => ownsVibeChannel(channel, user.id),
    extendHttp: (brokerApp) => {
      const app = express();
      app.use(express.json({ limit: "64kb" }));
      app.get("/api/vibe/sessions", requireSession(verifier), async (request: AuthedRequest, response) => {
        try { response.json({ sessions: await listVibeSessions(readPool, request.sessionUser!.id) }); }
        catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : "session list unavailable" }); }
      });
      // Everything this app did not claim falls through to the broker's own surface.
      app.use(brokerApp);
      return app;
    },
  }));
}
