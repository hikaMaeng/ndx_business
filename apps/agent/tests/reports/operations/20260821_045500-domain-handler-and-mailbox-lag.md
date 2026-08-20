# Domain handler and mailbox-lag verification — 2026-08-21

## Environment

- Deployed Agent image: `sha256:fa4d644ff5bfd3b665fb877e1face46bde681dc4c26f3216377a7262e3776b4f`
- Published target: `http://127.0.0.1:18081`
- Worker capacity: 96 fixed resident workers on a 48-core host.

## Executed steps

1. Submitted `hash.sha256` through `POST /api/events` and read the terminal rows from PostgreSQL.
2. Submitted a five-second `test.delay` with `timeoutMs=100` to prove the domain handler observes abort.
3. Read authenticated `/metrics`, then ran the rendered-service browser smoke.
4. Deleted both exact transaction-key scopes from event store, processing/outbox ledgers, execution/recipient rows, and `pgmq.q_agent_results`; each post-delete count was zero.

## Results

| Check | Result |
| --- | --- |
| Static `agent_domain/server` handler | `hash.sha256` persisted `command` sequence 1 and `hash.sha256.result` sequence 2 |
| Abort conversion | `test.delay` persisted `result` with `ok=false`, `worker_failed`; execution became `timed_out`, attempts 1 |
| Fixed pool | `/metrics.workerPoolWorkers=96`, busy 0 after drain |
| Mailbox lag | `/metrics.websocketMailboxQueued=0` after no connected mailbox; the mailbox unit test covers queued-depth increment and disposal to zero |
| Backlog after drain | processing ready/running and outbox pending all 0 |
| Browser | smoke passed at `http://127.0.0.1:18081`; evidence: `test/20260821/045259_headless-browser-test/report.md` |

## Reproducibility

Run `npm test --workspace agent`, `npm test --workspace agent_domain`, `npm run lint --workspace agent`, then `npm run deploy agent`. The deploy must report the published health probe as HTTP 200. Use unique `domain-handler-proof-*` and `domain-abort-proof-*` transaction keys and remove only those scoped rows after the run.
