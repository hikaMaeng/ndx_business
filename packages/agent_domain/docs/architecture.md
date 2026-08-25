# agent_domain 아키텍처

| 경로 | 책임 | 대표 코드 |
| --- | --- | --- |
| `src/common/protocol/event/` | ingress·canonical event 타입과 draft 생성 | [`createIngressEvent`](../src/common/protocol/event/index.ts) |
| `src/common/protocol/channel/` | WebSocket client/server frame과 cursor parser | [`parseChannelClientFrame`](../src/common/protocol/channel/index.ts) |
| `src/common/protocol/stream/` | 화면용 stream snapshot 타입 | [`StreamSnapshot`](../src/common/protocol/stream/index.ts) |
| `src/server/handlers/` | Worker handler 계약과 registry | [`executeHandler`](../src/server/handlers/index.ts) |
| `src/server/id/` | server-derived event의 deterministic ID | [`deterministicEventId`](../src/server/id/index.ts) |
| `src/front/model/` | frontend event stream model | [`EventStreamModel`](../src/front/model/event-stream.ts) |
| `src/broker/` | 도메인 중립 event broker 런타임. 아래 표 참조 | [`createApp`](../src/broker/app.ts) |

`streamIdOf`는 `protocol/stream`이 아니라 [`protocol/event`](../src/common/protocol/event/index.ts)에 있다. `protocol/stream`은 현재 순서 계산이 아닌 화면 snapshot 모델만 소유한다.

## src/broker — broker 런타임

이 폴더는 `apps/agent`에 있던 전송 계층을 그대로 옮긴 것이다. 코딩 에이전트 어휘를 포함하지 않으므로 다른 app이 자기 action registry만 바꿔 같은 broker를 재사용할 수 있다.

| 경로 | 책임 | 대표 코드 |
| --- | --- | --- |
| `src/broker/app.ts` | HTTP ingress·health·ready·metrics. 정적 번들 경로는 호출자가 `frontDir`로 주입 | [`createApp`](../src/broker/app.ts) |
| `src/broker/env.ts` | `AGENT_*` 환경값 schema 검증 | [`readEnv`](../src/broker/env.ts) |
| `src/broker/loops/` | Worker consume, result routing, Gateway delivery 루프 | [`startWorkerConsumer`](../src/broker/loops/worker-consumer.ts) |
| `src/broker/event-store/` | append, replay, cursor, stream watermark | [`EventStore`](../src/broker/event-store/store.ts) |
| `src/broker/idempotency/` | transaction claim·lease·recipient | [`ExecutionStore`](../src/broker/idempotency/store.ts) |
| `src/broker/delivery/`, `src/broker/gateway-outbox/` | Worker→result, Router→Gateway 두 transactional outbox | [`DeliveryStore`](../src/broker/delivery/store.ts) |
| `src/broker/gateway/` | standby liveness와 ownership-safe shutdown | [`shutdownGateway`](../src/broker/gateway/lifecycle/index.ts) |
| `src/broker/pgmq/`, `src/broker/queue/` | PGMQ adapter와 transport 계약 | [`PgmqClient`](../src/broker/pgmq/client.ts) |
| `src/broker/stream/`, `src/broker/transport/` | hub, mailbox, replay buffer, WebSocket | [`attachWebSocketTransport`](../src/broker/transport/websocket.ts) |
| `src/broker/worker/` | Worker Thread pool과 thread 진입 루프 | [`createWorkerPool`](../src/broker/worker/pool.ts) |
| `src/broker/subscription/`, `src/broker/metrics/`, `src/broker/ingress/` | Gateway 구독 registry, 계수기, canonical draft 변환 | [`GatewaySubscriptionStore`](../src/broker/subscription/store.ts) |

## export 경계

Gateway·Router 화면 코드는 `agent_domain/common`을, Worker action registry는 `agent_domain/server`를, 조립 루트는 `agent_domain/broker`를 사용한다. package 내부 상대 경로가 아니라 이 export 경계를 사용해야 한다.

`agent_domain/broker/worker`는 별도 subpath다. Worker Thread 번들이 broker barrel을 거쳐 `pg`·`express`·`ws`까지 끌어오지 않게 하려는 것이며, 이를 지키지 않으면 worker 번들이 4KB에서 1.4MB로 커진다.
