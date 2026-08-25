# agent 제약

| export | 소비자 | 불변식 |
| --- | --- | --- |
| `common` event | Gateway, Worker, Router, WebSocket client | `eventId`는 immutable, `sequence`는 문자열, canonical sequence는 server append만 발급 |
| `common` channel | Gateway WebSocket, frontend | cursor는 opaque UUID이며 subscribe channel 집합과 결합됨 |
| `server` ID | Worker | result ID namespace는 command·conflict와 충돌하면 안 됨 |
| `server` handlers | Worker Thread | unknown action은 현재 acknowledge fallback이 실행됨 |
| `front` model | Agent frontend | UI는 parsed server frame만 반영 |

`transactionKey`는 client 재시도에서 유지한다. 같은 key에 action 또는 payload가 다르면 `ExecutionStore`가 conflict로 처리한다. `replyChannel`은 실행 내용이 아니라 result 주소이므로 transaction 합류 여부를 정하는 payload hash에 넣지 않는다.

`streamIdOf`는 session이 있으면 `session:<sessionId>`, 없으면 `channel:<channel>`을 만든다. derived event는 원 command의 `streamId`, `transactionKey`, correlation, `causationEventId`를 계승한다.
