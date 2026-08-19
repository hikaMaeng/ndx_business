# Testing

Run `npm run lint --workspace agent`, `npm run test --workspace agent`, and `npm exec turbo run build --filter=./apps/agent`. Use `npm run deploy agent` for the Compose refresh, then the health endpoint and a queue round trip for integration verification.

`tests/plans/` and `tests/reports/` hold the event-store acceptance records. Event-store behaviour that depends on PostgreSQL type mapping — `bigint` sequences arriving as text, the identity backfill, and duplicate convergence — is not provable against a stubbed pool; verify it against the deployed database and record the queries in the report.

Browser verification drives the `/ws` console at `/`. Prefer role and accessible-name locators; the shell exposes `main` as its landmark.
