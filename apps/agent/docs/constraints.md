# Agent 제약

## 전달 보장

Worker는 command를 canonical event로 append하고 terminal result를 `AGENT_RESULT_QUEUE`에 보낸 뒤 원본 PGMQ message를 delete한다. 실행 중에는 execution lease와 PGMQ visibility를 함께 연장한다. 이 규칙은 Worker 장애 뒤 원본 command가 다시 나타나 execution을 reclaim할 수 있게 한다.

이미 실행 중인 transaction으로 판정된 message 중 최초 `requestEventId`와 같은 것은 delete하지 않는다. 이 message가 visibility 재전달된 원본일 수 있기 때문이다. 새 client 재제출처럼 event ID가 다른 duplicate는 안전하게 delete한다. 실행이 완료되면 원 Worker 또는 재전달 consumer가 terminal result를 만들고 delete한다.

PGMQ와 Gateway delivery는 at-least-once다. 따라서 consumer는 `eventId`로 중복을 제거해야 한다. Worker가 command를 terminal 상태로 만들기 전 지속 실패하면 `AGENT_MAX_ATTEMPTS`번째 read에서 PGMQ archive로 옮기고, canonical command를 만들 수 있는 경우 `*.processing.failure` event를 result queue에 보낸다. 정상 handler 오류는 `worker_failed` terminal result다.

## 식별성과 소비자

| 표면 | 소비자 | 바꾸면 안 되는 규칙 |
| --- | --- | --- |
| `EventEnvelope` | Worker, Router, Gateway, WebSocket client | `eventId`는 immutable이고 `sequence`는 문자열 bigint다. |
| `transactionKey` | `ExecutionStore`, client 재시도 | 같은 payload 재시도는 실행을 합치며, 다른 payload는 conflict다. |
| `replyChannel` | recipient table, Router, WebSocket 구독 | 논리 수신 주소이며 PGMQ queue 이름이 아니다. |
| cursor | WebSocket client, `EventStore` | token은 opaque UUID이며 channel 집합이 바뀌면 재사용할 수 없다. |

`streamId`는 session이 있으면 `session:<id>`, 없으면 `channel:<channel>`이다. sequence는 이 stream 안에서만 순서를 뜻한다.

## 현재 미구현 범위

recipient별 전달 완료 ledger와 다중 Gateway Compose 배포는 현재 미구현 범위다. `AGENT_RETENTION_DAYS`(기본 30일)가 지난 event·완료 execution/recipient·cursor와 만료 subscription은 Gateway 기동 및 시간당 정리에서 삭제한다. Gateway queue 자체는 Gateway ID 단위로 생성되므로 운영자는 오래된 Gateway queue를 배포 운영 절차에서 제거해야 한다.
