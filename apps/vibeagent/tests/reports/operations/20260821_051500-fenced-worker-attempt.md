# Fenced worker-attempt verification — 2026-08-21

## Environment

- Revision: `64a40d7 feat(agent): record fenced worker attempts`
- Deployed image: `sha256:ab3bebe68a97f3e43c5d77ac08791be20251d353c7770b957edb4cf7179dca07`
- Published target: `http://127.0.0.1:18081`
- Host capacity: 48 cores; the deployed pool reported 96 resident workers.

## Executed steps

1. Submitted one unique `hash.sha256` command through `POST /api/events` with `transactionKey=attempt-ledger-proof-1787256922845`.
2. Waited three seconds, then joined `event_processing_attempt`, processing job, execution claim, and result outbox in the deployed PostgreSQL database.
3. Deleted only rows and PGMQ messages carrying that transaction key; post-delete counts for event store, attempt ledger, execution state, and result queue were all zero.
4. Ran the deployed-service browser smoke at `http://127.0.0.1:18081/`.

## Results

| Check | Observed value |
| --- | --- |
| Attempt state | `completed` |
| Stable worker ID recorded | `true` |
| Attempt started / finished | `true` / `true` |
| Processing lease released | `true` |
| Processing job | `completed` |
| Idempotency execution | `completed` |
| Terminal result outbox | `published` |
| Scoped cleanup counts | `0|0|0|0` |
| Browser smoke | passed; `test/20260821/051624_headless-browser-test/report.md` |

The worker task is not posted until `startAttempt` records its worker ID. A worker loss rejects the active task as `WorkerLostError`, releases the owned execution lease, and returns the durable job to retry; this path is covered by the real worker-exit and shutdown tests.

## Reproducibility

Run `npm test --workspace agent`, `npm test --workspace agent`, both lint commands, and `npm run deploy agent`. Submit a unique `attempt-ledger-proof-*` transaction and inspect its `event_processing_attempt` row for `worker_id`, `started_at`, `finished_at`, and a null `lease_until`; delete only that transaction's rows and result message afterward.
