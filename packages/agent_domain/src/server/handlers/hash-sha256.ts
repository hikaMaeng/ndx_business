import { createHash } from "node:crypto";
import type { WorkerActionHandler } from "./contract.js";

export const hashSha256Handler: WorkerActionHandler = {
  name: "hash.sha256",
  matches: (action) => action === "hash.sha256",
  async execute(event, signal) {
    if (signal.aborted) throw new Error("worker operation aborted");
    return createHash("sha256").update(String(event.payload.input ?? "")).digest("hex");
  },
};
