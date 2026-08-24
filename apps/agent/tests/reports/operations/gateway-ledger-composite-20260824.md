# Gateway ledger 복합 부하 증적 — 2026-08-24

## 목적

Router가 결과 PGMQ source를 ACK하기 전에 Gateway별 durable handoff ledger를 만들고, 정상 경로에서 모든 row를 `delivered`로 끝내는지 배포 stack으로 검증했다. 이 변경은 Router hot path에 DB 기록·조회·완료를 추가했으므로 단위 테스트만으로 완료를 선언하지 않는다.

## 대상과 방법

- 배포 대상: `agent` Gateway, `agent-worker`, `agent-router`, 96 Worker thread
- 실행: `node apps/agent/tests/load/pgmq-composite-workload.mjs`
- workload: 독립 delay 2,048건(각 5초), join 128건, payload conflict 32건, 65초 visibility probe, 8 channel·16 WebSocket subscriber
- acceptance: 각 terminal result에 `agent_gateway_delivery.delivered` row 정확히 한 건, `ready/dead` 0건, 모든 PGMQ backlog 0건, 실행·전달 정리 뒤 prefix 잔여 0건

## 결과

```json
{
  "elapsedMs": 112550,
  "lowerBoundMs": 110000,
  "expectedTerminalCount": 2242,
  "eventRows": 4484,
  "completedExecutions": 2082,
  "leaseAttempts": 1,
  "leaseRedeliveries": 0,
  "gatewayDeliveryRows": 2242,
  "gatewayDeliveryUndelivered": 0,
  "queues": {
    "agent_requests": 0,
    "agent_results": 0,
    "agent_gateway_agent": 0
  }
}
```

측정 시간은 worker-only 하한보다 2,550ms 높고 허용 상한(130,000ms) 안이다. Router ledger retry/dead-letter, unmatched result, broker read failure, visibility renew failure는 모두 0 증가였다. 하네스는 성공 뒤 `agent_gateway_delivery`까지 삭제하고 prefix 행 0건을 확인했다.

별도로 실 DB에서 격리한 handoff row에 실패 전이 SQL을 실행해 `dead|1|probe queue unavailable`을 확인한 뒤 해당 probe row를 즉시 삭제했다. 이는 Gateway queue가 지속 실패할 때 `AGENT_MAX_GATEWAY_DELIVERY_ATTEMPTS` 예산 후 source의 무한 재전달 대신 `dead`·`last_error`가 남는 경로의 SQL 유효성 증적이다.
