# Test Plan: durable terminal-delivery invariants

## Status

The former `event_delivery` lease plan is superseded. `event_delivery` was removed in Phase 7; its historical report remains evidence for that retired path. Current delivery is `event_store` → transactional `event_outbox` → fenced outbox dispatcher.

## Goal

Prove that every terminal outcome is immutable, durably reserved before external publication, and delivered at least once without a client-visible false `worker_failed` caused by egress.

## Current preconditions

- Deploy with `npm run deploy agent`; `GET /health` must return 200.
- `event_store`, `event_stream_sequence`, `event_processing_job`, `event_processing_attempt`, `event_outbox`, `event_outbox_dlq`, and `agent_execution` exist.
- Metrics authentication is configured.

## Steps

1. Run `npm test --workspace agent_app` for atomic event/outbox commit, fenced outbox completion, retry/DLQ, worker exit, and terminal fan-out unit coverage.
2. Submit one unique `hash.sha256` command and query its command/result envelopes, execution, processing attempt, and outbox row.
3. Require a `completed` execution, a completed attempt with worker ID, exactly one terminal result, and one `published` outbox row before reading its PGMQ result message.
4. Submit the same source event twice and require one stored command/result identity and one result-queue message.
5. Run the current multi-channel fairness and worker-concurrency plans, then remove only their transaction prefixes.
6. Inspect authenticated metrics and browser smoke evidence.

## Expected results

- Terminal event, outbox reservation, and execution completion share one PostgreSQL transaction.
- Only a fenced outbox claim calls PGMQ/WebSocket; a failed claim returns to bounded retry/DLQ without mutating the immutable terminal event.
- Duplicate input converges by event ID; channel fan-out remains exactly once per recipient channel.
- `processingReady`, `processingRunning`, `outboxPending`, `outboxFailed`, and mailbox lag return to zero after each scoped run.

## Evidence

- [Outbox/projection load plan](outbox-projection-load-20260821.md)
- [Current 2,048-worker proof](../reports/operations/20260821_053500-prefetch-2048.md)
- [Current multi-channel proof](../reports/operations/20260821_054000-current-multichannel-fairness.md)
