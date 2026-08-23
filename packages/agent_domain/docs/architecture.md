# agent_domain 아키텍처

| 경로 | 책임 | 대표 코드 |
| --- | --- | --- |
| `src/common/protocol/event/` | ingress·canonical event 타입과 draft 생성 | [`createIngressEvent`](../src/common/protocol/event/index.ts) |
| `src/common/protocol/channel/` | WebSocket client/server frame과 cursor parser | [`parseChannelClientFrame`](../src/common/protocol/channel/index.ts) |
| `src/common/protocol/stream/` | 화면용 stream snapshot 타입 | [`StreamSnapshot`](../src/common/protocol/stream/index.ts) |
| `src/server/handlers/` | Worker handler 계약과 registry | [`executeHandler`](../src/server/handlers/index.ts) |
| `src/server/id/` | server-derived event의 deterministic ID | [`deterministicEventId`](../src/server/id/index.ts) |
| `src/front/model/` | frontend event stream model | [`EventStreamModel`](../src/front/model/event-stream.ts) |

`streamIdOf`는 `protocol/stream`이 아니라 [`protocol/event`](../src/common/protocol/event/index.ts)에 있다. `protocol/stream`은 현재 순서 계산이 아닌 화면 snapshot 모델만 소유한다.

Gateway·Router는 `agent_domain/common`을, Worker는 `agent_domain/common`과 `agent_domain/server`를 사용한다. package 내부 상대 경로가 아니라 이 export 경계를 사용해야 한다.
