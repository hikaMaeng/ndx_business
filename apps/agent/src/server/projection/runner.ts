import type { MetricsRegistry } from "../metrics/registry.js";
import { projectionNames, type ProjectionStore } from "./store.js";

export type ProjectionLoop = { stop: () => void };

export function startProjectionRunners(input: { store: ProjectionStore; metrics: MetricsRegistry; idleMs: number }): ProjectionLoop {
  let stopped = false;
  for (const projection of projectionNames) void (async () => { while (!stopped) {
    try { if (await input.store.applyBatch(projection)) continue; }
    catch (error) { input.metrics.increment("processingFailures"); console.error(JSON.stringify({ event: "projection.failed", projection, error: error instanceof Error ? error.message : String(error) })); }
    await new Promise((resolve) => setTimeout(resolve, input.idleMs));
  } })();
  return { stop: () => { stopped = true; } };
}
