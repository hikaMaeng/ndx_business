# 계획 2 — 아키텍처와 라이브러리 위에서 바이브코딩 에이전트 만들기

전제: [계획 1](01-align-existing-implementation.md)이 끝나 라이브러리가 완제품/틀/송수신 세 형태로 정리돼 있을 것.

## 0. 이 앱이 실제로 만드는 것

라이브러리가 브로커를 통째로 주므로, `apps/vibeagent`의 **핵심 구현은 워커 서버**다. 그다음이 클라이언트다.

| 만드는 것 | 어디에 | 분량 감각 |
| --- | --- | --- |
| 이벤트 계약 | `vibeagent_domain/common/protocol/vibe` | 합의 문서에 가까움 |
| **워커 구현** | `vibeagent_domain/server` | 이 프로젝트의 본체 |
| 클라이언트 해석 | `vibeagent_domain/front` | 이벤트 → 화면 상태 |
| 화면 | `apps/vibeagent/src/front` | UI |
| 조립 | `apps/vibeagent/src/server/index.ts` | 역할 분기 몇 줄 |

브로커·라우터·웹백엔드를 위해 쓰는 코드는 **0줄**이다.

## 1. 이벤트 계약 (먼저 확정)

식별 계층은 User → Session → Turn → Iteration. Session은 엔벨롭 `sessionId`, Turn은 `transactionKey`, Iteration은 payload의 순번이다.

| action | 방향 | 뜻 |
| --- | --- | --- |
| `vibe.turn.run` | client → worker | 이 프롬프트로 한 턴을 돌려라 |
| `vibe.turn.started` | worker → client | 워크스페이스를 잡고 시작 |
| `vibe.iteration.started` | worker → client | n번째 model 호출 |
| `vibe.iteration.reasoning` | worker → client | 모델의 사고 (이 모델은 별도 필드로 준다) |
| `vibe.iteration.message` | worker → client | 모델의 일반 텍스트 |
| `vibe.tool.started` | worker → client | bash 실행 시작 + 명령 |
| `vibe.tool.stdout` / `.stderr` | worker → client | 스트리밍 출력 |
| `vibe.tool.completed` / `.failed` | worker → client | 종료 코드·소요·타임아웃 |
| `vibe.turn.final` | worker → client | 최종 답변 |

terminal result는 브로커가 `vibe.turn.run.result`로 append하며 `payload.value`는 `VibeTurnOutcome`이다.

**클라이언트가 올릴 수 있는 action은 `vibe.turn.run` 하나뿐이다.** 나머지는 브로커의 허용 목록에 없으므로 연결이 끊긴다.

## 2. 워커 구현 — 본체

### 2-1. 도구는 bash 하나

파일 쓰기 도구도 읽기 도구도 두지 않는다. 모델은 heredoc으로 쓰고 `cat`으로 되읽는다.

이유 둘. 도구가 늘면 모델이 도구 선택을 틀릴 여지가 생긴다. 그리고 실행 격리를 지켜야 할 지점이 늘어난다 — 지금은 한 곳만 지키면 된다.

### 2-2. 도구는 반드시 별도 OS 프로세스

`spawn("bash", ["-lc", command])`. worker thread 안에서 셸을 흉내 내면 그 스레드가 20초 주기 lease heartbeat에 응답하지 못하고 소유권을 잃는다.

`detached: false`로 둔다. 워커가 죽으면 자식도 죽어야 하며 추적되지 않는 프로세스를 남기지 않는다.

상한 셋을 모두 건다.

| 상한 | 막는 것 |
| --- | --- |
| `VIBE_TOOL_TIMEOUT_MS` | 한 명령이 영원히 도는 것 |
| `VIBE_MAX_ITERATIONS` | 한 턴이 워커를 영구 점유하는 것 |
| `VIBE_TOOL_MAX_OUTPUT_BYTES` | `find /` 하나가 메모리를 먹는 것 |

### 2-3. 루프

```text
chat() → reasoning 있으면 emit → tool_calls 없으면 그것이 최종 답변 (종료)
       → 있으면 각 호출을 bash 프로세스로 실행하고 결과를 role:"tool" 메시지로 대화에 추가 → 반복
```

**종료 판정은 `content`가 아니라 `tool_calls`의 부재로 한다.** 이 endpoint의 모델은 reasoning 모델이라 tool call 시 `content`가 빈 문자열이고 사고는 `reasoning_content`에 온다. `content`가 비었다고 "답이 없다"로 보면 모든 턴이 즉시 끝난다.

