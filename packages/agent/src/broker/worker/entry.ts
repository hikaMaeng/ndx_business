import { parentPort } from "node:worker_threads";
import type { EventEnvelope } from "../../common/index.js";

/** The action dispatch a worker thread runs. Supplied by the deploying app, not by this library. */
export type WorkerEmit = (payload: Record<string, unknown>) => void;
export type WorkerExecute = (event: EventEnvelope, signal: AbortSignal, emit: WorkerEmit) => Promise<unknown>;

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("worker operation aborted")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.max(0, milliseconds));
    const abort = () => { clearTimeout(timer); reject(new Error("worker operation aborted")); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(`simulated timeout after ${timeoutMs}ms`)); }, timeoutMs);
  });
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

async function execute(executeHandler: WorkerExecute, event: EventEnvelope, controller: AbortController, emit: WorkerEmit): Promise<unknown> {
  const signal = controller.signal;
  const payload = event.payload as Record<string, unknown>;
  const delayMs = typeof payload.simulateDelayMs === "number" ? payload.simulateDelayMs : 0;
  const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined;
  // A payload-driven pause, used by timeout and failure tests. The broker knows
  // no action names, so this applies uniformly rather than to a named action.
  const operation = delayMs > 0 ? delay(delayMs, signal).then(() => executeHandler(event, signal, emit)) : executeHandler(event, signal, emit);
  if (timeoutMs !== undefined) return withTimeout(operation, timeoutMs, controller);
  return operation;
}

/**
 * Runs the worker-thread message loop. The deploying app owns the entry module
 * that calls this, so a second app can reuse the whole broker with its own
 * action registry and nothing else changes.
 */
export function startWorkerEntry(executeHandler: WorkerExecute): void {
  const controllers = new Map<string, AbortController>();
  parentPort?.on("message", (message: { type: "run" | "abort"; id: string; event?: EventEnvelope }) => {
    if (message.type === "abort") { controllers.get(message.id)?.abort(); return; }
    const controller = new AbortController();
    controllers.set(message.id, controller);
    void (async () => {
      const emit: WorkerEmit = (payload) => parentPort?.postMessage({ type: "progress", id: message.id, payload });
      try { parentPort?.postMessage({ id: message.id, ok: true, value: await execute(executeHandler, message.event!, controller, emit) }); }
      catch (error) { parentPort?.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : "Worker failed" }); }
      finally { controllers.delete(message.id); }
    })();
  });
}
