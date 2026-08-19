# Internals

# Internals

- The envelope is shared by all event families so a CPS response preserves
  causation, correlation, sequence, and transaction identity.
- `request`, `progress`, `response`, and terminal state events are persisted as
  facts; WebSocket is only a projection.
- Tool/process events describe external work. Worker threads only dispatch and
  route; the external process reports lifecycle events back through the queue.
- KV persistence, checkpoints, and compaction are state events because they may
  be retried, resumed, or replayed independently of a turn.
- The legacy `protocol/agent` remains for the existing simple event client;
  `protocol/vibe` is the expanded public event union.
