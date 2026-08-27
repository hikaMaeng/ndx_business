import { parentPort } from "node:worker_threads";
import type { EventEnvelope } from "../../common/index.js";

/** The action dispatch a worker thread runs. Supplied by the deploying app, not by this library. */
export type WorkerEmit = (payload: Record<string, unknown>) => void;

/** What a handler is told about its own execution, beyond the event itself. */
export interface WorkerContext {
  /**
   * The lane the message came down, and part of the address.
   *
   * A worker watching several queues can be handed the same action twice with
   * two different jobs to do: one queue's reactor calls the model, another
   * writes a view row. The action cannot tell them apart and neither can the
   * envelope — it is the same fact. What differs is who it was addressed to,
   * which is exactly what the queue name says.
   */
  queue: string;

  /**
   * Renews the execution lease and answers whether this attempt still holds it.
   *
   * The abort signal says the same thing, but only as of the last heartbeat.
   * Between a lease expiring and the owner noticing, another worker has already
   * been told this execution was abandoned and is redoing it — so for the brief
   * moment before the signal catches up, two attempts believe they are the one.
   *
   * That does not matter for anything written with an identity, because two
   * copies of the same record collapse. It matters enormously for effects that
   * are not records: starting a process, sending a message, spending money. Ask
   * this immediately before one of those, and do not do it on a false answer.
   *
   * It is a renewal as well as a question, so asking also buys the fresh lease
   * the work about to start is going to need.
   */
  fence(): Promise<boolean>;
}

export type WorkerExecute = (event: EventEnvelope, signal: AbortSignal, emit: WorkerEmit, context: WorkerContext) => Promise<unknown>;

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

async function execute(executeHandler: WorkerExecute, event: EventEnvelope, controller: AbortController, emit: WorkerEmit, context: WorkerContext): Promise<unknown> {
  const signal = controller.signal;
  const payload = event.payload as Record<string, unknown>;
  const delayMs = typeof payload.simulateDelayMs === "number" ? payload.simulateDelayMs : 0;
  const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined;
  // A payload-driven pause, used by timeout and failure tests. The broker knows
  // no action names, so this applies uniformly rather than to a named action.
  const operation = delayMs > 0 ? delay(delayMs, signal).then(() => executeHandler(event, signal, emit, context)) : executeHandler(event, signal, emit, context);
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
  // The lease lives in the parent, so asking about it from a thread is a round
  // trip. Each question carries a number so its answer can be matched back.
  const pendingFences = new Map<string, (owned: boolean) => void>();
  let fenceSeq = 0;

  parentPort?.on("message", (message: { type: "run" | "abort" | "fence-result"; id: string; event?: EventEnvelope; queue?: string; fenceId?: string; owned?: boolean }) => {
    if (message.type === "fence-result") { pendingFences.get(message.fenceId!)?.(message.owned === true); return; }
    if (message.type === "abort") { controllers.get(message.id)?.abort(); return; }
    const controller = new AbortController();
    controllers.set(message.id, controller);
    void (async () => {
      const emit: WorkerEmit = (payload) => parentPort?.postMessage({ type: "progress", id: message.id, payload });
      const fence = (): Promise<boolean> => new Promise<boolean>((resolve) => {
        const fenceId = `${message.id}:${fenceSeq++}`;
        pendingFences.set(fenceId, (owned) => { pendingFences.delete(fenceId); resolve(owned); });
        parentPort?.postMessage({ type: "fence", id: message.id, fenceId });
      });
      const context: WorkerContext = { queue: message.queue ?? "", fence };
      try { parentPort?.postMessage({ id: message.id, ok: true, value: await execute(executeHandler, message.event!, controller, emit, context) }); }
      catch (error) { parentPort?.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : "Worker failed" }); }
      finally { controllers.delete(message.id); }
    })();
  });
}
