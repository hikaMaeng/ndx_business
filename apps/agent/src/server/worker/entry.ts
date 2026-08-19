import { createHash } from "node:crypto";
import { parentPort } from "node:worker_threads";
import type { AgentEvent } from "agent_domain/common";

const controllers = new Map<string, AbortController>();

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(`simulated timeout after ${timeoutMs}ms`)); }, timeoutMs);
  });
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

async function execute(event: AgentEvent, controller: AbortController): Promise<unknown> {
  const signal = controller.signal;
  const payload = event.payload as Record<string, unknown>;
  const delayMs = typeof payload.simulateDelayMs === "number" ? payload.simulateDelayMs : 0;
  const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined;
  const operation = (async () => {
    const steps = Math.max(1, Math.ceil(delayMs / 10));
    for (let step = 0; step < steps; step += 1) {
      if (signal.aborted) throw new Error("worker operation aborted");
      await delay(delayMs > 0 ? 10 : 0);
    }
    if (event.action === "hash.sha256") return createHash("sha256").update(String(event.payload.input ?? "")).digest("hex");
    return { acknowledgedAction: event.action, payload: event.payload, worker: "agent-worker" };
  })();
  if (timeoutMs !== undefined) return withTimeout(operation, timeoutMs, controller);
  return operation;
}

parentPort?.on("message", (message: { type: "run" | "abort"; id: string; event?: AgentEvent }) => {
  if (message.type === "abort") { controllers.get(message.id)?.abort(); return; }
  const controller = new AbortController();
  controllers.set(message.id, controller);
  void (async () => {
    try { parentPort?.postMessage({ id: message.id, ok: true, value: await execute(message.event!, controller) }); }
    catch (error) { parentPort?.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : "Worker failed" }); }
    finally { controllers.delete(message.id); }
  })();
});
