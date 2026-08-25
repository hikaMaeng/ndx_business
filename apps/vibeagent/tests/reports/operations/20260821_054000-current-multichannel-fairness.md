# Current deployed multi-channel fairness proof — 2026-08-21

## Environment

- Revision: `b8bbef5 perf(agent): prefetch bounded worker attempts`
- Published target: `http://127.0.0.1:18081`
- Four WebSocket subscribers, each subscribed to one reply channel.
- 512 independent `hash.sha256` requests: 128 requests per reply channel and 64 concurrent submitters.

## Result

| Check | Observed value |
| --- | --- |
| Terminal receipt | 512 / 512, exactly once |
| Cross-channel receipt | none |
| Per-channel receipt | 128 / 128 / 128 / 128 |
| p50 / p95 / p99 | 6,582 / 8,797 / 8,935 ms |
| p99 budget | pass (`<= 10,000 ms`) |
| Durable cursor advances | 512 |
| Connections and mailbox lag after close | 0 / 0 |
| Command / result event cardinality | 512 / 512 |
| Published outbox / PGMQ result messages | 512 / 512 |
| Processing and outbox backlog | 0 / 0 |

The test prefix was `ws-fair-1787258131587`. It was deleted only by transaction-key scope after the cardinality query. Post-cleanup event store, attempt, execution, outbox, and result-queue counts were `0/0/0/0/0`.

## Same-transaction channel join

`join-current-proof-1787258305824` submitted a 10-second `test.delay` to `agent.results`, then two seconds later submitted the same action/payload/transaction key to `orders`.

| Check | Observed value |
| --- | --- |
| Durable recipients | `agent.results`, `orders` |
| Execution | one `completed` execution, attempts `1` |
| Processing jobs | two completed jobs, one attempt each |
| Terminal results | one `ok=true` result per recipient channel |
| Result-queue messages | 2 |

This exact transaction scope was then removed; event store, execution, and result-queue counts were `0/0/0`.

## Reproducibility

Run `apps/agent/tests/load/websocket-fairness.mjs` with authenticated `GET /metrics`, then query the generated prefix. The test rejects a wrong-channel event, duplicate terminal event, non-advancing cursor, nonzero backlog, or p99 over its configured budget.
