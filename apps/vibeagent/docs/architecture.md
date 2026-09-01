# Agent 아키텍처

## 프로세스와 저장 경계

Gateway만 host port `18081`을 공개한다. Worker는 command queue를 읽는 내부 consumer다. PGMQ는 **일감**만 보관하고, 결과는 큐를 타지 않는다 — Worker가 `event_store`에 append하면 Gateway들이 각자 그 로그를 tail한다. 그래서 Gateway는 서로 교체 가능하고 늘리는 데 조정이 필요 없다.

| PostgreSQL 데이터 | 책임 | 코드 |
| --- | --- | --- |
| `event_store`, `event_stream_sequence` | canonical event·retention index와 stream별 sequence watermark | [`EventStore`](../../packages/agent/src/broker/event-store/store.ts) |
| `event_subscription_cursor` | channel별 cursor position | [`EventStore`](../../packages/agent/src/broker/event-store/store.ts) |
| `agent_execution`, `agent_execution_recipient` | transaction claim, 실행 결과, reply channel 집합 | [`ExecutionStore`](../../packages/agent/src/broker/idempotency/store.ts) |

Gateway의 channel 구독은 테이블이 아니라 프로세스 메모리다. 아무도 특정 Gateway로 라우팅하지 않으므로 밖에서 알 필요가 없다. WebSocket receipt는 ephemeral이므로 최종 consumer는 `eventId` dedupe와 cursor replay를 사용한다.

## 소스 경계

| 경로 | 책임 | 대표 코드 |
| --- | --- | --- |
| `src/server/index.ts` | 조립 루트. `AGENT_ROLE`로 gateway/worker를 분기하고 broker 부품을 wiring한다 | [`src/server/index.ts`](../src/server/index.ts) |
| `src/server/worker-entry.ts` | Worker Thread 진입 모듈. broker 루프에 이 app의 action registry를 bind한다 | [`src/server/worker-entry.ts`](../src/server/worker-entry.ts) |
| `src/front/` | Agent 화면 | [`src/front/main.ts`](../src/front/main.ts) |

