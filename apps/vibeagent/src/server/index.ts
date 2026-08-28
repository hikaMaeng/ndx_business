import { readEnv } from "agent/broker";

/**
 * Two processes, one image, chosen by `AGENT_ROLE`.
 *
 * | role | folder | is |
 * | --- | --- | --- |
 * | `broker` (default) | `broker/` | the event broker: socket, client HTTP, fact dispatch |
 * | `worker` | `worker/` | a worker server: the queues it is given, one reaction per message |
 *
 * There were three. A `dispatcher` role ran the fact dispatch on its own, which
 * made a third kind of server out of something that is half of the broker's
 * job — and it was the `router` container, removed two days earlier, returning
 * under another name. Recording a fact and deciding who should hear about it
 * belong together.
 *
 * Which queues a worker watches is `AGENT_QUEUES`, so running one worker for
 * everything or one per kind is a deployment decision and not a change here.
 *
 * The imports are dynamic so a worker never constructs the broker's pool or its
 * route table, and a broker never loads the reactors.
 */
const role = readEnv().role;

if (role === "worker") {
  const { startWorker } = await import("./worker/index.js");
  await startWorker();
} else {
  const { startBroker } = await import("./broker/index.js");
  await startBroker();
}
