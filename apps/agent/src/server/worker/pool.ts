import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { EventEnvelope } from "agent_domain/common";

export interface WorkerResult { value: unknown; }
export interface WorkerPool { run(event: EventEnvelope, signal?: AbortSignal): Promise<WorkerResult>; destroy(): Promise<void>; }

export function runWorker(pool: WorkerPool, event: EventEnvelope, signal?: AbortSignal): Promise<WorkerResult> { return pool.run(event, signal); }

interface PendingTask { id: string; event: EventEnvelope; signal?: AbortSignal; resolve: (result: WorkerResult) => void; reject: (error: Error) => void; abort?: () => void; }
interface WorkerSlot { worker: Worker; busy: boolean; retired: boolean; task?: PendingTask; }

export function createWorkerPool(options: { minWorkerThreads: number; maxWorkerThreads: number; maxQueue: number; workerUrl?: URL }): WorkerPool {
  const slots: WorkerSlot[] = [];
  const queue: PendingTask[] = [];
  const workerUrl = options.workerUrl ?? new URL("./worker.js", import.meta.url);

  const dispatch = (): void => {
    while (slots.length < options.minWorkerThreads && slots.length < options.maxWorkerThreads) slots.push(createSlot());
    for (const slot of slots) {
      if (slot.busy) continue;
      const task = queue.shift();
      if (!task) return;
      slot.busy = true;
      slot.task = task;
      slot.worker.postMessage({ type: "run", id: task.id, event: task.event });
      task.abort = () => slot.worker.postMessage({ type: "abort", id: task.id });
      if (task.signal?.aborted) task.abort();
      else task.signal?.addEventListener("abort", task.abort, { once: true });
    }
    if (queue.length > 0 && slots.length < options.maxWorkerThreads) {
      slots.push(createSlot());
      dispatch();
    }
  };
  const createSlot = (): WorkerSlot => {
    const worker = new Worker(workerUrl);
    const slot: WorkerSlot = { worker, busy: false, retired: false };
    worker.on("message", (message: { id: string; ok: boolean; value?: unknown; error?: string }) => {
      if (!slot.task || slot.task.id !== message.id) return;
      const task = slot.task;
      slot.task = undefined;
      slot.busy = false;
      task.signal?.removeEventListener("abort", task.abort!);
      if (message.ok) task.resolve({ value: message.value });
      else task.reject(new Error(message.error ?? "Worker failed"));
      dispatch();
    });
    worker.on("error", (error) => {
      if (slot.retired) return;
      slot.retired = true;
      if (slot.task) slot.task.reject(error instanceof Error ? error : new Error(String(error)));
      slot.task = undefined;
      slot.busy = false;
      void replaceSlot(slot);
    });
    worker.on("exit", (code) => {
      if (slot.retired) return;
      slot.retired = true;
      if (slot.task) slot.task.reject(new Error(`worker exited with code ${code}`));
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
    dispatch();
  };
  console.log(JSON.stringify({ event: "worker.pool.started", minWorkerThreads: options.minWorkerThreads, maxWorkerThreads: options.maxWorkerThreads, maxQueue: options.maxQueue }));

  return {
    run(event: EventEnvelope, signal?: AbortSignal): Promise<WorkerResult> {
      if (queue.length >= options.maxQueue) return Promise.reject(new Error("Agent worker queue is full"));
      return new Promise<WorkerResult>((resolve, reject) => { queue.push({ id: randomUUID(), event, signal, resolve, reject }); dispatch(); });
    },
    async destroy(): Promise<void> {
      for (const task of queue.splice(0)) task.reject(new Error("Worker pool stopped"));
      for (const slot of slots) slot.retired = true;
      await Promise.all(slots.map((slot) => slot.worker.terminate()));
    },
  };
}
