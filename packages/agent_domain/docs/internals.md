# Internals

- `EventEnvelope` is shared by every event family so a CPS result preserves
  causation, correlation, sequence, and transaction identity.
- Stream identity is derived, never client-supplied: `streamIdOf` is the only
  rule, so a session's commands and its results land in one stream and stay
  orderable and projectable together.
- `sequence` is assigned by the server at append time. A draft has no sequence,
  which is what keeps the ingress and stored shapes separate types rather than
  one optional-field type.
- `deterministicEventId` exists because delivery is at-least-once. A logical
  outcome derived twice must produce one identity, otherwise client-side
  `eventId` de-duplication cannot suppress the repeat.
- `request`, `progress`, `response`, and terminal state events are persisted as
  facts; WebSocket is only a projection.
- The legacy `protocol/agent` remains the deployed wire type for the existing
  simple event client until Phase 1 of the Renewal plan replaces it.
