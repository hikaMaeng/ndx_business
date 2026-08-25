// Deep subpath, not the broker barrel: a worker thread must not pull pg,
// express, or ws into its bundle.
import { startWorkerEntry } from "agent_domain/broker/worker";
import { executeHandler } from "agent_domain/server";

// The broker owns the worker-thread message loop; this app owns which actions
// it can run. A second app reuses the same broker by binding its own registry here.
startWorkerEntry(executeHandler);
