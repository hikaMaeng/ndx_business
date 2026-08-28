import express from "express";
import { createEventBroker, readEnv, runService } from "agent/broker";
import { VIBE_COMMAND_ACTIONS } from "vibeagent_domain/common";
import { ensureSessionSchema, ensureViewSchema, ownsVibeChannel } from "vibeagent_domain/server";
import { QUEUES, REACTIONS, ingressQueueFor } from "../reactions/index.js";
import { accountBaseUrl, clientDir, sessionCacheMs, workspaceRoot } from "../config.js";
import { gatewayVerifier } from "./verifier.js";
import { sessionRoutes } from "./routes/sessions.js";
import { workspaceRoutes } from "./routes/workspaces.js";

/**
 * The event broker: the socket, the HTTP surface around it, and the fact
 * dispatch that turns what was recorded into work for the reactor queues.
 *
 * This is the only role that talks to a browser, which is also why the two
 * halves are one process: the client reaches the broker over a websocket, and
 * the only port a browser can see is this server's.
 *
 * It accepts commands, writes them to the intake queue, tails the log, pushes
 * what a client is allowed to see down its socket, and puts each recorded fact
 * on the queues the reaction table names. It runs no reactor and knows no
 * action — everything it is told about this domain arrives as configuration.
 *
 * The routes it adds are the ones that are not agent work: listing projects,
 * making a folder, reading a finished transcript back. Those are queries over
 * things already in the database, so they are HTTP; the conversation itself is
 * entirely events.
 */
export async function startBroker(): Promise<void> {
  const env = readEnv();

  const verifier = gatewayVerifier();

  await runService(createEventBroker({
    // Configuration, not implementation: the broker never learns what these do.
    allowedActions: VIBE_COMMAND_ACTIONS,
    ingressQueueFor,
    ingressQueues: [QUEUES.intake],
    // The reaction table. Handing it over is what makes this broker also put
    // recorded facts on the reactor queues, which is the half that briefly ran
    // as its own container. Still configuration: the broker reads it and
    // learns nothing about what any of these actions mean.
    reactions: REACTIONS,
    reactionsName: "vibe",
    accountBaseUrl,
    sessionCacheMs,
    replyChannelFor: (sessionId) => `vibe.${sessionId}`,
    clientDir,
    assetDir: workspaceRoot,
    // The broker polices replay requests with this; it still has no idea what a
    // vibe channel contains, only who may read one.
    authorizeChannel: (channel, user) => ownsVibeChannel(channel, user.id),
    // The broker's own pool arrives here rather than a second one being opened
    // beside it. These routes only read the projection.
    extendHttp: (brokerApp, database) => {
      const app = express();
      app.use(express.json({ limit: "64kb" }));
      void Promise.all([ensureSessionSchema(database), ensureViewSchema(database)]);
      app.use(sessionRoutes(database, verifier));
      app.use(workspaceRoutes(verifier));
      // Everything this app did not claim falls through to the broker's own surface.
      app.use(brokerApp);
      return app;
    },
  }));
}
