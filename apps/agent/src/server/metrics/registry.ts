/**
 * In-process operator counters for the ingress handoff.
 * Aggregate values only: no payloads, channels, or session identifiers ever enter this registry.
 */
export interface MetricsSnapshot {
  queueReads: number;
  queueMessages: number;
  queueDeletes: number;
  appendTotal: number;
  appendDuplicates: number;
  appendFailures: number;
  appendLatencyMsTotal: number;
  workerStarted: number;
  workerCompleted: number;
  workerFailed: number;
  processingFailures: number;
  processingRetries: number;
  processingJoined: number;
  processingDlqTotal: number;
  inFlight: number;
  ingressAccepted: number;
  ingressHandoffActive: number;
  processingReady: number;
  processingRunning: number;
  processingDlq: number;
  processingReadyOldestMs: number;
  processingExpiredLeases: number;
  schedulerDispatchActive: number;
  outboxPending: number;
  outboxFailed: number;
  outboxRetries: number;
  outboxDlqTotal: number;
  websocketConnections: number;
  websocketMailboxQueued: number;
  websocketDelivered: number;
  websocketProgressDropped: number;
  websocketSlowConsumerClosed: number;
  websocketReplayOverflow: number;
  websocketSendFailures: number;
  databasePoolTotal: number;
  databasePoolIdle: number;
  databasePoolWaiting: number;
  ingressQueuePoolTotal: number;
  ingressQueuePoolIdle: number;
  ingressQueuePoolWaiting: number;
  queuePoolTotal: number;
  queuePoolIdle: number;
  queuePoolWaiting: number;
  workerPoolWorkers: number;
  workerPoolBusy: number;
  workerPoolQueued: number;
}

export class MetricsRegistry {
  private readonly counters: MetricsSnapshot = {
    queueReads: 0, queueMessages: 0, queueDeletes: 0,
    appendTotal: 0, appendDuplicates: 0, appendFailures: 0, appendLatencyMsTotal: 0,
    workerStarted: 0, workerCompleted: 0, workerFailed: 0, processingFailures: 0, processingRetries: 0, processingJoined: 0, processingDlqTotal: 0, inFlight: 0,
    ingressAccepted: 0, ingressHandoffActive: 0, processingReady: 0, processingRunning: 0, processingDlq: 0, processingReadyOldestMs: 0,
    processingExpiredLeases: 0, schedulerDispatchActive: 0, outboxPending: 0, outboxFailed: 0, outboxRetries: 0, outboxDlqTotal: 0,
    websocketConnections: 0, websocketMailboxQueued: 0, websocketDelivered: 0, websocketProgressDropped: 0, websocketSlowConsumerClosed: 0, websocketReplayOverflow: 0, websocketSendFailures: 0,
    databasePoolTotal: 0, databasePoolIdle: 0, databasePoolWaiting: 0,
    ingressQueuePoolTotal: 0, ingressQueuePoolIdle: 0, ingressQueuePoolWaiting: 0,
    queuePoolTotal: 0, queuePoolIdle: 0, queuePoolWaiting: 0,
    workerPoolWorkers: 0, workerPoolBusy: 0, workerPoolQueued: 0,
  };

  increment(name: keyof MetricsSnapshot, amount = 1): void { this.counters[name] += amount; }
  setGauge(name: "processingReady" | "processingRunning" | "processingDlq" | "processingReadyOldestMs" | "processingExpiredLeases" | "schedulerDispatchActive" | "outboxPending" | "outboxFailed" | "websocketConnections" | "websocketMailboxQueued" | "databasePoolTotal" | "databasePoolIdle" | "databasePoolWaiting" | "ingressQueuePoolTotal" | "ingressQueuePoolIdle" | "ingressQueuePoolWaiting" | "queuePoolTotal" | "queuePoolIdle" | "queuePoolWaiting" | "workerPoolWorkers" | "workerPoolBusy" | "workerPoolQueued", value: number): void { this.counters[name] = value; }

  snapshot(): MetricsSnapshot & { appendLatencyMsAverage: number } {
    const appends = this.counters.appendTotal;
    return { ...this.counters, appendLatencyMsAverage: appends === 0 ? 0 : Math.round(this.counters.appendLatencyMsTotal / appends) };
  }
}
