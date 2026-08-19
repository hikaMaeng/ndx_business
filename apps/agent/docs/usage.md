# Usage

Run `npm run build --workspace agent`, then start the Compose stack. Send `echo` or `hash.sha256` actions to `/api/events`. Set `DATABASE_URL`, queue names, and queue tuning variables through `apps/agent/docker/.env`, which is materialized from `docker/env.defaults` by the deploy script.
