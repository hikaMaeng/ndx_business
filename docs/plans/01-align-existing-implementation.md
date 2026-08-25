# 계획 1 — 기존 구현을 아키텍처에 맞추기

기준 문서: [아키텍처](../../packages/agent/docs/architecture.md) · [라이브러리 개요](../../packages/agent/docs/overview.md) · [앱 작성 지침](../../packages/agent/docs/usage.md)

## 0. 현재 상태 (정직하게)

리팩터가 진행 중이며 **지금 저장소는 컴파일되지 않는다.** 아래가 실제 오류다.

```
broker/http/app.ts       : './auth/index.js' 를 찾을 수 없음 (파일이 ../auth 로 이동)
broker/index.ts          : 'createWebBackend' export 없음 (함수명이 createBrokerApp)
broker/service/index.ts  : 같은 이유
```

여기에 더해 배럴·클라이언트 API가 어긋나 있다. 이 계획은 그 어긋남을 정리해 아키텍처와 일치시키는 것이 목적이며, **새 기능은 하나도 추가하지 않는다.**

## 1. 이미 옳게 된 것 — 건드리지 않는다

| 항목 | 상태 |
| --- | --- |
| PGMQ 5연산 계약 | 그대로 |
| 엔벨롭·채널 프레임 (`common/protocol`) | 확정. 변경 금지 |
| claim 3분기, 이중 lease, heartbeat 비대칭 | 그대로 |
| 두 outbox와 handoff 원장 | 그대로 |
| 큐 3종과 단일 소유권 | 그대로 |
| bash 도구가 별도 프로세스인 것 | 그대로 |

## 2. 고칠 것

### 2-1. 라이브러리 컴파일 복구 (선행)

| 대상 | 작업 |
| --- | --- |
| `broker/http/app.ts` | import 경로 `./auth` → `../auth`, 함수명 `createBrokerApp` → `createWebBackend`, 입력 타입 `BrokerAppInput` → `WebBackendInput`, `clientDir`/`assetDir`를 선택값으로 |
| `broker/index.ts` | 배럴에서 사라진 `createApp` 제거 확인, 신규 export 정합 |
| `broker/service/index.ts` | `createEventBroker` / `createResultRouter` / `createWorkerServer` / `runService`만 남긴다 |

### 2-2. 브로커에서 도메인 지식 제거

| 위반 | 조치 | 근거 |
| --- | --- | --- |
| gateway가 `event_store`·`agent_execution`·`agent_result_delivery`를 prune | 워커로 이관 | §8 저장소 소유권 |
| 모든 role이 도메인 스키마 8개를 `ensureSchema` | 브로커는 자기 3개만, 워커는 자기 4개만 | 같음 |
| `worker/entry.ts`의 `test.delay` 분기 | 제거 완료 | 브로커는 action 이름을 몰라야 함 |
| `server/handlers/` 샘플 registry | 삭제 완료 | 도메인은 앱이 소유 |
| socket policy가 `payload.sessionKey`를 읽음 | 엔벨롭 `sessionId`로 전환 | §3 payload는 불투명 |

### 2-3. 서비스를 완제품/틀로 재정리

| 서비스 | 제공 형태 | 앱이 넘기는 것 |
| --- | --- | --- |
| `createEventBroker` | 완제품 | `allowedActions`, 계정 URL, 정적 경로 |
| `createResultRouter` | 완제품 | 없음 |
| `createWorkerServer` | 틀 | `worker` 모듈 URL |

앱의 조립 루트는 역할 분기 + 위 인자 전달까지만 한다. 현재 인자(런타임·검증기·정책·웹백엔드를 앱이 조립)는 완제품이 아니므로 폐기한다.

### 2-4. 클라이언트 경계 정리

| 대상 | 작업 |
| --- | --- |
| `agent/front` | `BrokerClient`만 남긴다 (송수신 + 커서 복구). 구 `EventStreamModel` 삭제 완료 |
| `vibeagent_domain/front` | 이벤트 해석 전담. `apply(envelope)` 하나로 진입 |
| `apps/vibeagent/src/front` | 화면과 입력만. 소켓·커서·재접속 코드를 직접 갖지 않는다 |

### 2-5. 도메인 계약 강화

`vibeagent_domain/common/protocol/vibe`에 action별 payload 타입과 `VibeProgressMap`을 둔다. 워커의 `emit`과 클라이언트의 fold가 같은 맵을 참조해 **컴파일 타임에** 합의가 강제되게 한다.

### 2-6. 클라이언트가 엔벨롭으로 세션을 보내게

지금은 `payload.sessionKey`. `sessionId` 엔벨롭 필드로 옮기고, `toEventDraft`도 `event.sessionId`를 우선하도록 고친다.

## 3. 실행 순서

의존 순서상 앞이 깨지면 뒤가 진행되지 않는다.

1. 라이브러리 컴파일 복구 (2-1)
2. 저장소 소유권 이관 — 스키마·retention (2-2)
3. 서비스 팩토리 확정 (2-3)
4. 도메인 계약 강화 (2-5)
5. 클라이언트 3층 분리 (2-4, 2-6)
6. 앱 조립 루트 축소
7. compose·Dockerfile·env 정합
8. 문서 갱신 (4개 단위 전부)
9. 검증

## 4. 검증 기준

| 항목 | 기준 |
| --- | --- |
| 빌드·lint | 전 task 성공 |
| `agent` 단위 테스트 | 기존 통과분 유지 (handler 테스트 4건은 삭제분) |
| `vibeagent_domain` 단위 테스트 | 14/14 유지 |
| arch·compose·docs | `violations=0` |
| 배포 | 3개 서비스 `/ready` 200 |
| 종단 | 계산기 생성 후 **브라우저에서 실제 계산** |

리팩터이므로 **동작이 달라지면 실패**다. 종단 결과가 이전과 같아야 한다.

## 5. 위험

| 위험 | 대응 |
| --- | --- |
| 스키마 소유권 이관 중 기동 순서 문제 (브로커가 먼저 떠서 `event_store`가 없음) | 브로커는 `event_store`를 **읽기만** 한다. 워커가 만들기 전에는 replay가 빈 결과를 준다 — 오류가 아니라 빈 화면 |
| 클라이언트 API 변경으로 화면 회귀 | 종단 검증에서 실제 조작까지 확인 |
| 배럴 경유 번들 비대 | worker 번들 크기를 회귀 기준(20KB 미만)으로 삼는다 |
