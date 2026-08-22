# Internals

- `EventEnvelope` is shared by every event family so a CPS result preserves
  causation, correlation, sequence, and transaction identity.
- Stream identity is derived, never client-supplied: `streamIdOf` is the only
  rule, so a session's commands and its results land in one stream and stay
  orderable and projectable together.
- `sequence` is assigned by the server at append time as an exact decimal string. A draft has no sequence,
  which is what keeps the ingress and stored shapes separate types rather than
  one optional-field type.
- The server-only `deterministicEventId` exists because delivery is at-least-once. A logical
  outcome derived twice must produce one identity, otherwise client-side
  `eventId` de-duplication cannot suppress the repeat.
- `request`, `progress`, `response`, and terminal state events are persisted as
  facts; WebSocket is only a projection.
- `IngressEvent` is intentionally distinct from `EventEnvelope`: it carries a
  server-issued redelivery identity before append, while only append assigns
  canonical stream and sequence fields.
