# Gateway 소유권·부하 정리 검증

실행일: 2026-08-24
대상: 배포된 `agent` Gateway, `agent-worker`, `agent-router`, Docker PostgreSQL

## 검증한 계약

1. 같은 `AGENT_GATEWAY_ID`의 대기 Gateway는 종료하거나 queue를 읽지 않고 lease 만료까지 대기한다.
2. Gateway 소유권을 얻기 전에는 retention sweep·queue consumer·HTTP/WebSocket listener를 시작하지 않는다.
3. 성공한 복합 부하 run은 자기 prefix의 event/execution/recipient/outbox/cursor/watermark를 모두 제거한다. 실패 run은 남겨 분석 가능해야 한다.
4. `event_store` retention 조회는 `stored_at` index를 사용한다.

## 실행 결과

### Passive standby

동일 Gateway ID로 별도 컨테이너를 띄운 뒤 2초 동안 확인했다.

```text
container=running
portListeners=0
{"event":"gateway.identity.waiting","gatewayId":"agent","retryAfterMs":12703}
```

대기 인스턴스는 crash loop 없이 살아 있었고 HTTP/WebSocket listener와 PGMQ reader를 시작하지 않았다.

정상 종료 handoff도 현재 Gateway를 `docker restart agent`로 교체해 확인했다. 후속 Gateway의 최대 대기 로그는 `retryAfterMs=5082`였다. 종료가 reader 중지 후 ownership release 순서로 수행되어, 정상 handoff 지연은 30초 lease가 아니라 최대 PGMQ poll 5초에 수렴한다. 강제 종료(SIGKILL)는 기존 lease 만료(최대 30초) 뒤 takeover한다.

### Retention index

```sql
SET enable_seqscan = off;
EXPLAIN SELECT event_id FROM event_store
WHERE stored_at < now() - interval '30 days';
```

결과: `Index Scan using event_store_stored_at_idx`.

### 복합 부하 및 자동 정리

`pgmq-composite-workload.mjs`를 96 Worker Thread, 2,048개의 5초 delay 실행, 128 join, 32 conflict, 7 channel, 14 subscriber로 실행했다.

```text
elapsedMs=115705
terminalP50Ms=55733
terminalP95Ms=110094
terminalP99Ms=113434
workerLowerBoundMs=110000
expectedTerminalCount=2241
eventRowsBeforeCleanup=4482
completedExecutionsBeforeCleanup=2081
leaseAttempts=1
leaseRedeliveries=0
agent_requests=0 agent_results=0 agent_gateway_agent=0
terminalPersistenceAlerts=0 expiredExecutionLeases=0
```

성공 판정 뒤 harness가 수행한 prefix-scoped 정리의 DB 재확인 결과:

```text
events=0 executions=0 recipients=0 outbox=0 cursors=0 watermarks=0
requestQueue=0 resultQueue=0 gatewayQueue=0
```

이전의 불완전했던 `pgmq-composite-*` run도 같은 정확한 prefix 조건으로 별도 정리했고, 다른 transaction prefix는 대상으로 삼지 않았다.
