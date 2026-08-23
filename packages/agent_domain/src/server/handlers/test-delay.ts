import type { WorkerActionHandler } from "./contract.js";

/** Benchmark-only action: makes worker-capacity measurements comparable and repeatable. */
export const testDelayHandler: WorkerActionHandler = {
  name: "test.delay",
  matches: (action) => action === "test.delay",
  async execute(event, signal) {
    const requested = Number(event.payload.simulateDelayMs);
    // Benchmark tests deliberately need to cross the broker visibility timeout.
    const delayMs = Number.isFinite(requested) ? Math.max(1, Math.min(120_000, Math.floor(requested))) : 5_000;
    await wait(delayMs, signal);
    return { delayedMs: delayMs };
  },
};
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("worker operation aborted")); }, { once: true });
  });
}
