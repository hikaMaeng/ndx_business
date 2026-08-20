# API

The public entrypoint exports three shapes from `protocol/event` and the legacy
`AgentEvent` from `protocol/agent`.

- `IngressCommand` is what a client may send: action, transaction key, channel,
  optional session/run/turn context, and payload. It carries no event ID,
  stream, or sequence, because the server issues those.
- `EventDraft` adds server-issued identity minus `sequence`.
- `EventEnvelope` is the stored and delivered shape: draft plus the per-stream
  decimal-string `sequence` assigned at append time, with `causationEventId` linking a derived
  event to its cause.

`createEventDraft` builds a client command into a draft. `createDerivedDraft`
builds a follow-up event that inherits stream, session, run, turn, and
correlation identity from its cause. `deterministicEventId(name)` produces a
stable UUID-shaped identity for an outcome that may be derived more than once.
`streamIdOf` is the single stream-identity rule: `session:<sessionId>` when a
session exists, otherwise `channel:<channel>`.

`protocol/channel` has the browser subscription frames. `subscribed` carries
`replayComplete`; a false value means the server sent one bounded replay page.
After all page events have durably advanced the cursor it emits `replay` with
that same opaque cursor. The client must subscribe again until the frame says
`replayComplete: true`; only a complete replay joins live routing.

`protocol/stream` holds the browser stream model. There is no legacy `protocol/vibe`
alias or public legacy stub subpath.
