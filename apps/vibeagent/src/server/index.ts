import express from "express";
import { Pool } from "pg";
import { readEnv, createEventBroker, createFactDispatcher, createWorkerServer, runService, requireSession, createSessionVerifier, type AuthedRequest } from "agent/broker";
import { VIBE_COMMAND_ACTIONS, normaliseWorkspacePath } from "vibeagent_domain/common";
import { createVibeWorker, ensureSessionSchema, ensureWorkspaceDirectory, listVibeSessions, listWorkspaceFolders, ownsVibeChannel } from "vibeagent_domain/server";
import { REACTIONS, REACTOR_QUEUES, QUEUES, ingressQueueFor } from "./reactions.js";

/**
 * vibeagent runs three kinds of service from one image, chosen by `AGENT_ROLE`.
 *
 * The broker and the fact dispatcher arrive finished — this file connects them
 * and launches them. The worker server arrives as a frame, and the hole is
 * filled with this project's reactors.
 *
 * A worker server watches a list of queues, so one process can cover every
 * reactor on a small deployment and a busy kind can be split onto its own
 * process by naming only its queue. Nothing in a reactor changes either way.
 */
const env = readEnv();
const accountBaseUrl = process.env.VIBE_ACCOUNT_BASE_URL ?? "http://admin:18080";
const workspaceRoot = process.env.VIBE_WORKSPACE_ROOT ?? "/workspace";

if (env.role === "worker") {
  /**
   * Inline, not a thread pool.
   *
   * A reactor is almost entirely waiting: an inference call, or a child
   * process. There is no CPU work to keep off the event loop, so a worker
   * thread would only cap concurrency at `cpus × 2` while holding a V8 isolate
   * per idle reaction.
   */
  const workerPool = new Pool({ connectionString: env.databaseUrl, max: 8 });
  const watched = process.env.AGENT_QUEUES ? env.queues : REACTOR_QUEUES;
  await runService(createWorkerServer({
    execute: createVibeWorker(workerPool),
    queues: watched,
    maxConcurrent: Number(process.env.VIBE_MAX_CONCURRENT_TURNS ?? 256),
  }));
} else if (env.role === "dispatcher") {
  await runService(createFactDispatcher({ name: "vibe", table: REACTIONS }));
} else {
  const readPool = new Pool({ connectionString: env.databaseUrl, max: 4 });
  await ensureSessionSchema(readPool);
  const verifier = createSessionVerifier({ adminBaseUrl: accountBaseUrl, cacheMs: Number(process.env.VIBE_SESSION_CACHE_MS ?? 5_000) });

  await runService(createEventBroker({
    // Configuration, not implementation: the broker never learns what these do.
    allowedActions: VIBE_COMMAND_ACTIONS,
    ingressQueueFor,
    ingressQueues: [QUEUES.intake],
    accountBaseUrl,
    sessionCacheMs: Number(process.env.VIBE_SESSION_CACHE_MS ?? 5_000),
    replyChannelFor: (sessionId) => `vibe.${sessionId}`,
    clientDir: process.env.VIBE_CLIENT_DIR ?? "/app/dist/front",
    assetDir: workspaceRoot,
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

      /**
       * Projects.
       *
       * A project is a folder under the projects root, and a session is created
       * inside one — which is how a session gets its folder without anyone
       * typing a path at session time. Managing folders is not agent work, so
       * it stays on HTTP; the agent conversation is still entirely events.
       */
      app.get("/api/vibe/workspaces", requireSession(verifier), async (_request: AuthedRequest, response) => {
        try { response.json({ workspaces: await listWorkspaceFolders(workspaceRoot) }); }
        catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : "workspace list unavailable" }); }
      });

      app.post("/api/vibe/workspaces", requireSession(verifier), async (request: AuthedRequest, response) => {
        const workspace = normaliseWorkspacePath((request.body as Record<string, unknown> | undefined)?.workspace);
        if (!workspace) { response.status(400).json({ error: "폴더 이름은 영문·숫자로 시작하고 . _ - / 만 쓸 수 있습니다." }); return; }
        try {
          await ensureWorkspaceDirectory(workspaceRoot, workspace);
          response.status(201).json({ workspace });
        } catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : "workspace could not be created" }); }
      });

      // Everything this app did not claim falls through to the broker's own surface.
      app.use(brokerApp);
      return app;
    },
  }));
}
