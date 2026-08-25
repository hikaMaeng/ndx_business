import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import type { AgentEnv } from "../env.js";
import type { EventQueueTransport } from "../queue/transport.js";
import type { MetricsRegistry } from "../metrics/registry.js";
import { writeMetrics } from "../metrics/endpoint.js";
import { requireSession, type AuthedRequest, type createSessionVerifier } from "../auth/index.js";

export interface WebBackendInput {
  /** Opens a replay cursor. Supplied by the broker; the backend does not own the store. */
  openCursor?(channels: string[], from: "start" | "now"): Promise<{ token: string }>;
  /** Decides whether this user may read a channel. The broker has no opinion on ownership. */
  authorizeChannel?(channel: string, user: { id: string }): boolean;
  env: AgentEnv;
  queue: EventQueueTransport;
  metrics: MetricsRegistry;
  checkDatabase: () => Promise<void>;
  verifier: ReturnType<typeof createSessionVerifier>;
  accountBaseUrl: string;
  /** Client bundle to serve at `/`. Mounted by the deployment, not built in. */
  clientDir?: string;
  /** Files produced by workers, served read-only at `/workspace`. */
  assetDir?: string;
}

/**
 * The broker's HTTP surface, kept as small as the role allows.
 *
 * The broker transports events; it does not process them. HTTP therefore does
 * only what a socket cannot: prove who is calling, and hand over bytes. Both
 * directories it serves are supplied by configuration — the broker never learns
 * what application they belong to.
 */
export function createWebBackend(input: WebBackendInput): express.Express {
  const app = express();
  const authed = requireSession(input.verifier);

  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_request, response) => response.json({ status: "ok", service: "broker" }));
  app.get("/ready", async (_request, response) => {
    try { await Promise.all([input.queue.check(), input.checkDatabase()]); response.json({ status: "ready" }); }
    catch { response.status(503).json({ status: "unavailable" }); }
  });
  app.get("/metrics", (request, response) => { writeMetrics(request, response, input.env, input.metrics); });

  /**
   * Authentication is proxied, not redirected.
   *
   * The account service is reachable only inside the internal network, so a
   * browser cannot call it; forwarding keeps one origin for the client, which
   * avoids CORS and keeps that origin out of the shipped bundle. The broker
   * still owns none of the account state — the account service decides whether
   * a signup is active or pending, and how long a session lives.
   */
  const forward = (upstreamPath: string): express.RequestHandler => async (request, response) => {
    try {
      const upstream = await fetch(`${input.accountBaseUrl.replace(/\/+$/, "")}${upstreamPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body ?? {}),
        signal: AbortSignal.timeout(10_000),
      });
      response.status(upstream.status).json(await upstream.json().catch(() => ({})));
    } catch (error) {
      response.status(503).json({ error: error instanceof Error ? error.message : "account service unavailable" });
    }
  };

  app.post("/api/auth/login", forward("/api/auth/login"));
  app.post("/api/auth/signup", forward("/api/auth/signup"));
  app.get("/api/auth/me", authed, (request: AuthedRequest, response) => response.json(request.sessionUser));

  /**
   * Opens a replay cursor for channels this user may read.
   *
   * A plain subscription starts at the current high-water mark, which is right
   * for a live view and wrong for reopening a past conversation. This is the
   * only way to ask for the other one, and it stays generic: the broker does
   * not know what a channel means, only whether the caller may read it.
   */
  app.post("/api/channels/cursor", authed, async (request: AuthedRequest, response) => {
    if (!input.openCursor) { response.status(501).json({ error: "cursor opening is not enabled" }); return; }
    const body = request.body as { channels?: unknown; from?: unknown };
    const channels = Array.isArray(body.channels) ? body.channels.filter((c): c is string => typeof c === "string" && c.length > 0) : [];
    if (!channels.length) { response.status(400).json({ error: "channels is required" }); return; }
    const user = request.sessionUser!;
    if (input.authorizeChannel && !channels.every((channel) => input.authorizeChannel!(channel, user))) {
      response.status(403).json({ error: "channel does not belong to this user" });
      return;
    }
    try {
      const { token } = await input.openCursor(channels, body.from === "start" ? "start" : "now");
      response.status(201).json({ cursor: token, channels });
    } catch (error) {
      response.status(503).json({ error: error instanceof Error ? error.message : "cursor could not be opened" });
    }
  });

  // Worker output. Read-only, and only reachable once the directory exists —
  // a missing mount should surface as 404 rather than crash the broker.
  if (input.assetDir && existsSync(input.assetDir)) {
    app.use("/workspace", express.static(input.assetDir, { index: "index.html", dotfiles: "ignore" }));
  }

  const clientDir = input.clientDir;
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get("/{*path}", (_request, response) => response.sendFile(path.join(clientDir, "index.html")));
  }
  return app;
}
