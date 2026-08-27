import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "../../common/index.js";
import type { WorkerExecute } from "./entry.js";
import type { WorkerFence, WorkerPool, WorkerProgress, WorkerResult } from "./pool.js";

/** With no lease to ask about, a handler is always the owner. */
const ALWAYS_OWNED: WorkerFence = async () => true;

/**
 * Runs handlers on the main thread instead of in a worker thread.
 *
 * Worker threads exist to keep **CPU** work off the event loop. A handler that
 * only awaits — an inference call, a child process, a database round trip —
 * does no CPU work, so a thread buys nothing and costs a great deal: each
 * thread is its own V8 isolate, and the pool size caps how many tasks can be
 * in flight at once. An IO-bound handler pinned to a thread for a minute of
 * waiting turns `cpus × 2` into a concurrency ceiling.
 *
 * Inline execution removes that ceiling. Concurrency is then bounded by
 * `maxConcurrent`, which reflects what the downstream services can absorb
 * rather than how many cores this machine has.
 *
 * Use a thread pool when the handler computes. Use this when it waits.
 */
export function createInlinePool(execute: WorkerExecute, maxConcurrent: number): WorkerPool {
  const running = new Map<string, AbortController>();

  return {
    run(event: EventEnvelope, signal?: AbortSignal, onAssigned?: (workerId: string) => Promise<void>, onProgress?: WorkerProgress, queue = "", fence: WorkerFence = ALWAYS_OWNED): Promise<WorkerResult> {
      if (running.size >= maxConcurrent) return Promise.reject(new Error("inline worker pool is at capacity"));
      const workerId = randomUUID();
      const controller = new AbortController();
      running.set(workerId, controller);

      // The caller's signal is the ownership fence: losing the execution lease
      // must abort the handler exactly as it would in a thread.
      const onAbort = (): void => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (): void => {
        running.delete(workerId);
        signal?.removeEventListener("abort", onAbort);
      };

      return (async () => {
        await onAssigned?.(workerId);
        try {
          const value = await execute(event, controller.signal, (payload) => onProgress?.(payload), { queue, fence });
          return { value, workerId };
        } finally {
          finish();
        }
      })();
    },

    async destroy(): Promise<void> {
      for (const controller of running.values()) controller.abort();
      running.clear();
    },

    snapshot(): { workers: number; busy: number; queued: number } {
      return { workers: maxConcurrent, busy: running.size, queued: 0 };
    },
  };
}
