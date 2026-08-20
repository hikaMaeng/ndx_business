import type { WorkerActionHandler } from "./contract.js";

export const acknowledgeHandler: WorkerActionHandler = {
  name: "acknowledge",
  matches: () => true,
  async execute(event, signal) {
    if (signal.aborted) throw new Error("worker operation aborted");
    return { acknowledgedAction: event.action, payload: event.payload, worker: "agent-worker" };
  },
};
