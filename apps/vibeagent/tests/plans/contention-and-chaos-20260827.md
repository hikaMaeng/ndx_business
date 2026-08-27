# 경합과 안정성 — 검증 계획

## 목표

단일 세션 테스트가 답하는 것은 "턴이 도는가"다. 이 계획이 답하는 것은 **여럿이
동시에 있을 때 무엇이 무너지는가**이고, 그게 이 아키텍처가 실제로 노리는 형태이자
실패가 조용한 형태다.

세션이 다른 세션의 이벤트를 받거나, 히스토리가 두 턴을 섞어도 **에러가 나지
않는다.** 그럴듯하지만 틀린 전사가 나올 뿐이다. 그래서 모든 단언은 살아있음이
아니라 **격리와 회계**에 관한 것이다.

## 두 종류

| 스크립트 | 묻는 것 |
| --- | --- |
| `vibe-contention.mjs` | 전부 건강할 때, 여럿이 서로를 침범하는가 |
| `vibe-chaos.mjs` | 부품이 죽고 살아날 때, 잃거나 두 번 하는가 |

## 환경

- 컨테이너: `admin`, `vibeagent`, `vibeagent-worker`, `vibeagent-dispatcher`
- 큐 여섯 (`vibe_view` 포함)
- 카오스 시나리오는 `AGENT_RECONCILE_GRACE_SECONDS=30`, `AGENT_RECONCILE_MS=15000`
  로 낮춰 회수를 관측 가능한 시간 안에 본다. **끝나면 운영값(600/60000)으로 되돌린다**

## 경합 (`vibe-contention.mjs [계정] [계정당세션] [세션당턴]`)

계정마다 신규 가입하고, 계정당 N개 세션을 **각자의 프로젝트 폴더**에 열고, 전부
동시에 시작한다. 세션 안의 턴은 순차다 — 다음 프롬프트는 이전 턴이 만든 히스토리에
묻는 것이므로 그게 턴의 정의다. **동시인 것은 세션이고, 그게 시험 대상이다.**

각 턴은 그 세션·그 턴에만 속한 파일 이름을 쓴다. 다른 세션의 파일을 쓰면 마지막
폴더 목록이 말해준다.

### 단언

1. **프레임 단위 격리** — 소켓이 자기 채널 아닌 이벤트를 한 건도 받지 않을 것.
   끝에서 세는 게 아니라 도착하는 모든 프레임에서 검사한다
2. 세션마다 정확히 요청한 수의 턴, **턴마다 `turn.final` 정확히 1회**
3. **계정 간 가시성** — 각 계정은 자기 세션만 보고 남의 세션은 못 본다
4. **읽기 모델 권한** — 남의 세션 전사 요청은 404
5. 읽기 모델의 턴 수가 소켓이 본 것과 같을 것
6. 폴더마다 자기 파일만 있을 것

### DB에서 추가로 볼 것

스크립트가 소켓에서 못 보는 불변식.

```sql
-- 전부 0이어야 한다
SELECT count(*) FROM (SELECT session_key,turn_key,iteration_index FROM vibe_session_message
  WHERE role='assistant' GROUP BY 1,2,3 HAVING count(*)>1) x;   -- 중복 assistant
SELECT count(*) FROM (SELECT session_id,payload->>'turnKey' FROM event_store
  WHERE action='vibe.turn.final' AND kind='progress' GROUP BY 1,2 HAVING count(*)>1) x;
SELECT count(*) FROM (SELECT session_id,payload->>'turnKey',payload->>'iterationIndex' FROM event_store
  WHERE action='vibe.iteration.ready' AND kind='progress' GROUP BY 1,2,3 HAVING count(*)>1) x;
```

그리고 **뷰 턴 수 = 로그 턴 수**.

## 카오스 (`vibe-chaos.mjs [시나리오] [세션]`)

### `dispatcher-gap`

**주의: 평범한 재시작은 아무것도 잃지 않는다.** 커서가 DB의 행이라 멈춘 자리에서
이어간다. 이전 문서가 "재시작 중 유실"이라고 적은 것은 과장이었다.

실제 구멍은 **저장된 커서가 없는** 디스패처다. 로그 끝에서 시작하므로 그 앞의
fact를 전부 건너뛴다. 첫 기동, 이름 변경, 커서 행 유실이 그 경우다.

그래서 시나리오가 그 상태를 **일부러 만든다**: 디스패처를 멈추고 → 턴을 넣고 →
커서 행을 지우고 → 다시 띄운다.

기대: 턴이 멈춰 있다가, 청소 루프가 **나이로** 찾아 되살린다.

### `worker-restart`

턴이 도는 중에 워커를 재시작한다. 클레임된 실행이 버려지고, 리스 만료 후 다른
워커가 재클레임해 끝내야 한다. **명령이 두 번 돌면 안 된다.**

프롬프트가 `>>` 로 덧붙이므로, 두 번 돌면 파일 내용이 두 배가 된다. 그게 검사다.

### `both`

여러 세션이 비행 중일 때 디스패처와 워커를 동시에 재시작한다. 잃지도, 두 번 하지도,
섞이지도 않아야 한다.

## 남길 로그

- 계정 수·세션 수·턴 수·도구 호출 수·**교차 이벤트 수(0이어야 함)**
- 디스패처의 `seeded` / `recovered` 로그 — 회수가 실제로 일어났다는 증거
- 카오스 후 각 `.log` 파일의 내용 — 중복 실행의 유일한 직접 증거
- 위 DB 불변식 쿼리 결과

## 로케이터

브라우저를 쓰지 않는다. 클라이언트와 같은 경로(WebSocket + 이벤트)를 직접 탄다.
HTTP agent 라우트는 존재하지 않으므로 쓰지 않는다.
