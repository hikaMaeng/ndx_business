import express from "express";
import { Pool } from "pg";
import { createEventBroker, readEnv, runService } from "agent/broker";
import { VIBE_COMMAND_ACTIONS } from "vibeagent_domain/common";
import { ensureSessionSchema, ensureViewSchema, ownsVibeChannel } from "vibeagent_domain/server";
import { QUEUES, ingressQueueFor } from "../reactions/index.js";
import { accountBaseUrl, clientDir, sessionCacheMs, workspaceRoot } from "../config.js";
import { gatewayVerifier } from "./verifier.js";
import { sessionRoutes } from "./routes/sessions.js";
import { workspaceRoutes } from "./routes/workspaces.js";

/**
 * The event broker: the socket, and the HTTP surface around it.
 *
 * This is the only role that talks to a browser. It accepts commands, writes
 * them to the intake queue, tails the log, and pushes what a client is allowed
 * to see down its socket. It runs no reactor and knows no action — everything
 * it is told about this domain arrives as configuration below.
 *
 * The routes it adds are the ones that are not agent work: listing projects,
 * making a folder, reading a finished transcript back. Those are queries over
 * things already in the database, so they are HTTP; the conversation itself is
 * entirely events.
 */
export async function startGateway(): Promise<void> {
  const env = readEnv();

  // A small pool: this role only reads. The reactors do the writing, in their
  // own processes, against their own pools.
  const pool = new Pool({ connectionString: env.databaseUrl, max: 4 });
  await ensureSessionSchema(pool);
  await ensureViewSchema(pool);

  const verifier = gatewayVerifier();

  await runService(createEventBroker({
    // Configuration, not implementation: the broker never learns what these do.
    allowedActions: VIBE_COMMAND_ACTIONS,
    ingressQueueFor,
    ingressQueues: [QUEUES.intake],
    accountBaseUrl,
    sessionCacheMs,
    replyChannelFor: (sessionId) => `vibe.${sessionId}`,
    clientDir,
    assetDir: workspaceRoot,
    // The broker polices replay requests with this; it still has no idea what a
    // vibe channel contains, only who may read one.
    authorizeChannel: (channel, user) => ownsVibeChannel(channel, user.id),
    extendHttp: (brokerApp) => {
      const app = express();
      app.use(express.json({ limit: "64kb" }));
      app.use(sessionRoutes(pool, verifier));
      app.use(workspaceRoutes(verifier));
      // Everything this app did not claim falls through to the broker's own surface.
      app.use(brokerApp);
      return app;
    },
  }));
}
