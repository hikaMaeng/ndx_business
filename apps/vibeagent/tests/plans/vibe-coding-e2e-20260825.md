# Test Plan: vibe-coding-e2e

## Created

2026-08-25

## Goal

바이브코딩 에이전트가 **실제로 동작하는 웹페이지를 만들어내는지** 확인한다. 에이전트의 자기 보고("만들었습니다")는 증거로 취급하지 않는다. 생성된 페이지를 브라우저에서 열어 **조작했을 때 올바른 값이 나와야** 통과다.

함께 확인할 구조적 요구 네 가지.

1. 로그인부터 세션 개설, 턴 실행까지 브라우저에서 끊김 없이 이어지는가
2. 에이전트와의 이벤트 교환이 **전부 WebSocket**인가 (HTTP agent 라우트가 없어야 한다)
3. 도구가 **별도 OS 프로세스**로 실행되는가
4. 클라이언트가 보낸 신원을 서버가 신뢰하지 않는가

## Environment

- 저장소: `F:\dev\ndx_business-pgmq`, 브랜치 `master`
- 컨테이너: `admin`(PostgreSQL 18 + PGMQ + 계정), `vibeagent`(gateway, 18081), `ndx-business-vibeagent-worker-1`, `ndx-business-vibeagent-router-1`
- 추론: `nvidia-nemotron-3.5-lightning-30b-a3b` @ `192.168.0.6:12345/v1` (컨테이너에서는 `host.docker.internal:12345`)
- 추론 인자: temperature 0.15 · top_p 0.9 · max_tokens 8192
- 빌드·테스트는 WSL, 부하/E2E 스크립트와 docker 질의는 Windows

## Preconditions

- 추론 서버에 대상 모델이 로드돼 있을 것 (`lms ps`로 확인)
- worker 컨테이너에서 `bash`가 실행되고 `/workspace`가 쓰기 가능할 것
- `vibeagent`와 `vibeagent-worker`가 같은 `vibeagent_workspace` 볼륨을 공유할 것 — Gateway가 Worker의 산출물을 서빙해야 한다
- admin의 signup 정책이 `auto`이거나, 테스트 계정이 미리 승인돼 있을 것

## Steps

1. `npm run build` · `npm run lint`
2. `npm test --workspace agent` (62), `npm test --workspace vibeagent_domain` (14)
3. arch / compose / docs 검사를 **저장소 루트를 인자로 넘겨** 실행
4. `npm run deploy -- vibeagent vibeagent-worker vibeagent-router`
5. worker 컨테이너에서 추론 endpoint 도달과 `bash` 존재 확인
6. 계정 생성 → 로그인 (게이트웨이 프록시 경유)
7. `vibe-turn-e2e.mjs`로 계산기 턴 실행. 소켓 하나로 제출·수신
8. 생성된 `index.html`을 브라우저로 열고 **7×8, 12+3, C를 실제로 눌러** 결과 확인
9. 웹클라이언트에서 로그인 → 세션 → 턴 실행을 UI로 반복하고, 두 번째 산출물도 브라우저에서 조작 확인
10. 소켓 정책 확인: 인증 없는 업그레이드, 남의 `sessionKey`, 허용되지 않은 action이 각각 거절되는지

## Expected Results

| 항목 | 기대값 |
| --- | --- |
| agent 단위 테스트 | 62/62 |
| vibeagent_domain 단위 테스트 | 14/14 |
| arch / compose / docs | 셋 다 `violations=0` |
| worker 번들 크기 | 20KB 미만 (`pg`·`express`·`ws` 미포함) |
| 배포 `/ready` | 200 |
| 턴 terminal | `ok: true`, `stoppedBy: "final"` |
| 도구 실행 | bash가 자식 프로세스로 1회 이상, exit 0 |
| 생성 페이지 서빙 | `/workspace/<sessionKey>/index.html`이 200 |
| **계산기 실제 동작** | 7×8 → `56`, 12+3 → `15`, C → `0` |
| UI 흐름 | 로그인 후 `connection=online`, 턴 phase가 `running` → `done` |
| 인증 없는 WS 업그레이드 | 거절 |
| 타인 sessionKey 제출 | 연결 종료 |
| `vibe.turn.run` 외 action | 연결 종료 |

`elapsedMs`와 iteration 수는 모델 출력에 따라 달라지므로 고정 기대값을 두지 않는다. 판정은 "동작하는 산출물이 나왔는가"이며 몇 번 만에 나왔는지는 아니다.

## Logs To Capture

- `deploy-report-begin` ~ `deploy-report-end`
- `vibe-turn-e2e.mjs`의 진행 로그 전체와 최종 JSON
- 생성 페이지를 조작한 뒤의 표시값
- 소켓 거절 3종의 close code와 사유

## Locator Contract

이번 클라이언트는 검증용 훅을 갖고 만들었다. 구조 의존 셀렉터를 쓰지 않는다.

| 대상 | 우선 로케이터 | 대체 |
| --- | --- | --- |
| 이메일·비밀번호 | `aria-label="Email"` / `"Password"` | `input[name=...]` |
| 로그인·가입 버튼 | `[data-testid="login-submit"]` / `"signup-submit"` | 접근 가능한 이름 |
| 연결 상태 | `[data-testid="connection-state"]` | `.live-dot` 클래스 |
| 세션 키 | `[data-testid="session-key"]` | — |
| 프롬프트·실행 | `[data-testid="prompt-input"]` / `"run-turn"` | `aria-label="Prompt"` |
| 턴 상태 | `[data-testid="turn-phase"]`, `article[data-phase]` | — |
| 도구 실행 | `[data-testid="tool-run"]`, `[data-status]` | — |
| 최종 답변 | `[data-testid="turn-answer"]` | — |

생성된 페이지 자체에는 test id가 없다. 에이전트가 만든 것이므로 마크업을 통제할 수 없고, 검증은 버튼의 표시 텍스트와 표시값으로 한다.
