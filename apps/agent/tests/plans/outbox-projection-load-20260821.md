# Outbox projection load plan

## Objective

Prove the deployed Agent drains a large multi-channel request/result workload through the durable processing, outbox, and projection paths. Drain alone is insufficient: every submitted request must have one terminal result, a published outbox row, and no residual operational backlog.

## Environment

- deployed `agent` at `http://127.0.0.1:18081`
- host CPU count 48; default `AGENT_MAX_THREADS=96`
- metrics endpoint authenticated with the local deployment token

## Scenario

1. Submit 2,048 `test.delay` commands at 96 HTTP submitters, four ingress channels, 512 streams, and a unique prefix.
2. Each worker waits 5,000 ms before returning a terminal result.
3. Poll metrics until `workerCompleted` increases by 2,048 and processing/outbox/in-flight gauges all reach zero.
4. Compare elapsed time with `ceil(2048 / 96) * 5,000 = 110,000 ms`; allow 15,000 ms scheduler/egress overhead.
5. Query the prefix for command/result cardinality, published outbox rows, and result-queue messages; then delete only those scoped rows/messages.

## Pass criteria

- 2,048 accepted commands and 2,048 completed workers, zero worker failures.
- settle time at or below 125,000 ms.
- `processingReady`, `processingRunning`, `inFlight`, `outboxPending`, and `outboxFailed` are zero.
- 2,048 terminal result events, 2,048 published outbox rows, and 2,048 result-queue messages for the prefix.
