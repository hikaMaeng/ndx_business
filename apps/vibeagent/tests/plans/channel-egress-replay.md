# Channel egress replay plan

## Purpose

Prove that a browser subscriber resumes a bounded, multi-page canonical replay without duplicate terminal events, and that a changed channel set cannot reuse a prior cursor.

## Deployed scenario

1. Open `/` and subscribe through the rendered channel UI; retain the server-issued cursor in browser storage.
2. Take that browser context offline and close its socket.
3. Submit 257 independent `hash.sha256` requests to its reply channel, one more than the default 256 replay page.
4. Restore connectivity; require all 257 unique terminal event IDs, an incomplete page followed by a complete page, and no page error.
5. Close the socket once more; require automatic reconnection.
6. Reload after the UI's channel set changes; require a healthy new subscription rather than a cursor-fingerprint rejection loop.
7. Delete only rows and PGMQ messages with the generated transaction prefix plus the exact browser-composer transaction, then verify zero scoped rows.

## Acceptance

The cursor is bounded and channel-safe; no event is skipped or duplicated across the offline interval; reconnect attempts are bounded; scoped durable state is removed after measurement.
