# Retention, lease, and identity evidence — 2026-08-23

Target: deployed Gateway, Worker, and Router containers from this commit.

| Boundary | Injected condition | Observed fact |
| --- | --- | --- |
| stream watermark | `session:verify-retention-20260823` event at sequence 500 was retention-deleted while its cursor stayed at 500 | next real ingress command was persisted as sequence **501**; the cursor remained 500 |
| expired execution | an expired `running` row was inserted before Gateway restart | row stayed `running`, `result=NULL`, `completed_at=NULL`; Gateway emitted `execution.lease.expired rows=1` |
| Gateway ownership | a second internal Gateway started with `AGENT_GATEWAY_ID=agent` | process exited 1 before queue consumption: `AGENT_GATEWAY_ID 'agent' is already owned by another live Gateway` |
| idle outbox | Worker publisher was idle before a 1ms terminal result | result outbox `created_at → delivered_at` was **93ms** through the local wakeup |

The 2,048-command composite run completed in 112,210ms against a 130,000ms acceptance limit. It produced 2,241 expected terminal deliveries, had zero command/result/Gateway backlog, zero lease redeliveries, and zero retry/DLQ/terminal-persistence alert deltas. Its prefix-scoped event, execution, recipient, cursor, watermark, outbox, and PGMQ rows were deleted after verification.
