# Testing

## Unit

```sh
npm run test --workspace admin
```

`src/server/app.test.ts` drives `createApp()` through supertest without binding
a port. Route behaviour belongs here; anything needing a real listener belongs
in the browser layer below.

## Type check

```sh
npm run lint --workspace admin
```

Checks the front and server tsconfigs separately, because they target different
runtimes.

## Deployed service

```sh
npm run deploy admin
```

The deploy verifies the published port and `GET /health` itself and prints the
evidence in its report block. Treat that server as the test target; do not
verify against a dev server and call the deployment tested.

## Browser

Use the `headless-browser-test` skill against the deployed URL. Cover:

* `role=main` present, `role=heading` level 1 with the service name.
* `role=status` / `data-testid="service-state"` renders its line.
* The `Health` link resolves to a healthy response.

Locators are the ones recorded in `docs/constraints.md`. Use those rather than
structural selectors, so markup refactors do not break the tests.

The full account verification matrix is recorded in
[`account-test-plan.md`](account-test-plan.md). It is the required plan for
shared-token, multi-device, transport, expiry, administration, and deployed
browser coverage.

The multi-account organization and master-admin acceptance matrix is recorded in
[`organization-acceptance-plan.md`](organization-acceptance-plan.md).
