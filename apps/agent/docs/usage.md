# Usage

Run `npm run build --workspace agent`, then start the Compose stack. Send `echo` or `hash.sha256` actions to `/api/events`. Set `DATABASE_URL`, queue names, and queue tuning variables through `apps/agent/docker/.env`, which is materialized from `docker/env.defaults` by the deploy script.

The deploy script materializes `.env` only when it is absent, so an existing deployment does not pick up new keys. To enable `GET /metrics` on a stack that already has a `.env`, append `AGENT_METRICS_TOKEN=<token>` to it and redeploy; leaving it unset keeps the endpoint disabled.
