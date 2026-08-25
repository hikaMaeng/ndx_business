# vibeagent API

## HTTP — 인증과 바이트만

| 경로 | 계약 |
| --- | --- |
| `POST /api/vibe/auth/login` | admin으로 프록시. `sessionToken`과 user를 반환 |
| `POST /api/vibe/auth/signup` | admin으로 프록시. 승인 정책에 따라 `active` 또는 `pending` |
| `GET /api/vibe/me` | 세션 검증 후 현재 user |
| `GET /workspace/<sessionKey>/...` | 에이전트가 생성한 파일. 읽기 전용 |
| `GET /health` · `/ready` · `/metrics` | broker 표준 |

admin이 compose 내부 네트워크에만 있으므로 브라우저는 직접 닿을 수 없다. 그래서 redirect가 아니라 프록시다.

## WebSocket `/ws?session=<token>` — 에이전트와의 모든 대화

업그레이드 시점에 토큰을 검증하고, 실패하면 `401`로 핸드셰이크를 거절한다. 브라우저는 핸드셰이크에 헤더를 붙일 수 없어 토큰이 query에 실린다.

### client → server

```json
{ "type": "subscribe", "channels": ["vibe.<sessionKey>"], "cursor": "optional" }
{ "type": "event", "action": "vibe.turn.run", "transactionKey": "<turnKey>",
  "payload": { "sessionKey": "<sessionKey>", "prompt": "..." } }
```

`userId`는 보내도 무시된다. 서버가 연결의 신원으로 덮어쓴다. `sessionKey`가 그 사용자 소유가 아니면 연결이 끊긴다. `vibe.turn.run` 외의 action도 거절된다.

### server → client

`ready`·`subscribed`·`event`·`replay` 네 frame. 진행 이벤트 목록은 [vibeagent_domain API](../../../packages/vibeagent_domain/docs/api.md)를 따른다.
