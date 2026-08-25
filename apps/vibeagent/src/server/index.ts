import { readEnv, createEventBroker, createResultRouter, createWorkerServer, runService } from "agent/broker";
import { VIBE_TURN_ACTION } from "vibeagent_domain/common";
import { executeHandler } from "vibeagent_domain/server";

/**
 * vibeagent runs three services from one image, chosen by `AGENT_ROLE`.
 *
 * The event broker and the result router arrive finished — this file connects
 * them and launches them. The worker server arrives as a frame, and the hole is
 * filled with this project's own handler.
 */
const env = readEnv();

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
} else if (env.role === "router") {
  await runService(createResultRouter());
} else {
  await runService(createEventBroker({
    // Configuration, not implementation: the broker never learns what this does.
    allowedActions: [VIBE_TURN_ACTION],
    accountBaseUrl: process.env.VIBE_ACCOUNT_BASE_URL ?? "http://admin:18080",
    sessionCacheMs: Number(process.env.VIBE_SESSION_CACHE_MS ?? 5_000),
    replyChannelFor: (sessionId) => `vibe.${sessionId}`,
    clientDir: process.env.VIBE_CLIENT_DIR ?? "/app/dist/front",
    assetDir: process.env.VIBE_WORKSPACE_ROOT ?? "/workspace",
  }));
}
