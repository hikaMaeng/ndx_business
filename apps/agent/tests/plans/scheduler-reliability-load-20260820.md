# Test Plan: scheduler-reliability-load

## Goal

Prove the deployed Agent's lease fencing, bounded retry/DLQ, and many-client worker throughput against PostgreSQL and dedicated PGMQ queues.

## Environment

- Deploy with `npm run deploy agent`.
- Load-only env: `AGENT_QUEUE=agent_load_requests`, `AGENT_RESULT_QUEUE=agent_load_results`, `AGENT_INGRESS_CONSUMERS=32`, `AGENT_MIN_THREADS=96`, `AGENT_MAX_THREADS=96`, `AGENT_MAX_QUEUE=512`, `AGENT_DATABASE_POOL_MAX=48`.
- `test.delay`: 2,048 commands, 96 workers, 512 streams, 5,000 ms per command.

## Steps

1. Post one 2.5-second `test.delay`, wait beyond a heartbeat, then assert a completed execution with a heartbeat and a healthy container.
2. Expire one claimed processing row, replace its attempt, then verify stale completion affects zero rows and current completion affects one.
3. Execute the retry transition twice with `maxAttempts=2`; assert `ready` then `failed` and exactly one DLQ row.
4. Run `tests/load/worker-concurrency.mjs` and require zero scheduler/delivery backlog.
5. Run `verify-queue-drain.ps1` on both dedicated queues; the request queue must have zero rows and the result queue exactly 2,048 distinct transaction keys before drain.
6. Restore the normal Agent queue env and deploy again.

## Acceptance

- No container exit or expired lease during the heartbeat test.
- Attempt fencing rejects stale reports.
- Retry delay is exponential, attempts are bounded, and exhaustion has one durable DLQ row.
- Elapsed load time is no greater than `ceil(2048 / 96) * 5000 + 90000 = 200000 ms`.
- Both dedicated queues are empty after verification and normal deployment reports healthy.
