/**
 * What the metrics endpoint answers with.
 *
 * Served over HTTP and read from outside this process, so the shape is a
 * contract rather than a private counter bag. It lived next to the registry
 * that fills it in — which is where it is produced, not where it belongs once
 * both sides of a wire have to agree on it.
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
  /** Facts nothing ever reacted to, found by age and sent again. Should stay at zero. */
  factDispatchRecovered: number;
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
