# Agent 내부 동작

## Worker consume

[`startWorkerConsumer`](../../packages/agent_domain/src/broker/loops/worker-consumer.ts)는 PGMQ command를 읽고 [`toEventDraft`](../../packages/agent_domain/src/broker/ingress/event-draft.ts)로 canonical command를 만든다. [`ExecutionStore.claim`](../../packages/agent_domain/src/broker/idempotency/store.ts)이 세 상태 중 하나를 반환한다.

- `claimed`: Worker Thread handler를 실행하고 result를 만든다. `attempts`는 PGMQ read count가 아니라 fenced execution owner가 된 횟수다.
- `joined`: 같은 transaction이 실행 중이거나 완료됐다. 실행 중인 최초 request의 visibility 재전달만 source message를 남겨 lease reclaim을 보존하고, 다른 event ID의 새 duplicate는 delete한다.
- `conflict`: 같은 transactionKey에 다른 action/payload가 들어왔다. 요청자 channel에 conflict result를 보낸다.

claimed attempt는 visibility timeout의 1/3 주기로 PGMQ visibility와 DB execution lease를 각각 갱신한다. DB execution lease 갱신이 실패하면 다른 attempt가 소유권을 얻은 것이므로 handler를 abort한다. PGMQ `set_vt`의 일시 실패는 abort하지 않는다. 이때 재노출된 source message는 미완료 join으로 보존되어, owner가 죽을 때만 안전하게 reclaim된다.

Worker 소실은 handler 오류와 다르다. 소실된 attempt가 execution 상한보다 낮으면 Worker는 자기 execution lease만 즉시 만료시키고 source message는 남긴다. 다음 PGMQ delivery가 같은 transaction을 reclaim한다. 마지막 소실 attempt는 execution을 terminal failure로 fence 완료하고, recipient별 `*.processing.failure` event와 outbox row를 먼저 transaction으로 기록한 뒤 source message를 archive한다. 따라서 archive가 관측 가능한 terminal event보다 앞설 수 없다.

## fan-out

같은 transaction에 다른 `replyChannel`이 합류하면 [`agent_execution_recipient`](../../packages/agent_domain/src/broker/idempotency/store.ts) row가 추가된다. terminal result를 만들 때 Worker는 recipient마다 `channel`을 바꾼 canonical event와 [`agent_result_delivery`](../../packages/agent_domain/src/broker/delivery/store.ts) outbox row를 같은 transaction으로 만든다. publisher는 outbox row를 lease claim하여 result queue로 전송한 뒤 같은 attempt id로 완료 fence를 건다. Router는 `agent_gateway_subscription`을 조회해 해당 Gateway 전용 queue로 복제한다.

outbox claim은 ready retry와 만료 running lease를 별도 partial-index CTE에서 가져온다. terminal outbox가 commit되면 같은 Worker process의 publisher를 coalesced wakeup으로 즉시 깨우고, wakeup 유실·재기동 뒤에는 50ms에서 최대 1초까지의 bounded poll이 복구한다. 따라서 wakeup은 latency 최적화일 뿐 durable 사실이 아니다. queue send 뒤 completion fence 일부만 잃으면 확인된 event는 재발행하지 않고 잃은 fence만 retry한다. retry 한도에 도달한 row는 `dead`와 오류 원인을 남긴다.

이 과정은 전달을 한 번만 보장하지 않는다. 동일 event가 result queue·Gateway queue·WebSocket에서 다시 보일 수 있다. event store append는 같은 `eventId`를 하나의 저장 행으로 수렴시키지만, 최종 client는 `eventId` dedupe가 필요하다.

## cursor와 느린 소켓

WebSocket은 구독 직후 high-water mark를 잡고 과거 event replay와 이후 live event를 합친다. connection mailbox와 replay buffer는 각각 상한을 넘는 느린 consumer를 닫아 다른 소켓의 진행을 막지 않는다. cursor position은 event를 socket에 성공적으로 보낸 뒤 DB에 갱신된다.

## 결정 사항

- PGMQ는 일감 인계, PostgreSQL은 순서·상태·구독의 사실 원천이다. 이유: Gateway와 Worker를 독립 배치한다.
- Worker는 command를 직접 Gateway로 되돌리지 않고 result queue에 쓴다. 이유: Router가 다수 Gateway의 fan-out 위치를 한 곳으로 만든다.
- 미완료 join의 최초 request만 delete하지 않는다. 이유: visibility 재전달된 원본을 지우면 실행 lease 만료 뒤 재처리할 trigger가 사라진다.
- router는 구독 Gateway가 없는 result를 delete하지 않는다. 이유: submit과 subscribe의 순서 차이 또는 Gateway lease 갱신 실패가 결과 유실이 되어서는 안 된다.
- `event_stream_sequence`는 retention과 독립된 stream watermark다. 이유: 보관된 event가 모두 사라져도 살아 있는 cursor가 더 작은 새 sequence를 영구히 건너뛰면 안 된다.
- Gateway queue identity는 `agent_gateway_instance` lease로 단일 process만 소유한다. 이유: 동일 ID의 replica가 queue를 경쟁 소비하면 다른 replica의 WebSocket event를 삭제할 수 있다.
- 만료 execution lease는 observer가 terminalise하지 않는다. 이유: PGMQ 재전달이 fenced reclaim을 수행할 권리를 갖고, terminal result는 Worker transaction만 기록할 수 있다.
- Gateway는 `agent_gateway_instance` lease를 먼저 확보한 뒤에만 다른 schema 초기화, queue 보장, retention, socket delivery를 시작한다. 이유: 대기·중복 Gateway가 운영 데이터를 정리하거나 queue를 경쟁 소비하면 안 된다.
- standby Gateway는 ownership 대기 중 `/health`만 200으로 제공하고 `/ready`·WebSocket upgrade는 503으로 거절한다. ownership 뒤에는 같은 bound HTTP server에서 standby request listener만 제거하고 active handler를 붙인다. 이유: retention 초기화 시간과 무관하게 host port liveness를 유지하면서 나중에 추가될 다른 request listener를 제거하지 않는다.
- 정상 Gateway handoff는 queue reader 종료 뒤 socket·HTTP 연결을 닫고 subscription row 삭제까지 기다린 뒤 instance lease를 해제한다. 이유: 새 Gateway가 같은 queue를 소비하는 순간에는 Router가 이전 Gateway의 연결을 대상으로 fan-out하지 않아야 한다. HTTP keep-alive는 `closeAllConnections()`로 강제 종료해 ownership 반납을 지연시키지 않는다.
