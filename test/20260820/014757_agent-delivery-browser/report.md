# Agent delivery-invariant browser verification

- status: passed
- mode: scenario
- testedUrl: http://127.0.0.1:18081/
- websocket: ws://127.0.0.1:18081/ws
- consoleErrors: 0
- pageErrors: 0

## Steps
- goto: passed
- main-landmark: passed
- websocket-connected: passed
- client-event-frame-sent: passed
- server-worker-result-frame-received: passed

## Locator Outcome
`getByRole("main")` resolves to exactly one element; the duplicate-landmark defect fixed in
`apps/agent/src/front/index.html` has not regressed. `getByLabel("Event type")`,
`getByLabel("Payload JSON")`, and `getByRole("button", { name: "Send to agent" })` were
unambiguous.

`page.locator("strong").filter({ hasText: "turn.start.request.result" })` remains the one
structure-dependent locator and the flakiness risk in this scenario: the result marker still has
no role or test id of its own.

## Store Effect
The scenario's request and result both landed in `session:71ed0141-…` at sequences 1 and 2 with the
result carrying `causation_event_id`.

## Reproducibility
`BROWSER_OUT_DIR=<this dir> node run.mjs` against a stack refreshed with `npm run deploy agent`.
