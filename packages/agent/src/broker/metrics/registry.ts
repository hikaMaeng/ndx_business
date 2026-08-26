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
  processingJoined: number;
  ingressAccepted: number;
  brokerReadFailures: number;
  logTailReads: number;
  logTailEvents: number;
  logTailFailures: number;
  factDispatchReads: number;
  factDispatchSends: number;
  factDispatchFailures: number;
  processingDlqTotal: number;
  queueVisibilityRenewFailures: number;
  terminalPersistenceRetries: number;
  terminalPersistenceAlerts: number;
  expiredExecutionLeases: number;
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
  queuePoolTotal: number;
  queuePoolIdle: number;
  queuePoolWaiting: number;
}

export class MetricsRegistry {
  private readonly counters: MetricsSnapshot = {
    queueReads: 0, queueMessages: 0, queueDeletes: 0,
    appendTotal: 0, appendDuplicates: 0, appendFailures: 0, appendLatencyMsTotal: 0,
    workerStarted: 0, workerCompleted: 0, workerFailed: 0, processingFailures: 0, processingJoined: 0,
    ingressAccepted: 0, brokerReadFailures: 0, logTailReads: 0, logTailEvents: 0, logTailFailures: 0, factDispatchReads: 0, factDispatchSends: 0, factDispatchFailures: 0, processingDlqTotal: 0, queueVisibilityRenewFailures: 0,
    terminalPersistenceRetries: 0, terminalPersistenceAlerts: 0, expiredExecutionLeases: 0,
    websocketConnections: 0, websocketMailboxQueued: 0, websocketDelivered: 0, websocketProgressDropped: 0, websocketSlowConsumerClosed: 0, websocketReplayOverflow: 0, websocketSendFailures: 0,
    databasePoolTotal: 0, databasePoolIdle: 0, databasePoolWaiting: 0,
    queuePoolTotal: 0, queuePoolIdle: 0, queuePoolWaiting: 0,
  };

  increment(name: keyof MetricsSnapshot, amount = 1): void { this.counters[name] += amount; }
  setGauge(name: "websocketConnections" | "websocketMailboxQueued" | "expiredExecutionLeases" | "databasePoolTotal" | "databasePoolIdle" | "databasePoolWaiting" | "queuePoolTotal" | "queuePoolIdle" | "queuePoolWaiting", value: number): void { this.counters[name] = value; }

  snapshot(): MetricsSnapshot & { appendLatencyMsAverage: number } {
    const appends = this.counters.appendTotal;
    return { ...this.counters, appendLatencyMsAverage: appends === 0 ? 0 : Math.round(this.counters.appendLatencyMsTotal / appends) };
  }
}
