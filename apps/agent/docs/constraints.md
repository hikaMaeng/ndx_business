# Agent 제약

## 전달 보장

Worker는 command를 canonical event로 append한다. terminal event와 `agent_result_delivery` outbox 행은 하나의 PostgreSQL transaction으로 기록되고, 별도 publisher가 outbox를 `AGENT_RESULT_QUEUE`에 전송·fence 완료한 뒤에만 delivered로 표시한다. Worker는 이 durable handoff가 끝난 뒤에만 원본 PGMQ message를 delete한다. 실행 중에는 execution lease와 PGMQ visibility를 함께 연장한다. 이 규칙은 Worker 장애 뒤 원본 command가 다시 나타나 execution을 reclaim할 수 있게 한다.

execution attempt와 terminal persistence retry는 다른 예산이다. handler owner를 잃었을 때만 `AGENT_MAX_EXECUTION_ATTEMPTS`를 소비한다. 완료된 execution의 terminal event append·source ACK가 실패하면 source message를 남기고 다시 시도한다. immutable terminal event가 없으면 포기할 수 없으므로 이 경로는 execution attempt를 소비하지 않는다. terminal persistence 실패가 PGMQ read count `AGENT_TERMINAL_PERSISTENCE_ALERT_ATTEMPTS` 이상에서 일어나면 매 실패를 `terminalPersistenceAlerts`와 구조화 오류로 기록한다. read count는 다른 재전달 사유로 임계를 건널 수 있으므로 엄격 일치를 사용하면 안 된다.

이미 실행 중인 transaction으로 판정된 message 중 최초 `requestEventId`와 같은 것은 delete하지 않는다. 이 message가 visibility 재전달된 원본일 수 있기 때문이다. 새 client 재제출처럼 event ID가 다른 duplicate는 안전하게 delete한다. 실행이 완료되면 원 Worker 또는 재전달 consumer가 terminal result를 만들고 delete한다.

PGMQ와 Gateway delivery는 at-least-once다. 따라서 consumer는 `eventId`로 중복을 제거해야 한다. `AGENT_MAX_DELIVERY_READS`는 Router가 매칭되지 않는 result를 archive하는 PGMQ read 횟수 상한이며 실행 retry 예산이 아니다. `AGENT_MAX_EXECUTION_ATTEMPTS`는 execution lease를 실제로 획득한 Worker attempt의 상한이다. Worker 소실은 lease를 반납하고 source message를 남겨 다음 delivery가 reclaim하게 한다. 마지막 attempt도 소실되면 `*.processing.failure` event를 모든 recipient channel에 outbox로 기록한 뒤 source message를 archive한다. 정상 handler 오류는 `worker_failed` terminal result다. outbox 전송 실패는 `AGENT_MAX_OUTBOX_ATTEMPTS`까지 backoff하며, 이후 `dead` row·`last_error`·`outboxDeadLetters`로 종결한다. dead row는 자동 삭제하지 않으며 queue를 복구한 뒤 운영자가 재처리하거나 감사 후 제거한다.

## 식별성과 소비자

| 표면 | 소비자 | 바꾸면 안 되는 규칙 |
| --- | --- | --- |
| `EventEnvelope` | Worker, Router, Gateway, WebSocket client | `eventId`는 immutable이고 `sequence`는 문자열 bigint다. |
| `transactionKey` | `ExecutionStore`, client 재시도 | 같은 payload 재시도는 실행을 합치며, 다른 payload는 conflict다. |
| `replyChannel` | recipient table, Router, WebSocket 구독 | 논리 수신 주소이며 PGMQ queue 이름이 아니다. |
| cursor | WebSocket client, `EventStore` | token은 opaque UUID이며 channel 집합이 바뀌면 재사용할 수 없다. |

`streamId`는 session이 있으면 `session:<id>`, 없으면 `channel:<channel>`이다. sequence는 이 stream 안에서만 순서를 뜻한다.

## 현재 미구현 범위

recipient별 Gateway 전달 완료 ledger와 다중 Gateway Compose 배포는 현재 미구현 범위다. `agent_result_delivery`는 Worker→result queue 구간의 fenced delivery ledger이며 delivered 행만 `AGENT_RETENTION_DAYS`(기본 30일) 뒤 제거한다. 같은 기간이 지난 event·완료 execution/recipient·cursor와 만료 subscription도 Gateway 기동 및 시간당 정리에서 삭제한다. `event_stream_sequence`는 cursor보다 오래 살아야 하는 영구 watermark이므로 event 보관 정리 대상으로 삼지 않는다. 만료 `running` execution도 정리 작업이 실패로 바꾸지 않는다. retained PGMQ command가 reclaim할 수 있으므로, 만료 건수는 `expiredExecutionLeases` gauge·경고로 관측하고 terminal 상태 변경은 fenced Worker attempt만 할 수 있다. Gateway는 instance lease를 먼저 얻기 전에는 queue 생성·retention·사용자 요청 endpoint·WebSocket을 시작하지 않는다. standby는 `/health`만 200으로 제공하고 `/ready`와 WebSocket upgrade는 503으로 거절한다. Docker HEALTHCHECK와 Agent deploy 검증은 `/ready`를 사용한다. ownership 뒤에는 same bound server의 handler를 교체하므로 startup port gap이 없다. 종료 owner는 reader를 멈춘 뒤 모든 socket과 HTTP 연결을 닫고 durable subscription 삭제가 끝난 후에만 instance lease를 해제한다. WebSocket `1001` close는 best-effort이며 연결 강제 종료에서는 `1006`도 가능하다. 같은 ID의 Gateway는 live owner가 있는 동안 passive standby로 대기하며, SIGKILL 뒤에는 최대 subscription lease 기간(기본 30초) 후 takeover한다.
