# Overview

`admin` is the deployable service module: an Express server with a
health endpoint, and a Vite React shadcn/ui front shell that the server serves
as static assets in production.

## Ownership boundary

This module owns orchestration — framework lifecycle, HTTP and static serving,
composition, and process wiring. Domain rules, invariants, and any logic that
would survive replacing Express belong in `packages/admin_domain`.

## Invariants

* One service, one app module, one paired domain package.
* Production traffic is served by Express only.
* The deployed container is the test target, not a dev server.

## Scope

The baseline is deliberately small: health endpoint, one accessible view, a
deploy path, docs, and smoke tests. It is a platform baseline, not a product.
Add a feature only when it is asked for.
