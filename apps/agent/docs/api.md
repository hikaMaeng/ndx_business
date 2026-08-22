# API

`POST /api/events` and WebSocket `event` frames are Gateway ingress. They return/record only PGMQ acceptance; no endpoint waits for Worker execution.

`GET /health` and `GET /ready` exist only on the public Gateway. `GET /metrics` is aggregate-only and requires `Authorization: Bearer <AGENT_METRICS_TOKEN>`.

WebSocket clients send `subscribe(channels, cursor)` and receive only matching channel events. A reconnect uses its cursor to replay immutable history before live delivery resumes.
