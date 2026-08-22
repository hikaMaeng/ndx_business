import { parentPort } from "node:worker_threads";
import type { EventEnvelope } from "agent_domain/common";
import { executeHandler } from "agent_domain/server";

const controllers = new Map<string, AbortController>();

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

async function execute(event: EventEnvelope, controller: AbortController): Promise<unknown> {
  const signal = controller.signal;
  const payload = event.payload as Record<string, unknown>;
  const delayMs = typeof payload.simulateDelayMs === "number" ? payload.simulateDelayMs : 0;
  const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined;
  const operation = delay(delayMs, signal).then(() => executeHandler(event, signal));
  if (timeoutMs !== undefined) return withTimeout(operation, timeoutMs, controller);
  return operation;
}

parentPort?.on("message", (message: { type: "run" | "abort"; id: string; event?: EventEnvelope }) => {
  if (message.type === "abort") { controllers.get(message.id)?.abort(); return; }
  const controller = new AbortController();
  controllers.set(message.id, controller);
  void (async () => {
    try { parentPort?.postMessage({ id: message.id, ok: true, value: await execute(message.event!, controller) }); }
    catch (error) { parentPort?.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : "Worker failed" }); }
    finally { controllers.delete(message.id); }
  })();
});