전송 계층은 이 app에 없다. PGMQ 전송, event store, claim/lease, 로그 tail, WebSocket 투영은 [`agent/broker`](../../../packages/agent/docs/architecture.md#srcbroker--broker-런타임)가 소유한다. 이 app은 그 라이브러리를 조립하고 자기 것 두 가지만 주입한다.

| 주입 지점 | 이 app이 공급하는 것 | 이유 |
| --- | --- | --- |
| `createApp(..., frontDir)` | `dist/front` 경로 | 정적 번들은 이 app의 build 산출물이다 |
| `createWorkerPool({ ..., workerUrl })` | `dist/server/worker.js` 경로 | worker 진입 모듈은 이 app의 esbuild 산출물이다 |

`worker-entry.ts`가 `agent/broker`가 아니라 `agent/broker/worker`를 쓰는 것은 의도적이다. barrel을 거치면 worker 번들이 `pg`·`express`·`ws`까지 끌어와 4KB에서 1.4MB가 된다.

## 서버는 둘, 컨테이너는 그 배치일 뿐

| 등장인물 | 어디에 있나 |
| --- | --- |
| 바이브에이전트 웹백엔드 (Express) + 이벤트 브로커 | `vibeagent` 컨테이너. 웹클라이언트도 여기서 나간다 |
| 워커서버 | `worker-inference` · `worker-tool` · `worker-turn` · `worker-read-model` |
| PG 서버 (pg + vector + pgmq) | `admin` 컨테이너에 내장 |

브로커를 웹백엔드에서 떼어낼 수 없다. 클라이언트는 브로커를 웹소켓 서버로
인식하고, 브라우저에 보이는 포트는 이 서버뿐이다.

워커는 `AGENT_QUEUES`로 자기가 볼 큐를 받는다. 목적별로 컨테이너를 쪼개든 하나에
모으든 `docker-compose.yml`만 바뀐다.

이름이 `worker`로 시작하는 것은 목록에서 어떤 서버인지가 무슨 일을 하는지보다
먼저 읽혀야 하기 때문이다. 이미지 열이 vibeagent임을 말해 주고, 뒤의 `-N`은
복제본 번호다 — 늘어나라고 만든 것들이라 `container_name`을 주지 않았다.
`docker compose up -d --scale worker-inference=3` 이 실제로 동작한다.

| 워커 | 큐 | 하는 일 |
| --- | --- | --- |
| `worker-inference` | `vibe_model` | 모델 호출. 메시지당 수십 초, 유일하게 돈이 든다 |
| `worker-tool` | `vibe_tool` | bash 실행. 검증되지 않은 명령을 돌리는 유일한 컨테이너라 워크스페이스 쓰기 권한도 여기만 있다 |
| `worker-turn` | `vibe_intake` `vibe_decide` `vibe_join` | 턴 개시, 답변/도구 판단, 병렬 도구 합류. 밀리초, DB만 |
| `worker-read-model` | `vibe_view` | 로그를 `vibe_turn_view`·`vibe_block_view`로 접는다. 세션을 다시 열 때 과거 대화가 보이는 이유 |

`worker-read-model`이 따로인 이유: fact를 남기지 않고 세션 잠금도 잡지 않는다.
밀려도 턴은 안 막히고 화면만 뒤처진다.

### 없는 것

`dispatcher` 역할은 없다. `router` 프로세스를 지운 지 이틀 만에 같은 모양이 다른
이름으로 돌아온 것이었고, 팩트를 기록하는 일과 그것을 누가 들어야 하는지 정하는
일은 나눌 수 있는 두 가지가 아니다. 지금은 브로커가 반응표를 받아 스스로 한다.

브로커는 여러 대 뜰 수 있다. 로그 읽기는 각자의 커서라 조율이 필요 없지만 —
그게 로그를 쓰는 이유다 — 적재는 다르다. 두 브로커가 같은 팩트에 반응하면 같은
추론을 두 번 산다. 그래서 적재 루프만 advisory lock을 잡고, 잡은 쪽만 넣는다.

### 커넥션

PG 서버 하나가 전부를 받는다. 붙는 것은 프로세스뿐이다 — 워커서버 안의 리액터들은
서버가 준 풀을 함께 쓰지 각자 붙지 않는다.

한때 프로세스가 같은 DB에 풀을 **셋** 열었다. 런타임의 이벤트 로그용, 큐용, 그리고
앱이 리액터에게 주려고 따로 만든 것. 셋째는 첫째와 같은 종류의 트래픽을 같은 DB에
보내고 있었다. 지금은 서버가 자기 풀을 넘긴다 — 워커는 `executeWith`, 브로커는
`extendHttp`의 둘째 인자.

프로세스당 풀은 둘이고 `AGENT_DATABASE_POOL_MAX`가 둘 다의 상한이다. 실측 유휴는
전체 12이며, 워커 넷과 브로커를 다 채워도 60 언저리다. `POSTGRES_MAX_CONNECTIONS`
기본값 200은 필요해서가 아니라 `--scale` 여유다.

## 컨텍스트

세션이 열릴 때 한 번 조립되어 세션에 얼려진다. 턴마다도, 호출마다도 아니다.

```
[ context_prefix ]   기반 프롬프트 · 도구목록 · 프로젝트 경로 · AGENTS.md
[ ... 히스토리 ... ] append-only
[ context_suffix ]   스킬 색인 (한 줄씩)
```

순서는 표현이 아니라 **프리픽스 캐시**다. 제공자는 토큰 접두로 캐시하므로 바뀌는
것이 앞에 있으면 그 뒤 전부가 무효가 되고, 트랜스크립트가 그 뒤에 있다.

- **불변이 앞.** 세션 개설 때 조립하고 다시 만들지 않는다. 디렉터리 목록 같은
  휘발성 사실을 매 호출 갱신하면 매 호출 캐시가 깨진다. 그건 에이전트가 `ls`로
  알아낼 일이다.
- **많이 공유되는 것이 그 안에서 앞.** 캐시는 세션 전용이 아니다. 선두 토큰이
  같은 두 세션은 서로 나눠 쓴다. 그래서 어디서나 같은 기반 프롬프트와 도구목록이,
  프로젝트 안에서만 같은 경로보다 앞에 온다.
- **바뀔 수 있는 것은 히스토리 뒤.** 스킬이 거기 있다. 지금은 세션 동안 고정이라
  자리 이득이 없지만 둘을 산다 — 세션 중 스킬을 실어도 앞이 한 글자도 안 흔들리고,
  스킬 집합은 계정×프로젝트마다 다르므로 프리픽스는 한 프로젝트의 모두가 공유한다.

### 지시는 메시지가 아니다

예전에는 시스템 프롬프트를 히스토리 0번 행으로 썼다. 그러면 대화의 일부가 되어
함께 잘리고 함께 재생되며, 세션을 연 날의 설정에 영원히 묶인다. 지금은
`vibe_session.context_prefix`에 있고 호출 시점에 히스토리 앞에 놓인다.

세션 수명 동안 불변이다. 설정을 바꾸면 **다음 세션부터** 적용된다. 캐시를 지키려면
그래야 하고, 도는 대화의 지시가 중간에 바뀌는 것도 이상하다.

### 기록되는 것은 레시피

`context_recipe`에 무엇으로 만들었는지가 남는다 — 기반 버전, 스킬 이름, AGENTS.md
지문, 도구 수. 텍스트가 아니다. 조합된 컨텍스트는 리드모델과 같은 **투영**이고,
같은 레시피로 다시 만들면 같은 바이트가 나온다. 텍스트를 남기면 로그가 프롬프트
사본으로 부풀고, 아무도 안 하는 질문("뭐라고 적혀 있었나")에 답하며 실제로 하는
질문("무엇을 들고 돌았나")에는 답하지 못한다.

### 스킬은 어디서 오나

`admin`의 정책 해결이다. 조직 사슬 · 개인 전역 · 개인 프로젝트가 병합되고,
기본값은 가까운 쪽이, 강제는 루트가 이긴다. 워커는 같은 PostgreSQL의 `admin`
스키마를 직접 읽는다 — 계정 서비스가 이미 아는 답이라 서비스 호출과 자격증명이
아니라 쿼리 하나다. 워커가 받는 `userId`는 브로커가 검증해 스탬프한 것이다.

도메인은 이 경로를 모른다. `ReactorGlobals.policy`로 **주입된 함수**를 받을 뿐이고,
없으면 내장 프롬프트와 빈 스킬로 열린다.

### 어떤 모델로 도나

세션이 아니라 **호출 시점**에 정해진다. 요청은 모델을 담지 않는 이벤트이고,
`vibe_model` 워커가 `chat` 직전에 `ReactorGlobals.inference`에 묻는다 —
워크스페이스의 앞 조각이 소유 계정이므로 프로젝트를 찾고, 그 조직에서 위로
올라가며 활성 모델을 만나는 첫 조직이 답이다. 없으면 배포 기본 모델이다.

세션에 박아두지 않는 이유: 대화 하나가 며칠을 살아도 조직이 모델을 바꾸면
다음 호출부터 바뀌어야 한다. 열 때 정하면 세션을 끝내야만 옮겨진다.

컨테이너 설정은 **폴백**이다. 해결된 값이 모델과 샘플링을 덮고, 타임아웃·토큰
예산·플러시 간격은 배포 것이 남는다. 키만 예외다 — 엔드포인트가 바뀌었는데
헤더를 등록하지 않았다면 컨테이너 키는 따라가지 않는다. 남의 호스트에 배포
토큰을 보내는 요청은 실패하지 않고 성공하기 때문이다.

호출마다 쿼리 두 번(프로젝트 조회, 조직 사슬)이 는다. 둘 다 인덱스를 탄다.
