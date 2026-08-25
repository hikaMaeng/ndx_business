import express from "express";
import path from "node:path";
import type { AgentEnv, EventQueueTransport, MetricsRegistry } from "agent/broker";
import { writeMetrics } from "agent/broker";
import { requireSession, type AuthedRequest, type createSessionVerifier } from "./auth/index.js";

export interface VibeAppInput {
  env: AgentEnv;
  queue: EventQueueTransport;
  metrics: MetricsRegistry;
  checkDatabase: () => Promise<void>;
  frontDir: string;
  workspaceRoot: string;
  adminBaseUrl: string;
  verifier: ReturnType<typeof createSessionVerifier>;
}

/**
 * The HTTP surface is deliberately small.
 *
 * Only two things need a request/response round trip: proving who the caller is
 * (which the admin service owns, together with the account tables it configures)
 * and serving bytes — the client bundle and the files the agent produced.
 *
 * Every interaction with the agent itself is an event on the WebSocket. Putting
 * turn submission behind HTTP would demote the socket to a notification channel
 * and split one conversation across two transports.
 */
export function createVibeApp(input: VibeAppInput): express.Express {
  const app = express();
  const authed = requireSession(input.verifier);

  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_request, response) => response.json({ status: "ok", service: "vibeagent" }));
  app.get("/ready", async (_request, response) => {
    try { await Promise.all([input.queue.check(), input.checkDatabase()]); response.json({ status: "ready" }); }
    catch { response.status(503).json({ status: "unavailable" }); }
  });
  app.get("/metrics", (request, response) => { writeMetrics(request, response, input.env, input.metrics); });

  /**
   * Authentication is proxied, not redirected.
   *
   * The admin service is reachable only inside the compose network, so a browser
   * cannot call it directly; and forwarding here keeps one origin for the client,
   * which avoids CORS and keeps the admin origin out of the shipped bundle.
   * This service still owns none of the account state — admin decides whether a
   * signup is active or pending, and how long a session lives.
   */
  const forwardToAdmin = (adminPath: string): express.RequestHandler => async (request, response) => {
    try {
      const upstream = await fetch(`${input.adminBaseUrl.replace(/\/+$/, "")}${adminPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body ?? {}),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await upstream.json().catch(() => ({}));
      response.status(upstream.status).json(body);
    } catch (error) {
      response.status(503).json({ error: error instanceof Error ? error.message : "account service unavailable" });
    }
  };

  app.post("/api/vibe/auth/login", forwardToAdmin("/api/auth/login"));
  app.post("/api/vibe/auth/signup", forwardToAdmin("/api/auth/signup"));

  // The one authenticated read: who am I. Session state itself lives in admin.
  app.get("/api/vibe/me", authed, (request: AuthedRequest, response) => response.json(request.vibeUser));

  // Generated artefacts, read-only. Serving them is the only way to actually
  // open what the agent built and confirm it works.
  app.use("/workspace", express.static(input.workspaceRoot, { index: "index.html", dotfiles: "ignore" }));

  app.use(express.static(input.frontDir));
  app.get("/{*path}", (_request, response) => response.sendFile(path.join(input.frontDir, "index.html")));
  return app;
}
