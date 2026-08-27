# Agent event-store browser verification

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
`getByRole("main")` failed on the first run with a strict-mode violation: the shell
rendered `<main class="workspace">` inside `<main id="app">`, so two landmarks matched.
`apps/agent/src/front/index.html` now mounts into `<div id="app">` and the workspace is
the only `main`. After redeploy the role locator resolves to one element.

`getByLabel("Event type")`, `getByLabel("Payload JSON")`, and
`getByRole("button", { name: "Send to agent" })` were unambiguous.
`page.locator("strong").filter({ hasText: "turn.start.request.result" })` is
structure-dependent and is the flakiness risk in this scenario: the result marker has no
role or test id of its own.

## Store Effect
The scenario's request and result both landed in `session:177e0a1e-…` at sequences 1 and 2,
and the result row carries `causation_event_id`.

## Screenshot
- screenshots/event-store-cps-flow.png

## Reproducibility
`BROWSER_OUT_DIR=<this dir> node run.mjs` against a stack refreshed with `npm run deploy agent`.
