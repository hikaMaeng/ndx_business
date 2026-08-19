# API

The public entrypoint exports the legacy `AgentEvent` envelope plus the Vibe
Coding event families from `protocol/vibe`: session, turn, iteration, tool,
hook, model, state, process, approval, and artifact.

Every Vibe event carries a session context, transaction key, action, channel,
state, scope, sequence, and payload. Request, progress, response, and terminal
events share the same context; callers never wait for a response synchronously.
