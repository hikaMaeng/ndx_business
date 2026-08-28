import { readEnv } from "agent/broker";

/**
 * Three processes, one image, chosen by `AGENT_ROLE`.
 *
 * They are genuinely different services and share almost nothing: the gateway
 * owns a socket and answers browsers, the worker owns queue consumption and
 * runs reactors, the dispatcher owns the log cursor. They change for different
 * reasons, so they live in different folders, and this file does the only thing
 * common to all three — pick one.
 *
 * | role | folder | owns |
 * | --- | --- | --- |
 * | `gateway` (default) | `gateway/` | the socket, the client HTTP surface |
 * | `worker` | `worker/` | reactor queues, one reaction per message |
 * | `dispatcher` | `dispatcher/` | fact → reaction queue, and recovery |
 *
 * The imports are dynamic so a worker never constructs the gateway's pool or
 * its route table, and a gateway never loads the reactors.
 */
const role = readEnv().role;

if (role === "worker") {
  const { startWorker } = await import("./worker/index.js");
  await startWorker();
} else if (role === "dispatcher") {
  const { startDispatcher } = await import("./dispatcher/index.js");
  await startDispatcher();
} else {
  const { startGateway } = await import("./gateway/index.js");
  await startGateway();
}
