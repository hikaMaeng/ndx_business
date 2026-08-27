# Graceful shutdown and pool-observability report

## Environment

- Deployed Agent image: `sha256:4441026c0dede80734c33cb6f22d146adc83dcf72167f6d5036c2c26c62359a7`.
- Agent health and readiness: HTTP 200.
- `AGENT_SHUTDOWN_GRACE_MS`: 30,000 ms.

## Monitoring check

Authenticated `GET /metrics` returned the separate durable, ingress-reader, and queue-writer pool gauges. The observed values were `databasePoolWaiting=0`, `ingressQueuePoolWaiting=0`, and `queuePoolWaiting=0`; 32 ingress-reader connections were intentionally long-polling, so their `idle=0` is expected rather than saturation.

## Drain scenario

1. Submitted one uniquely scoped `test.delay` command with `simulateDelayMs=5,000` and waited until `inFlight=1`.
2. Sent SIGTERM to the Agent container while that worker was running.
3. Observed `agent.shutdown.started` followed by `agent.shutdown.completed` with `drained=true`.
4. Queried the immutable store and execution projection before cleanup.

| Check | Observed |
| --- | --- |
| Canonical command | sequence 1 |
| Terminal result | sequence 2, `ok=true` |
| Execution projection | `completed`, attempts 1, `ok=true` |
| Shutdown log | completed with `drained=true` |

The Compose service does not use an automatic restart policy, so the test intentionally ended the container after successful drain; the official `npm run deploy agent` path then recreated it and `/health` returned HTTP 200.

## Cleanup

All rows and PGMQ result messages for `shutdown-proof-1787253985518` were deleted by exact transaction key and verified at zero. The historical `squat-tx-1787241834` test DLQ row was also removed by its exact test transaction key; `/metrics` then reported `processingDlq=0`, `processingReady=0`, `processingRunning=0`, `outboxPending=0`, and `outboxFailed=0`.
