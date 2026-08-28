/**
 * Domain-neutral event broker runtime: a PGMQ command queue for work, an
 * append-only event log for facts, execution claim/lease, and the socket
 * projection that tails that log. It carries no coding-agent vocabulary — an
 * app supplies the action registry and its own composition root.
 *
 * See docs/architecture.md#src-broker for the folder map.
 */
export { createWebBackend, type WebBackendInput } from "./http/app.js";
export { createSessionVerifier, requireSession, readBearer, type AuthenticatedUser, type AuthedRequest } from "./auth/index.js";
export { createSocketPolicy, type SocketPolicyInput } from "./policy/index.js";
export { createEventBroker, createFactDispatcher, createWorkerServer, runService, type Service, type EventBrokerOptions, type FactDispatcherOptions, type WorkerServerOptions } from "./service/index.js";
export { createDatabasePool, snapshotDatabasePool, type DatabasePoolSnapshot } from "./database.js";
export { readEnv, type AgentEnv } from "./env.js";

export { nextReadBackoff, wait } from "./loops/backoff.js";
export { startEventLogTail, type BrokerLoop } from "./loops/log-tail.js";
export { startFactDispatcher, type ReactionTable } from "./loops/fact-dispatcher.js";
export { startWorkerConsumer, terminalPersistenceVisibilitySeconds } from "./loops/worker-consumer.js";

export { CoalescedWakeup } from "./loops/notifier.js";

export { EventStore } from "./event-store/store.js";
export { EventLogListener, EVENT_LOG_NOTIFY_CHANNEL } from "./event-store/notify.js";
export { ExecutionStore, type ExecutionClaim, type ResultPayload } from "./idempotency/store.js";

export { closeHttpServer, shutdownGateway } from "./gateway/lifecycle/index.js";
export { createGatewayStandby, type GatewayStandby } from "./gateway/standby/index.js";

export { toEventDraft, toResultDraft, toProgressDraft, toProcessingFailureDraft } from "./ingress/event-draft.js";
export { MetricsRegistry, type MetricsSnapshot } from "./metrics/registry.js";
export { writeMetrics } from "./metrics/endpoint.js";
export { PgmqClient } from "./pgmq/client.js";
export type { EventQueueMessage, EventQueueTransport } from "./queue/transport.js";

export { EventStreamHub } from "./stream/hub.js";
export { ConnectionMailbox } from "./stream/mailbox/index.js";
export { ReplayBuffer, type ReplayBufferOutcome } from "./stream/replay-buffer/index.js";
export { attachWebSocketTransport, type GatewayWebSocketTransport, type GatewaySocketPolicy } from "./transport/websocket.js";

export { createInlinePool } from "./worker/inline.js";
export { createWorkerPool, runWorker, WorkerLostError, type WorkerPool, type WorkerResult, type WorkerProgress } from "./worker/pool.js";
export { startWorkerEntry, type WorkerExecute, type WorkerEmit } from "./worker/entry.js";
