# 라우터 제거와 로그 tail 전달 — 검증 계획

## 목표

결과 전달을 큐(결과 큐 → 라우터 → Gateway별 큐)에서 **append-only 로그 tail**로 바꾼 뒤에도
전달 보장이 유지되는지, 그리고 구 구조가 실제로 경로에서 빠졌는지 확인한다.

바뀐 것을 한 줄로: 큐는 일감을 정확히 한 Worker에게 주는 자리에만 남기고, 결과는
`event_store`에 append하는 것으로 발행을 끝낸다. Gateway는 그 로그를 자기 커서부터
따라 읽는다. 읽어도 아무것도 바뀌지 않으므로 Gateway끼리 서로를 막지 않는다.

## 환경

- 호스트 Windows 11 + Docker Desktop, 빌드/테스트는 WSL에서 실행
- 컨테이너: `admin`, `vibeagent`(gateway), `ndx-business-vibeagent-worker-1`
  — `vibeagent-router`는 compose 정의에서 제거되어 존재하지 않아야 한다
- 추론 서버 `192.168.0.6:12345/v1`, 모델 `nvidia-nemotron-3.5-lightning-30b-a3b`
- 클라이언트 `http://localhost:18081`, 계정 `vibe@example.com`
- 프로젝트 루트는 호스트 바인드 마운트 `${VIBE_WORKSPACE_HOST_DIR:-./workspace}`

## 사전 조건

1. `npm run lint`, `npm test` 통과
2. `npm run deploy -- vibeagent` 성공, `/ready` 200
3. 구 전달 구조가 **비어 있음**을 먼저 확인한 뒤 제거한다. 미전달 메시지가 하나라도
   있으면 제거하지 않고 중단한다:
   `pgmq.q_agent_results`, `pgmq.q_agent_gateway_*`,
   `agent_result_delivery`/`agent_gateway_delivery`의 `ready|running` 행

## 단계

1. **구조 제거** — 위가 전부 0인 것을 확인한 뒤 결과 큐 1개, Gateway 큐 2개,
   테이블 3개(`agent_result_delivery`, `agent_gateway_delivery`,
   `agent_gateway_subscription`, `agent_gateway_instance`)를 삭제한다.
   삭제 후 남은 운영 큐와 테이블 목록을 기록한다.
2. **새 세션** — 로그인 → `새 세션` → 계산기 생성 프롬프트 제출.
   버튼 id 계약(`btn-7`, `btn-plus`, `btn-eq`, `btn-clear`, `display`)을 프롬프트에 명시한다.
3. **라이브 전달** — 턴이 `running`에서 `done`으로 바뀌는 동안 bash 실행과 최종 답변이
   화면에 도착하는지 본다. 이 이벤트는 오직 `pg_notify` → tail → hub → socket 경로로만 올 수 있다.
4. **산출물** — 호스트 `workspace/<session>/index.html` 존재와 버튼 id를 확인한다.
5. **실제 조작** — 브라우저에서 버튼을 눌러 계산 결과를 읽는다.
   자기 보고("만들었습니다")는 증거로 인정하지 않는다.
6. **세션 재개** — 사이드바에서 같은 세션을 다시 열어 과거 턴이 재생되는지 확인한다.
7. **다중 턴** — 결함이 있으면 같은 세션에서 수정 턴을 제출한다.
   턴이 누적되는 동안 tail이 계속 도는지도 함께 본다.
8. **구조 재생성 없음** — 모든 턴이 끝난 뒤 큐/테이블 목록을 다시 확인한다.

## 기대 결과

- `vibeagent-router` 컨테이너 없음
- 운영 큐는 `agent_requests` 하나, backlog 0
- `agent_*`/`event_*` 테이블은 `agent_execution`, `agent_execution_recipient`,
  `event_store`, `event_stream_sequence`, `event_subscription_cursor` 다섯 개
- 턴 진행과 결과가 지연 없이 화면에 도착한다
- 계산기가 실제 클릭에 올바른 값을 낸다
- 세션 재개 시 과거 턴이 전부 재생된다
- 구 큐·테이블은 어느 단계에서도 다시 생기지 않는다

## 로케이터 계약

구조 의존 선택자를 쓰지 않는다. `data-testid`만 사용한다.

| 대상 | 로케이터 |
| --- | --- |
| 로그인 | `input[name=email]`, `input[name=password]`, `[data-testid=login-submit]` |
| 사이드바/세션 | `[data-testid=sidebar]`, `[data-testid=session-item]`, `[data-testid=new-session]` |
| 세션 키 | `[data-testid=session-key]` |
| 프롬프트/전송 | `[data-testid=prompt-input]`, `[data-testid=run-turn]` |
| 턴 상태 | `[data-testid=turn]`, `[data-testid=turn-phase]`, `[data-testid=turn-answer]` |
| 도구 실행 | `[data-testid=tool-run]`, `[data-testid=tool-status]`, `[data-testid=tool-command]` |
| 연결 상태 | `[data-testid=connection-state]` |
| 계산기 | 생성물의 `#display`, `#btn-*` — 프롬프트로 강제한 계약 |

## 남길 로그

- `docker logs vibeagent` 의 `broker.gateway.listening`
- `docker logs ndx-business-vibeagent-worker-1` 의 `worker.server.started`
  — `resultQueue` 필드가 더 이상 없어야 한다
- 단계 1과 8의 큐·테이블 목록
- 계산기 조작 입력과 출력 쌍
