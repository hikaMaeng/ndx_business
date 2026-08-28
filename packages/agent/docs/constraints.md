# agent 제약

| export | 소비자 | 불변식 |
| --- | --- | --- |
| `common` event | Gateway, Worker, WebSocket client | `eventId`는 immutable, `sequence`는 문자열, canonical sequence는 server append만 발급 |
| `common` channel | Gateway WebSocket, frontend | cursor는 opaque UUID이며 subscribe channel 집합과 결합됨 |
| `server` ID | Worker | result ID namespace는 command·conflict와 충돌하면 안 됨 |
| `server` handlers | Worker Thread | unknown action은 현재 acknowledge fallback이 실행됨 |
| `front` model | Agent frontend | UI는 parsed server frame만 반영 |

`transactionKey`는 client 재시도에서 유지한다. 같은 key에 action 또는 payload가 다르면 `ExecutionStore`가 conflict로 처리한다. `replyChannel`은 실행 내용이 아니라 result 주소이므로 transaction 합류 여부를 정하는 payload hash에 넣지 않는다.

`streamIdOf`는 session이 있으면 `session:<sessionId>`, 없으면 `channel:<channel>`을 만든다. derived event는 원 command의 `streamId`, `transactionKey`, correlation, `causationEventId`를 계승한다.

## wire 타입은 protocol에만, 단 "wire"의 뜻을 지킨다

아키텍처 체커는 이름으로 wire 타입을 찾는다 —
`Request|Response|Snapshot|Message|Event|Payload|Command|Envelope|Frame|Notification`.
이름 규칙이라 오탐이 나고, 무엇을 옮기고 무엇을 두는지는 규칙의 **목적**으로 판단한다.
목적은 하나다: **양쪽이 합의해야 하는 형태가 한쪽에만 있으면 둘이 어긋난다.**

옮긴 것:

| 타입 | 어디로 | 왜 |
| --- | --- | --- |
| `ResultPayload` | `common/protocol/result/` | result 이벤트에 그대로 저장되어 클라이언트 소켓으로 나간다 |
| `MetricsSnapshot` | `common/protocol/metrics/` | HTTP로 서빙되어 이 프로세스 밖에서 읽는다 |

지운 것:

* `StreamEvent = EventEnvelope` — 이름만 바꾸는 별칭이었다. 아무도 그 이름으로
  import하지 않았고, 별칭은 새 의미를 주지 않으면 읽는 사람에게 한 단계를 더 시킬 뿐이다.

두고 판단을 기록한 것:

| 타입 | 판단 |
| --- | --- |
| `AuthedRequest` | Express `Request` 확장. 우리 wire가 아니라 프레임워크 타입이다 |
| `EventQueueMessage` | PGMQ 전송 내부 형태. 소켓에도 HTTP에도 나가지 않는다 |
| `DatabasePoolSnapshot` | 진단용 내부 값. 지표로 나갈 때는 `MetricsSnapshot`의 필드로 평평해진다 |
| `PendingMessage` (vibeagent_domain) | DB insert 인자. 이름이 `Message`에 걸린 것뿐이다 |
| `ChatMessage` (vibeagent_domain) | **제3자** 추론 API로 나가는 형태다. 규칙의 목적인 "양쪽"이 이 저장소 안에 없고, `common`에 두면 클라이언트가 알 이유 없는 형태를 보게 된다 |
