import { readEnv, createEventBroker, createResultRouter, createWorkerServer, runService } from "agent/broker";
import { VIBE_TURN_ACTION } from "vibeagent_domain/common";

/**
 * vibeagent runs three services from one image, chosen by `AGENT_ROLE`.
 *
 * Only one of them is this project's own work. The event broker and the result
 * router arrive finished — this file connects them and launches them. The
 * worker server arrives as a frame with one hole, and `worker-entry.ts` fills
 * it with the vibe coding registry.
 */
const env = readEnv();

if (env.role === "worker") {
  // The worker module is this app's own bundle, emitted next to this file.
  await runService(createWorkerServer({ worker: new URL("./worker.js", import.meta.url) }));
} else if (env.role === "router") {
  await runService(createResultRouter());
} else {
  await runService(createEventBroker({
    // Configuration, not implementation: the broker never learns what this does.
    allowedActions: [VIBE_TURN_ACTION],
    accountBaseUrl: process.env.VIBE_ACCOUNT_BASE_URL ?? "http://admin:18080",
    sessionCacheMs: Number(process.env.VIBE_SESSION_CACHE_MS ?? 5_000),
    replyChannelFor: (sessionId) => `vibe.${sessionId}`,
    clientDir: process.env.VIBE_CLIENT_DIR ?? "/client",
    assetDir: process.env.VIBE_WORKSPACE_ROOT ?? "/workspace",
  }));
}