### 2-4. 추론 인자 — 코딩용

| 인자 | 값 | 이유 |
| --- | --- | --- |
| temperature | `0.15` | heredoc 안의 토큰 하나가 파일을 조용히 망가뜨린다 |
| top_p | `0.9` | 꼬리는 자르되 greedy의 반복 루프는 피한다 |
| max_tokens | `8192` | reasoning에 예산을 먼저 쓰므로 작으면 사고 중간에 잘린다 |

같은 값을 어드민 모델 카탈로그에도 등록한다.

### 2-5. emit은 내구적이다

`emit`은 worker thread에서 `postMessage`로 나가고, 라이브러리의 worker consumer가 event store에 append하며 outbox에 넣는다. 진행 상황도 결과와 같은 내구성을 갖고, 중간에 재접속한 브라우저가 replay로 transcript 전체를 복원한다.

progress append 실패는 실행을 죽이지 않는다. 관측을 잃는 것이 실행을 잃는 것보다 낫다.

### 2-6. 워크스페이스

`<root>/<sessionId>`. 세션은 다른 세션 파일에 닿을 수 없고, 같은 세션의 연속 턴은 같은 디렉터리를 공유한다(의도된 동작).

브로커와 워커가 같은 볼륨을 공유해야 브로커가 산출물을 서빙할 수 있다.

## 3. 클라이언트

| 층 | 소유 | 내용 |
| --- | --- | --- |
| 송수신 | 라이브러리 `BrokerClient` | 연결·구독·커서·재접속 |
| 해석 | `vibeagent_domain/front` | 이벤트 → 턴/도구/답변 상태 |
| 화면 | `apps/vibeagent/src/front` | 로그인 폼, transcript, 프롬프트 입력 |

흐름: 로그인(HTTP 프록시) → `/api/auth/me`로 userId → `sessionId = <userId>-<uuid>` 생성 → 소켓 연결·구독 → `vibe.turn.run` 전송 → 진행 이벤트 렌더 → terminal에서 턴 종료.

`sessionId`에 소유자를 담는 이유는 브로커가 접두사만 보고 소유권을 판정할 수 있어서다. 세션 개설에 HTTP 왕복이 필요 없다.

## 4. 인증 경계

| 경로 | 전송 | 이유 |
| --- | --- | --- |
| 로그인·가입·`me` | HTTP | 어드민이 설정한 PG 테이블 영역 |
| 그 외 전부 | WebSocket 이벤트 | 에이전트와의 대화 |

브로커는 업그레이드 시점에 토큰을 검증하고, 프레임마다 `userId`를 연결의 신원으로 덮어쓴다.

## 5. 검증 계획

에이전트의 자기 보고("만들었습니다")는 증거가 아니다.

| 단계 | 기준 |
| --- | --- |
| 단위 | 계약 파서, bash(exit code·워크스페이스 쓰기·타임아웃·출력 상한), 클라이언트 dedupe |
| 소켓 정책 | 무인증·위조 토큰 → 401 / 타인 세션·미허용 action → 1008 |
| 종단 | 소켓 하나로 턴 제출·수신, terminal `ok:true` |
| **산출물** | 생성된 페이지를 브라우저로 열어 **실제 조작**했을 때 올바른 값 |
| UI | 로그인 → 세션 → 턴 실행 → 진행 렌더 → 완료 |

목표 산출물은 계산기 웹페이지이며, `7×8=56` 같은 실제 계산이 통과 기준이다.

## 6. 산출물 목록

| 파일 | 성격 |
| --- | --- |
| `vibeagent_domain/common/protocol/vibe/index.ts` | 계약 |
| `vibeagent_domain/server/{llm,tools/bash,loop,config,handlers}` | 워커 본체 |
| `vibeagent_domain/front/model/session.ts` | 이벤트 해석 |
| `apps/vibeagent/src/front/{main.ts,styles.css}` | 화면 |
| `apps/vibeagent/src/server/{index.ts,worker-entry.ts}` | 조립·주입 |
| `apps/vibeagent/docker/*`, `docker-compose.yml` | 배포 (bash 포함 이미지, 공유 워크스페이스 볼륨) |
| 각 단위 `docs/*`, `tests/plans`, `tests/reports` | 문서·검증 기록 |
