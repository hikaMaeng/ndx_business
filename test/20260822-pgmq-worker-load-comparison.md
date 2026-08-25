# PGMQ worker topology: 2,048 request comparison

## Same workload

- 2,048 independent `test.delay` commands; each handler waits 5,000 ms.
- 96 resident workers (`AGENT_MIN_THREADS=AGENT_MAX_THREADS=96`) on the
  48-logical-core host; `maxQueue=64`.
- 512 streams and four reply channels.
- Dedicated PGMQ command, result, and Gateway queues.
- The worker-only lower bound is `ceil(2048 / 96) x 5,000 = 110,000 ms`.
- Acceptance time is 125,000 ms (lower bound plus 15,000 ms).

## Observed result

| Measure | Previous fixed-worker baseline | PGMQ participant topology |
| --- | ---: | ---: |
| End-to-end terminal result time | 118,522 ms | 401,195 ms |
| Event-store command-to-result span | 118,522 ms | 324,833 ms |
| Terminal success events observed on WebSocket | 2,048 / 2,048 | 2,048 / 2,048 |
| Completed executions / failed executions | 2,048 / 0 | 2,048 / 0 |
| Command/result/Gateway queues after settlement | drained | 0 / 0 / 0 |
| 125,000 ms acceptance | pass | **fail** |

The new topology is 3.38x the previous end-to-end time, and 276,195 ms above
the acceptance limit. It proves terminal delivery and queue drain, but does
not prove the required large-load performance.

## Diagnostic observation

The worker starts with the configured `96` threads. The command queue reached
zero and all 2,048 executions completed before the harness finished. The delay
was then dominated by the result path: `result-router.ts` reads a batch of 32
but serially awaits subscription lookup, Gateway queue ensure/send, and delete
for every event. This turns the result fan-out into a single durable lane.

The prior direct-worker baseline did not have that durable router hop. The
comparison is therefore fair as a user-visible workload comparison, but it
identifies the new PGMQ result router as the architectural performance gap to
fix before calling the topology performance-equivalent.

## Evidence

- Harness: `apps/agent/tests/load/pgmq-worker-concurrency.mjs`
- Deployed worker log: `worker.pool.started` with 96 min/max threads.
- Harness terminal assertion reached 2,048 successes, then failed only on
  `elapsed=401195 exceeds 125000`.
- Database after run: 2,048 command rows, 2,048 result rows, 2,048 completed
  executions, zero failed executions; all three dedicated PGMQ queues had zero
  rows.
