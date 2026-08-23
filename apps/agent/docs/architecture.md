# Agent 아키텍처

## 프로세스와 저장 경계

Gateway만 host port `18081`을 공개한다. Worker는 command queue를 읽는 내부 consumer이고, Router는 result queue를 읽어 Gateway별 queue로 fan-out하는 내부 consumer다. PGMQ가 프로세스 사이의 일감을 보관하고, PostgreSQL은 event 순서·cursor·transaction 상태·구독 대상을 보관한다.

| PostgreSQL 데이터 | 책임 | 코드 |
| --- | --- | --- |
| `event_store`, `event_stream_sequence` | canonical event·retention index와 stream별 sequence watermark | [`EventStore`](../src/server/event-store/store.ts) |
| `event_subscription_cursor` | channel별 cursor position | [`EventStore`](../src/server/event-store/store.ts) |
| `agent_execution`, `agent_execution_recipient` | transaction claim, 실행 결과, reply channel 집합 | [`ExecutionStore`](../src/server/idempotency/store.ts) |
| `agent_gateway_instance`, `agent_gateway_subscription` | Gateway queue identity의 단일 owner와 channel 구독 lease | [`GatewaySubscriptionStore`](../src/server/subscription/store.ts) |

현재 `event_delivery` 같은 recipient별 전달 ledger는 없다. 동일 result가 PGMQ를 통해 다시 전달될 수 있으므로 최종 consumer는 `eventId`를 중복 제거 키로 사용해야 한다.

## 소스 경계

| 경로 | 책임 | 대표 코드 |
| --- | --- | --- |
| `src/server/app.ts` | HTTP ingress, health, ready, metrics | [`createApp`](../src/server/app.ts) |
| `src/server/broker/` | Worker consume, result routing, Gateway delivery | [`startWorkerConsumer`](../src/server/broker/worker-consumer.ts) |
| `src/server/event-store/` | append, replay, cursor | [`EventStore`](../src/server/event-store/store.ts) |
| `src/server/idempotency/` | transaction claim·lease·recipient | [`ExecutionStore`](../src/server/idempotency/store.ts) |
| `src/server/ingress/` | ingress를 canonical draft로 변환 | [`toEventDraft`](../src/server/ingress/event-draft.ts) |
| `src/server/metrics/` | process·pool 계수 | [`MetricsRegistry`](../src/server/metrics/registry.ts) |
| `src/server/pgmq/`, `queue/` | PGMQ adapter와 transport 계약 | [`PgmqClient`](../src/server/pgmq/client.ts) |
| `src/server/stream/`, `transport/` | hub, mailbox, replay, WebSocket | [`attachWebSocketTransport`](../src/server/transport/websocket.ts) |
| `src/server/subscription/` | durable Gateway subscription | [`GatewaySubscriptionStore`](../src/server/subscription/store.ts) |
| `src/server/worker/` | Worker Thread pool과 handler 실행 | [`runWorker`](../src/server/worker/pool.ts) |
| `src/front/` | Agent 화면 | [`src/front/index.ts`](../src/front/index.ts) |

`execution/`, `outbox/`, `processing/`, `projection/`, `scheduler/`는 비어 있는 이전 구조의 디렉터리였으며 소스 경계가 아니다.
