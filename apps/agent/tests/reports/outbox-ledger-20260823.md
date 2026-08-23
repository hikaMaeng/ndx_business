# Outbox ledger durability and scale verification

Date: 2026-08-23

## Deployed configuration proof

The deploy entrypoint reconciled the existing ignored `apps/agent/docker/.env` by appending six missing template keys without replacing any existing value. Worker container inspection and authenticated Gateway `/metrics` both reported:

```json
{
  "visibilityTimeoutSeconds": 60,
  "executionLeaseSeconds": 120,
  "maxExecutionAttempts": 5,
  "maxOutboxAttempts": 10,
  "maxDeliveryReads": 5,
  "retentionDays": 30,
  "routerConcurrency": 12
}
```

The Worker internal `/metrics` endpoint returned 200 with the same token and exposed outbox retry/dead-letter counters.

## Fault injection

A real `agent_result_delivery` row was inserted with `attempts=9` and a nonexistent queue. The publisher claimed it once, PostgreSQL rejected `pgmq.q_verify_outbox_missing_dead`, and the row became:

```text
dead|10|relation "pgmq.q_verify_outbox_missing_dead" does not exist
```

Worker metrics then showed `outboxDeadLetters=1`. This proves retry exhaustion is observable and does not leave a ready/running retry loop.

## Large-ledger query plan

50,000 delivered outbox rows were retained before the query plan and workload. `EXPLAIN (ANALYZE, BUFFERS)` for `claimMany(128)` used:

```text
Index Scan using agent_result_delivery_ready_idx
Index Scan using agent_result_delivery_expired_idx
Execution Time: 0.214 ms
Buffers: shared hit=2
```

No sequential scan occurred. The ready and expired-lease paths are separate CTEs, so each partial index remains usable.

## Composite workload over the retained ledger

| Assertion | Result |
| --- | ---: |
| delay commands / worker threads / delay | 2,048 / 96 / 5,000 ms |
| joined recipients / conflicts / lease probe | 128 / 32 / 65,000 ms |
| retained delivered ledger before run | 50,000 rows |
| elapsed | 115,212 ms |
| worker-only lower bound | 110,000 ms |
| completed executions / running | 2,081 / 0 |
| terminal events expected / observed | 2,241 / 2,241 |
| command / result / Gateway queue residue | 0 / 0 / 0 |
| lease attempts / queue redeliveries | 1 / 0 |
| broker, router, terminal-persistence, outbox failure deltas | all 0 |

All fourteen WebSocket subscribers received only their expected terminal events with no duplicate.

## Cleanup

The 50,000 ledger rows, fault rows, workload prefix rows/messages/cursors, and 13 verified-empty historical Gateway queues were removed. The active stable queue `agent_gateway_agent` was retained. Stale running executions were converted to `failed/execution_abandoned`; the running count is zero. Stream counter cleanup removed 545 rows with no corresponding event. Non-test cursors were preserved.
