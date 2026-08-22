# Constraints

## Blast radius

| Subpath | Consumers | Invariants (do not break) |
| --- | --- | --- |
| `agent_domain/common` | browser, Gateway, Worker, Router | `IngressEvent` is the PGMQ command record; `EventEnvelope` is the canonical command/result record exchanged between participants. |
| `agent_domain/common/protocol/channel` | browser Gateway, Gateway transport | Client frames are parsed at the boundary and channel subscription controls what a client can observe. |
| `agent_domain/server` | Worker services | Static handler registry maps allowed actions to execution code; it never imports an app or Gateway. |

`transactionKey` remains stable across retry. `eventId` remains stable across PGMQ redelivery. `replyChannel` is a logical delivery address, never a physical PGMQ queue name.
