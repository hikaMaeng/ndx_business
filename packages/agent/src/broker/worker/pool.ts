import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { EventEnvelope } from "../../common/index.js";

export interface WorkerResult { value: unknown; workerId: string; }
export type WorkerProgress = (payload: Record<string, unknown>) => void;
/** Answers whether the calling attempt still owns the execution, renewing it in passing. */
export type WorkerFence = () => Promise<boolean>;
export interface WorkerPool { run(event: EventEnvelope, signal?: AbortSignal, onAssigned?: (workerId: string) => Promise<void>, onProgress?: WorkerProgress, queue?: string, fence?: WorkerFence): Promise<WorkerResult>; destroy(): Promise<void>; snapshot?(): { workers: number; busy: number; queued: number }; }

/** A process-level worker loss is retryable; action failures are returned by the worker itself. */
export class WorkerLostError extends Error {
  constructor(message: string) { super(message); this.name = "WorkerLostError"; }
}

export function runWorker(pool: WorkerPool, event: EventEnvelope, signal?: AbortSignal, onAssigned?: (workerId: string) => Promise<void>, onProgress?: WorkerProgress, queue?: string, fence?: WorkerFence): Promise<WorkerResult> { return pool.run(event, signal, onAssigned, onProgress, queue, fence); }

interface PendingTask { id: string; event: EventEnvelope; queue: string; fence?: WorkerFence; signal?: AbortSignal; onAssigned?: (workerId: string) => Promise<void>; onProgress?: WorkerProgress; resolve: (result: WorkerResult) => void; reject: (error: Error) => void; abort?: () => void; }
interface WorkerSlot { worker: Worker; workerId: string; busy: boolean; retired: boolean; task?: PendingTask; }

/**
 * `workerUrl` is required: the entry module belongs to the deploying app, so
 * resolving it relative to this library would bind the pool to one app's build
 * layout.
 */
export function createWorkerPool(options: { minWorkerThreads: number; maxWorkerThreads: number; maxQueue: number; workerUrl: URL }): WorkerPool {
  const slots: WorkerSlot[] = [];
  const queue: PendingTask[] = [];
  const workerUrl = options.workerUrl;

  const dispatch = async (): Promise<void> => {
    while (slots.length < options.minWorkerThreads && slots.length < options.maxWorkerThreads) slots.push(createSlot());
    for (const slot of slots) {
      if (slot.busy) continue;
      const task = queue.shift();
      if (!task) return;
      slot.busy = true;
      slot.task = task;
      try { await task.onAssigned?.(slot.workerId); }
      catch (error) {
        slot.task = undefined;
        slot.busy = false;
        task.reject(error instanceof Error ? error : new Error(String(error)));
        continue;
      }
      if (slot.retired || slot.task !== task) continue;
      slot.worker.postMessage({ type: "run", id: task.id, event: task.event, queue: task.queue });
      task.abort = () => slot.worker.postMessage({ type: "abort", id: task.id });
      if (task.signal?.aborted) task.abort();
      else task.signal?.addEventListener("abort", task.abort, { once: true });
    }
    if (queue.length > 0 && slots.length < options.maxWorkerThreads) {
      slots.push(createSlot());
      void dispatch();
    }
  };
  const createSlot = (): WorkerSlot => {
    const worker = new Worker(workerUrl);
    const slot: WorkerSlot = { worker, workerId: randomUUID(), busy: false, retired: false };
    worker.on("message", (message: { id: string; ok: boolean; value?: unknown; error?: string; type?: string; payload?: Record<string, unknown>; fenceId?: string }) => {
      if (!slot.task || slot.task.id !== message.id) return;
      // Progress is an observation, not a completion: the slot stays busy and
      // the task is not resolved.
      if (message.type === "progress") { slot.task.onProgress?.(message.payload ?? {}); return; }
      // The lease lives out here, so a thread has to ask. A pool with no fence
      // configured answers "yours", which is the same thing an unfenced inline
      // handler is told.
      if (message.type === "fence") {
        const task = slot.task;
        const answer = task.fence ? task.fence() : Promise.resolve(true);
        void answer
          .catch(() => false)
          .then((owned) => { if (!slot.retired) worker.postMessage({ type: "fence-result", id: task.id, fenceId: message.fenceId, owned }); });
        return;
      }
      const task = slot.task;
      slot.task = undefined;
      slot.busy = false;
      task.signal?.removeEventListener("abort", task.abort!);
      if (message.ok) task.resolve({ value: message.value, workerId: slot.workerId });
      else task.reject(new Error(message.error ?? "Worker failed"));
      void dispatch();
    });
    worker.on("error", (error) => {
      if (slot.retired) return;
      slot.retired = true;
      if (slot.task) {
        slot.task.signal?.removeEventListener("abort", slot.task.abort!);
        slot.task.reject(new WorkerLostError(error instanceof Error ? error.message : String(error)));
      }
      slot.task = undefined;
      slot.busy = false;
      void replaceSlot(slot);
    });
    worker.on("exit", (code) => {
      if (slot.retired) return;
      slot.retired = true;
      if (slot.task) {
        slot.task.signal?.removeEventListener("abort", slot.task.abort!);
        slot.task.reject(new WorkerLostError(`worker exited with code ${code}`));
      }
      slot.task = undefined;
      slot.busy = false;
      void replaceSlot(slot);
    });
    return slot;
  };
  const replaceSlot = async (slot: WorkerSlot): Promise<void> => {
    const index = slots.indexOf(slot);
    if (index < 0) return;
    await slot.worker.terminate();
    slots[index] = createSlot();
    console.log(JSON.stringify({ event: "worker.replaced", workerThreads: slots.length }));
    void dispatch();
  };
  console.log(JSON.stringify({ event: "worker.pool.started", minWorkerThreads: options.minWorkerThreads, maxWorkerThreads: options.maxWorkerThreads, maxQueue: options.maxQueue }));
  void dispatch();

  return {
    run(event: EventEnvelope, signal?: AbortSignal, onAssigned?: (workerId: string) => Promise<void>, onProgress?: WorkerProgress, from = "", fence?: WorkerFence): Promise<WorkerResult> {
      if (queue.length >= options.maxQueue) return Promise.reject(new Error("Agent worker queue is full"));
      return new Promise<WorkerResult>((resolve, reject) => { queue.push({ id: randomUUID(), event, queue: from, fence, signal, onAssigned, onProgress, resolve, reject }); void dispatch(); });
    },
    async destroy(): Promise<void> {
      for (const task of queue.splice(0)) task.reject(new Error("Worker pool stopped"));
      for (const slot of slots) {
        slot.retired = true;
        if (slot.task) {
          slot.task.signal?.removeEventListener("abort", slot.task.abort!);
          slot.task.reject(new WorkerLostError("worker pool stopped"));
          slot.task = undefined;
          slot.busy = false;
        }
      }
      await Promise.all(slots.map((slot) => slot.worker.terminate()));
    },
    snapshot(): { workers: number; busy: number; queued: number } { return { workers: slots.length, busy: slots.filter((slot) => slot.busy).length, queued: queue.length }; },
  };
}
