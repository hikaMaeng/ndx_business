# API

The public entrypoint exports ingress and canonical shapes from `protocol/event`.

- `IngressCommand` is what a client may send: action, transaction key, channel,
  optional session/run/turn context, and payload. It carries no event ID,
  stream, or sequence, because the server issues those.
- `EventDraft` adds server-issued identity minus `sequence`.
- `IngressEvent` is the server-issued PGMQ handoff record. It has an event ID
  for redelivery convergence but no stream or sequence until append.
- `EventEnvelope` is the stored and delivered shape: draft plus the per-stream
  decimal-string `sequence` assigned at append time, with `causationEventId` linking a derived
  event to its cause.

`createIngressEvent` creates the durable handoff record. `createEventDraft`
builds a command into a draft. `createDerivedDraft`
builds a follow-up event that inherits stream, session, run, turn, and
correlation identity from its cause. `streamIdOf` is the single stream-identity rule: `session:<sessionId>` when a
session exists, otherwise `channel:<channel>`.

The server-only `./server` export supplies `deterministicEventId(name)`, the
stable UUID-shaped identity used for outcomes that may be derived more than once.

`protocol/channel` has the browser subscription frames. `subscribed` carries
`replayComplete`; a false value means the server sent one bounded replay page.
After all page events have durably advanced the cursor it emits `replay` with
that same opaque cursor. The client must subscribe again until the frame says
`replayComplete: true`; only a complete replay joins live routing.

`protocol/stream` holds the browser stream model. There is no legacy `protocol/vibe`
alias or public legacy stub subpath.
