# Agent Service Invariants

These rules are mandatory. A change that violates one is incorrect even when
the code builds or the happy path passes.

## Runtime shape

- The service is a CPS event orchestrator. A worker thread routes and invokes
  handlers; it must not perform shell, git, model, filesystem, or other
  unbounded work itself.
- External work runs in a separate process. Start it, return control to the
  worker immediately, and report stdout, stderr, progress, completion, error,
  timeout, and cancellation as events.
- Every external process has an owner identity, lifecycle state, timeout, and
  orphan/restart policy. Never leave an untracked process running.
- `async` does not make CPU or process work safe inside a worker. Await only
  bounded I/O and dispatch work that can outlive the message.

## Events and keys

- Every event is self-describing: `eventId`, `transactionKey`, `kind`,
  `channel`, `action`, `source`, `createdAt`, and `payload` are required.
- Preserve the hierarchy when applicable:
  `sessionKey → runKey → iterationKey → stepKey → eventKey`.
- Use a server-issued key for externally retried/authorized operations. UUIDs
  are allowed for short internal scopes, but the same key must identify the
  same logical operation on every retry.
- Do not mutate or reuse a completed key for a new operation. A retry must
  replay the stored result or produce one deterministic duplicate outcome.
- State transitions are monotonic. A late event must never move `completed`,
  `failed`, `cancelled`, or `timed_out` back to `running`.

## Durable state and queue delivery

- PostgreSQL is the source of truth for execution state, idempotency claims,
  event history, checkpoints, approvals, and result payloads.
- The queue transport is delivery only, not the event log and not the session database.
  Delete a message only after the durable state/result write succeeds.
- Claim execution with a unique transaction key before invoking a handler.
  Duplicate messages must not invoke external work twice.
- Use visibility timeouts, bounded retries, and explicit terminal failure.
  Never busy-loop, silently drop, or acknowledge an unprocessed message.
- A database/network disconnect must not permanently kill the consumer loop;
  reconnect with bounded backoff and expose the degraded state.

## Streams and clients

- WebSocket is a projection of durable state, not the source of truth.
  A reconnecting client must be able to recover from PostgreSQL/checkpoints.
- Publish only to the event's channel and never leak events across channel
  subscriptions. Validate event payloads at the boundary.
- Client-visible progress must distinguish queued, processing, delivered,
  failed, cancelled, timed out, and waiting states.

## Change gate

- Keep routing, handlers, process adapters, persistence, protocol types, and
  UI models in separate bounded folders. Do not create a god file.
- Add or update tests for duplicate delivery, retry, restart, timeout,
  cancellation, reconnect, out-of-order events, and worker failure.
- Run the Agent build/lint, architecture checks, `npm run deploy agent`, and
  an actual browser event scenario before declaring a change complete.
