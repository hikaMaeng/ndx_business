/**
 * Worker-thread surface only. Kept separate from the broker barrel so a worker
 * bundle never pulls in pg, express, or ws.
 */
export { startWorkerEntry, type WorkerExecute } from "./entry.js";
export { createWorkerPool, runWorker, WorkerLostError, type WorkerPool, type WorkerResult } from "./pool.js";
