# PGMQ 복합 부하 검증

실행 환경: Gateway·Worker·Router 컨테이너, Worker Thread 96개. 이 문서는 절대값을 현재 상태의 보장으로 제시하지 않으며, 각 실행일·commit·출력은 operations report에 별도로 남긴다.

## 실행 명령

```powershell
$env:AGENT_METRICS_TOKEN = "<AGENT_METRICS_TOKEN>"
node apps/agent/tests/load/pgmq-composite-workload.mjs
```

Harness는 Docker의 `admin` PostgreSQL 컨테이너를 읽어 event store, execution, PGMQ queue를 검증한다. 따라서 실제 Compose stack에서만 실행한다.

성공한 run은 종료 시 자신의 timestamp prefix에 속한 event, execution, recipient, cursor, outbox, watermark를 하나의 PostgreSQL transaction으로 제거하고 각 잔여 수가 0인지 다시 확인한다. watermark 대상은 `session:<prefix>%`와 `channel:<prefix>%` 모두이며, harness는 sessionKey 없는 command 한 건으로 channel watermark 정리도 실제 검증한다. 실패한 run은 원인 분석을 위해 자동 정리하지 않는다.

## 기본 workload

| 항목 | 값 |
| --- | ---: |
| 독립 delay 실행 | 2,048 × 5,000ms |
| Worker Thread | 96 |
| stream | 512 session stream + sessionKey 없는 channel stream 1개 |
| transaction join | 128건, 다른 reply channel 추가 |
| payload conflict | 32건 |
| visibility probe | 배포 Worker의 visibility보다 긴 delay 1건, execution lease는 그보다 길어야 함 |
| 논리 channel / WebSocket subscriber | 7 / 14 |

delay 실행의 worker-only 하한은 `ceil(2048 / 96) × 5,000 = 110,000ms`다. 기본 허용 시간은 하한 + 20,000ms다. visibility probe는 throughput command보다 먼저 보내므로 65초가 benchmark의 직렬 tail이 되지 않는다.

하네스는 terminal result마다 `agent_gateway_delivery`의 delivered row가 정확히 하나 생성되고, 미완료·재시도·dead handoff가 0인지도 검사한다. 성공 run 정리는 이 ledger까지 삭제한 뒤 0건을 단언한다. `AGENT_TERMINAL_PERSISTENCE_ALERT_ATTEMPTS=10`, `AGENT_TERMINAL_PERSISTENCE_BACKOFF_MAX_SECONDS=300`, `AGENT_MAX_GATEWAY_DELIVERY_ATTEMPTS=10`도 컨테이너 env와 `/metrics.configuration`의 교차검증 대상이다. 기본 Gateway ID는 `agent`이며, 같은 ID의 두 번째 process는 queue 경쟁 소비 대신 lease 만료까지 passive standby로 대기한다.

## 통과 조건

1. 모든 subscriber가 예상 action·channel·성공/실패 값을 정확히 한 번 받는다.
2. event store 행 수는 command + terminal event 예상값과 같고, 모든 logical execution은 completed다.
3. visibility보다 긴 실행의 `agent_execution.attempts=1` 및 `queue_redeliveries=0`이다. 즉 PGMQ visibility heartbeat가 실제 재전달을 막았다.
4. command, result, Gateway queue의 workload prefix 잔여가 모두 0이다.
5. elapsed가 worker 하한 + overhead 이내다.

초기 harness는 65초 probe를 2,176개 delay command 뒤에 넣어 172,944ms로 실패했다. 이는 result Router 성능 저하가 아니라 probe 자체가 약 108초 queue 대기 후 실행된 test 설계 오류였다. probe를 먼저 시작하도록 고쳐 실제 critical path를 측정한다.
