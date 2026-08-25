# Hard process-loss recovery proof — 2026-08-21

## Scenario

1. Submitted `test.delay` with a 20-second delay and unique transaction key `hard-loss-proof-1787257106501`.
2. Waited until the deployed database showed one `running` processing attempt with a non-null worker ID and matching running job/execution lease.
3. Forced the Agent container down during that execution, then restored it through the official `npm run deploy agent` path.
4. Waited for the processing lease to expire and queried the durable rows.

## Result

| Check | Observed value |
| --- | --- |
| Original attempt | `lost`, error `processing lease expired` |
| Replacement attempt | `completed`, with a worker ID |
| Processing job attempts | `2` |
| Execution status | `completed` |
| Terminal results | exactly `1` |

The original immutable command remained in `event_store`; the scheduler fenced the expired attempt, reclaimed the idempotency execution, and produced one terminal result rather than joining or duplicating it. All rows and the matching PGMQ result message for this transaction were removed afterward; post-cleanup event store, attempt, execution, outbox, and result-queue counts were zero.
