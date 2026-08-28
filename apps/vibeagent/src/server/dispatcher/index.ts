import { createFactDispatcher, runService } from "agent/broker";
import { REACTIONS } from "../reactions/index.js";

/**
 * The fact dispatcher: reads the log and puts a copy of each fact on the queue
 * of every reactor the table names.
 *
 * It understands none of it. The table is a map from one opaque string to a
 * list of queue names, and this role never asks what any of them mean — the
 * same discipline that lets the broker carry a domain it has never heard of.
 */
export async function startDispatcher(): Promise<void> {
  await runService(createFactDispatcher({ name: "vibe", table: REACTIONS }));
}
