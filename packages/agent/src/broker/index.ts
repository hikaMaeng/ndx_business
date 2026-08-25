/**
 * Domain-neutral event broker runtime: PGMQ transport, durable event store,
 * execution claim/lease, transactional outboxes, and the Gateway socket
 * projection. It carries no coding-agent vocabulary — an app supplies the
 * action registry and its own composition root.
 *
 * See docs/architecture.md#src-broker for the folder map.
 */
export { createWebBackend, type WebBackendInput } from "./http/app.js";
export { createSessionVerifier, requireSession, readBearer, type AuthenticatedUser, type AuthedRequest } from "./auth/index.js";
export { createSocketPolicy, type SocketPolicyInput } from "./policy/index.js";
export { createEventBroker, createResultRouter, createWorkerServer, runService, type Service, type EventBrokerOptions, type ResultRouterOptions, type WorkerServerOptions } from "./service/index.js";
export { createDatabasePool, snapshotDatabasePool, type DatabasePoolSnapshot } from "./database.js";
export { readEnv, type AgentEnv } from "./env.js";

export { nextReadBackoff, wait } from "./loops/backoff.js";
export { startGatewayDelivery, type BrokerLoop } from "./loops/gateway-delivery.js";
export { startResultRouter } from "./loops/result-router.js";
export { startWorkerConsumer, terminalPersistenceVisibilitySeconds } from "./loops/worker-consumer.js";

export { DeliveryStore, type DeliveryClaim } from "./delivery/store.js";
export { startDeliveryPublisher, type DeliveryPublisher } from "./delivery/publisher.js";
export { DeliveryNotifier } from "./delivery/notifier.js";

export { EventStore } from "./event-store/store.js";
export { GatewayOutboxStore } from "./gateway-outbox/store.js";
export { ExecutionStore, type ExecutionClaim, type ResultPayload } from "./idempotency/store.js";
export { GatewaySubscriptionStore, type GatewayClaim } from "./subscription/store.js";

export { closeHttpServer, shutdownGateway } from "./gateway/lifecycle/index.js";
export { createGatewayStandby, type GatewayStandby } from "./gateway/standby/index.js";

export { toEventDraft, toResultDraft, toProgressDraft, toProcessingFailureDraft } from "./ingress/event-draft.js";
export { MetricsRegistry, type MetricsSnapshot } from "./metrics/registry.js";
export { writeMetrics } from "./metrics/endpoint.js";
export { PgmqClient } from "./pgmq/client.js";
export type { EventQueueMessage, EventQueueTransport } from "./queue/transport.js";

export { EventStreamHub, type StreamEvent } from "./stream/hub.js";
export { ConnectionMailbox } from "./stream/mailbox/index.js";
export { ReplayBuffer, type ReplayBufferOutcome } from "./stream/replay-buffer/index.js";
export { attachWebSocketTransport, type GatewayWebSocketTransport, type GatewaySocketPolicy } from "./transport/websocket.js";

export { createInlinePool } from "./worker/inline.js";
export { createWorkerPool, runWorker, WorkerLostError, type WorkerPool, type WorkerResult, type WorkerProgress } from "./worker/pool.js";
export { startWorkerEntry, type WorkerExecute, type WorkerEmit } from "./worker/entry.js";
