# Gateway handoff와 channel watermark 검증

실행일: 2026-08-24
대상: 배포된 Gateway·Worker·Router·PostgreSQL

## 종료 ownership

단위 테스트는 다음 순서를 제어 가능한 promise로 고정한다.

```text
reader.stop -> reader.done -> sockets.close -> http.closed
-> subscriptions.removed -> ownership.released
```

실 DB에서는 WebSocket으로 `verify-shutdown-1787501432106` channel을 subscribe해
`agent_gateway_subscription` 1행을 만든 뒤 Gateway에 SIGTERM을 보냈다.
같은 `AGENT_GATEWAY_ID=agent`의 standby가 takeover한 직후 결과는 다음과 같다.

```text
old websocket client: SUBSCRIBED -> CLOSED
old channel subscription rows: 0
new agent_gateway_instance owner: 32a6246d-e15f-4390-a9d5-bfe60743a1aa
```

즉 새 owner가 `agent_gateway_agent` queue를 소비하기 시작했을 때 Router가 이전
WebSocket connection을 대상으로 결과를 fan-out하는 row는 남지 않았다.

## Standby liveness/readiness

동일 Gateway ID의 별도 컨테이너에서 확인했다.

```json
[["health",200],["ready",503],["api/events",503]]
```

컨테이너는 실행 상태였고 `gateway.identity.waiting`만 기록했다. 따라서 Docker
healthcheck는 liveness를 통과하고, `/ready`와 ingress는 ownership 미획득을 명확히
표현한다.

## 복합 부하와 channel watermark

성공 run: `pgmq-composite-1787501703516`

```text
workers=96 total=2048 delayMs=5000
join=128 conflict=32 channel-stream=1
channels=8 subscribers=16
elapsedMs=113101 (worker lower bound=110000, allowance=130000)
terminalP50/P95/P99=54243/106249/110829ms
expectedTerminalCount=2242 eventRows=4484 completedExecutions=2082
leaseAttempts=1 leaseRedeliveries=0
agent_requests=0 agent_results=0 agent_gateway_agent=0
```

성공 후 DB 재확인:

```text
events=0 executions=0 recipients=0 outbox=0
session_watermarks=0 channel_watermarks=0
```

channel probe는 `sessionKey` 없이 `channel:<prefix>.channel-input` watermark를 실제로
만든다. 따라서 이제 harness의 cleanup과 0행 검증은 session stream에만 한정되지
않는다.

초기 channel probe run `pgmq-composite-1787501543370`은 harness 기대값 등록 누락으로
실패했다. DB 대조로 서비스 result가 정상임을 확인한 뒤 기대값 등록과 failure payload
출력을 보강해 위 run으로 재검증했다. 분석 종료 후 그 prefix의 event 4,484건,
execution 2,082건, recipient 2,210건, outbox 2,242건, cursor 16건, session/channel
watermark 546건을 정확한 prefix transaction으로 정리했고 잔여 0건을 확인했다.

## Port continuity

standby listener는 ownership 획득 뒤 닫지 않는다. 같은 bound HTTP server의 request
handler를 active Gateway handler로 교체한다. 따라서 schema·queue·retention 초기화가
끝나는 동안에도 `/health`는 계속 응답하고, active 전환에서 port rebind 공백이 없다.

공식 Gateway·Worker·Router deploy 중 health probe는 `{"status":"ok","service":"agent",
"ready":false}`를 받았고, ownership 획득 뒤 최종 `/health`는
`{"status":"ok","service":"agent"}`로 전환됐다. 즉 replace 구간은 연결 거부가 아닌
명시적 standby liveness로 관측됐다.
