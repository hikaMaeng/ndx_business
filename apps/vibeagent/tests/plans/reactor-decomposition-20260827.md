# 제어 없는 반응기 분해 — 검증 계획

## 목표

턴을 돌리던 `for` 루프를 없애고, **다른 워커를 모르는 반응기들**이 fact만 남기며
연쇄하는 구조가 실제로 도는지 확인한다.

바뀐 것을 한 줄로: 어떤 함수도 흐름을 쥐지 않는다. 반복도 분기도 어느 함수 안에 없고,
`fact → 반응표 → 반응기 → fact` 의 고리로만 존재한다.

## 환경

- 컨테이너: `admin`, `vibeagent`(브로커), `vibeagent-worker`, **`vibeagent-dispatcher`**
- 큐: `vibe_intake`, `vibe_model`, `vibe_decide`, `vibe_tool`, `vibe_join`
- 추론 `192.168.0.6:12345/v1`, 모델 `nvidia-nemotron-3.5-lightning-30b-a3b`
- 클라이언트 `http://localhost:18081`, 계정 `vibe@example.com`
- 검증은 **크롬 확장**으로 실제 브라우저에서 한다

## 사전 조건

1. `npm run lint`, `npm test` 통과
2. 세 역할이 각자 기동 로그를 낸다
   - 워커: `queues` 에 다섯 큐가 전부 있어야 한다
   - 디스패처: `actions` 에 반응표의 fact 다섯이 있어야 한다
3. 디스패처가 **로그 끝에서 시작**해야 한다 (`broker.fact.dispatch.seeded`).
   과거를 재생하면 이미 끝난 턴을 새 일감으로 뿌린다

## 단계

1. **프로젝트 추가** — 새 폴더를 만든다. 세션은 그 아래에서만 만든다
2. **세션 개설** — `session.open` 이 intake 큐를 거쳐 반응기에 닿고, `session.opened`
   fact가 클라이언트에 도착해 입력창이 열리는지 본다
3. **턴 1** — 계산기 생성. 이벤트 흐름이 아래 순서로 로그에 남는지 확인한다
   ```
   turn.run → turn.started → model.replied → tool.requested
            → tool.started/stdout/completed → iteration.ready → turn.final
   ```
4. **폭주 감시** — `iteration.started` 가 15를 넘으면 즉시 중단하고 원인을 본다.
   반응기가 자기 dispatch에 반응하면 무한히 돈다
5. **산출물 조작** — 브라우저에서 버튼을 눌러 계산 결과를 읽는다. 자기 보고는 증거가 아니다
6. **턴 2 이상** — 결함이 있으면 같은 세션에서 고치게 한다. 각 세션 2턴 이상
7. **audience 확인** — 워커끼리만 오간 fact가 클라이언트 채널 읽기에 섞이지 않았는지 본다

## 기대 결과

- `turn.final` 이 정확히 턴 수만큼
- `iteration.started` 가 실제 이터레이션 수와 같다 (폭주 없음)
- 다섯 반응기가 각각 자기 fact에만 반응한 흔적이 로그에 남는다
- `model.replied`, `tool.requested`, `iteration.ready` 는 `audience=worker`
- `turn.started`, `tool.completed`, `iteration.*`, `turn.final` 은 `audience=client`
- 계산기가 실제 클릭에 올바른 값을 낸다

## 로케이터 계약

`data-testid` 만 쓴다.

| 대상 | 로케이터 |
| --- | --- |
| 로그인 | `input[name=email]`, `input[name=password]`, `[data-testid=login-submit]` |
| 프로젝트 | `[data-testid=add-project]`, `[data-testid=project-input]`, `[data-new-session="<폴더>"]` |
| 세션 폴더 | `[data-testid=session-workspace]` |
| 입력/전송 | `[data-testid=prompt-input]`, `[data-testid=run-turn]` |
| 턴 상태 | `[data-testid=turn]`, `[data-testid=turn-phase]`, `[data-testid=turn-answer]` |
| 블록 구분 | `[data-testid=block-kind]`, `[data-testid=block-live]` |
| 도구 | `[data-testid=tool-run]`, `[data-testid=tool-status]`, `[data-testid=tool-command]` |
| 계산기 | 생성물의 `#display`, `#btn-*` — 프롬프트로 강제한 계약 |

## 남길 로그

- 세 서비스의 기동 로그
- 세션별 `action / kind / audience` 집계 — 이것이 연쇄의 증거다
- 디스패처 seed 로그
- 계산기 조작 입력과 출력 쌍
