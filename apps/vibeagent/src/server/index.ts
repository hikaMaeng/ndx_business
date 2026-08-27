import express from "express";
import { Pool } from "pg";
import { readEnv, createEventBroker, createFactDispatcher, createWorkerServer, runService, requireSession, createSessionVerifier, type AuthedRequest } from "agent/broker";
import { VIBE_COMMAND_ACTIONS, normaliseWorkspacePath } from "vibeagent_domain/common";
import { ViewStore, createVibeWorker, ensureSessionSchema, ensureViewSchema, ensureWorkspaceDirectory, listVibeSessions, listWorkspaceFolders, ownsVibeChannel, ownsVibeSession } from "vibeagent_domain/server";
import { GROUPS, REACTIONS, REACTOR_QUEUES, QUEUES, ingressQueueFor } from "./reactions.js";

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
  // Only the groups for the queues this process watches. A queue named in the
  // environment that no group answers is a wiring mistake, and it should fail
  // on the first message rather than look like an unknown action.
  const groups = Object.fromEntries(watched.filter((name) => GROUPS[name]).map((name) => [name, GROUPS[name]!]));
  await runService(createWorkerServer({
    execute: createVibeWorker(workerPool, groups),
    queues: watched,
    maxConcurrent: Number(process.env.VIBE_MAX_CONCURRENT_TURNS ?? 256),
  }));
} else if (env.role === "dispatcher") {
  await runService(createFactDispatcher({ name: "vibe", table: REACTIONS }));
} else {
  const readPool = new Pool({ connectionString: env.databaseUrl, max: 4 });
  await ensureSessionSchema(readPool);
  await ensureViewSchema(readPool);
  const view = new ViewStore(readPool);
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
       * The read model.
       *
       * Reopening a session used to mean replaying its whole log — every
       * reasoning delta of every iteration, shipped to a browser that would
       * immediately join them back into paragraphs. These two routes are the
       * alternative: a list of turns, and one turn's bodies fetched only when
       * somebody opens it.
       *
       * Ownership is the same prefix rule the broker uses for replay, so a
       * session id is enough to answer it without a lookup.
       */
      app.get("/api/vibe/sessions/:sessionKey/turns", requireSession(verifier), async (request: AuthedRequest, response) => {
        const sessionKey = String(request.params.sessionKey ?? "");
        if (!ownsVibeSession(sessionKey, request.sessionUser!.id)) { response.status(404).json({ error: "no such session" }); return; }
        try {
          let turns = await view.turns(sessionKey);
          // Cold projection: a session older than the projection itself, or one
          // whose facts were stranded by a restart. The fold is deterministic
          // and the log still has everything, so do it now rather than show an
          // empty transcript for a session that plainly is not empty.
          if (!turns.length) { await view.rebuild(sessionKey); turns = await view.turns(sessionKey); }
          response.json({ turns });
        }
        catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : "transcript unavailable" }); }
      });

      app.get("/api/vibe/sessions/:sessionKey/turns/:turnKey", requireSession(verifier), async (request: AuthedRequest, response) => {
        const sessionKey = String(request.params.sessionKey ?? "");
        if (!ownsVibeSession(sessionKey, request.sessionUser!.id)) { response.status(404).json({ error: "no such session" }); return; }
        try { response.json({ blocks: await view.blocks(sessionKey, String(request.params.turnKey ?? "")) }); }
        catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : "transcript unavailable" }); }
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
