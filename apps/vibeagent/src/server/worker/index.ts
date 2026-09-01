import { createWorkerServer, readEnv, runService } from "agent/broker";
import { createVibeWorker } from "vibeagent_domain/server";
import { findProject, resolveInference, resolvePolicy } from "admin_domain/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GROUPS, REACTOR_QUEUES } from "../reactions/index.js";
import { maxConcurrentTurns, workspaceRoot } from "../config.js";

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
    executeWith: (database) => createVibeWorker(database, groups, async (userId, workspace) => {
      /**
       * What this session may use, answered from the one database.
       *
       * The account service owns the answer and its tables are in the same
       * PostgreSQL, on this pool's search path — so the question costs a query
       * rather than a service call and a credential the worker does not have.
       * A worker only ever receives a verified `userId`; the broker stamps it
       * over whatever the client sent.
       *
       * A project with no record — one made before projects had them — resolves
       * to nothing rather than failing. A session should open.
       */
      const name = workspace.split("/").slice(1).join("/");
      const project = name ? await findProject(database, userId, name) : null;
      const ask = async (kind: "skill" | "mcp") => project
        ? resolvePolicy(database, {
            ownerId: userId,
            organizationId: project.organizationId,
            projectId: project.id,
            kind,
          })
        : [];
      // Both in one moment. A session that took its skills from one merge and
      // its servers from another is a session nobody configured.
      const [entries, mcpEntries] = await Promise.all([ask("skill"), ask("mcp")]);
      const inference = await resolveInference(database, project?.organizationId ?? null);

      // The project's own instructions. Merging an organisation's on top of
      // these is the next thing this wants; today it is the file or nothing.
      let agents = "";
      try { agents = await readFile(path.join(workspaceRoot, workspace, "AGENTS.md"), "utf8"); }
      catch { /* most projects have none, and that is not a failure */ }

      return {
        baseVersion: project ? "policy" : "builtin",
        // The origin travels with the entry: it says which layer's copy won,
        // and the bundles are stored per layer, so it is also where the files
        // are. Dropping it here would leave the session with a list of names
        // and no way to reach any of them.
        skills: entries.map((entry) => ({ name: entry.name, enabled: entry.enabled, value: entry.value, origin: entry.origin })),
        mcp: mcpEntries.map((entry) => ({ name: entry.name, enabled: entry.enabled, value: entry.value })),
        // Which model, resolved from the project.s organisation upwards. A
        // project outside any organisation, or one whose chain configures
        // nothing, gets the deployment default.
        ...(inference ? { inference } : {}),
        agents,
      };
    }),
    queues: watched,
    maxConcurrent: maxConcurrentTurns,
  }));
}
