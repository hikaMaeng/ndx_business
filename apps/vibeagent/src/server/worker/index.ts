import { createWorkerServer, readEnv, runService } from "agent/broker";
import { createVibeWorker } from "vibeagent_domain/server";
import { GROUPS, REACTOR_QUEUES } from "../reactions/index.js";
import { maxConcurrentTurns } from "../config.js";

/**
 * The worker server: consumes reactor queues and runs one reaction per message.
 *
 * It owns no socket and answers no request. Its whole surface is the set of
 * queues it watches, which is why splitting a busy reactor onto its own process
 * is a deployment decision — name only that queue — and not a code change.
 */
export async function startWorker(): Promise<void> {
  const env = readEnv();

  const watched = process.env.AGENT_QUEUES ? env.queues : REACTOR_QUEUES;

  // Only the groups for the queues this process watches. A queue named in the
  // environment that no group answers is a wiring mistake, and it should fail
  // on the first message rather than look like an unknown action.
  const groups = Object.fromEntries(watched.filter((name) => GROUPS[name]).map((name) => [name, GROUPS[name]!]));

  await runService(createWorkerServer({
    /**
     * Inline, and on the server's own pool.
     *
     * Inline because a reactor is almost entirely waiting — an inference call,
     * or a child process. There is no CPU work to keep off the event loop, so a
     * thread would only cap concurrency at `cpus × 2` while holding a V8
     * isolate per idle reaction.
     *
     * On the server's pool because opening another to the same database would
     * make this process hold two sets of connections for one kind of traffic.
     * The reactors share whatever they are given; the process is what counts.
     */
    executeWith: (database) => createVibeWorker(database, groups),
    queues: watched,
    maxConcurrent: maxConcurrentTurns,
  }));
}
