// Deep subpath, not the broker barrel: a worker thread must not pull pg,
// express, or ws into its bundle.
import { startWorkerEntry } from "agent/broker/worker";
import { executeHandler } from "vibeagent_domain/server";

// The broker owns the worker-thread message loop; this app owns which actions
// it can run. The registry holds exactly one action: vibe.turn.run.
startWorkerEntry(executeHandler);
