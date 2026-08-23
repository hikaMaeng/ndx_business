# Agent API

## HTTP

| 경로 | 계약 |
| --- | --- |
| `POST /api/events` | `action`과 object `payload`를 받아 `agent_requests`에 기록하고 `202`를 반환한다. |
| `GET /health` | Gateway 프로세스 생존을 `200`으로 반환한다. |
| `GET /ready` | PGMQ와 PostgreSQL 확인 성공 시 `200`, 실패 시 `503`을 반환한다. |
| `GET /metrics` | `AGENT_METRICS_TOKEN`이 없으면 `404`; 있으면 `Authorization: Bearer <token>`으로만 `200`을 반환한다. |

`POST /api/events`의 `action`은 필수다. `payload`가 object가 아니면 `{}`가 된다. 생략한 `channel`은 `agent.requests`, `replyChannel`은 `agent.results`, `transactionKey`는 서버 생성 UUID를 사용한다.

```json
{
  "action": "hash.sha256",
  "payload": { "input": "hello" },
  "transactionKey": "retry-safe-key",
  "channel": "agent.requests",
  "replyChannel": "orders.results"
}
```

`202`는 완료가 아니라 PGMQ 기록 성공이다. 응답의 `messageId`, `eventId`, `transactionKey`로 추적하고 terminal event는 WebSocket에서 받는다.

## WebSocket `/ws`

WebSocket client frame은 명령 또는 구독이다.

```json
{ "type": "subscribe", "channels": ["orders.results"], "cursor": "optional-opaque-uuid" }
```

`cursor`는 서버가 돌려준 불투명 UUID다. 없으면 새 cursor를 열고, 있으면 같은 channel 집합의 기존 position에서 replay를 시작한다. client는 `ready`, `subscribed`, `event`, `replay` 네 server frame을 처리해야 한다.

| server frame | 의미 |
| --- | --- |
| `ready` | 연결 직후 Gateway가 제공하는 기본 channel 목록 |
| `subscribed` | channel·cursor·첫 replay page의 완료 여부 |
| `event` | canonical `EventEnvelope`와 전달 뒤 갱신될 cursor |
| `replay` | mailbox가 비워진 뒤의 cursor와 replay 완료 여부 |

`replyChannel`은 물리 PGMQ queue 이름이 아니라 논리 주소다. Router가 DB 구독 정보를 사용해 어떤 Gateway queue로 fan-out할지 결정한다. Event type은 [`agent_domain common`](../../../packages/agent_domain/docs/api.md)을 따른다.
