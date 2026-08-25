# vibeagent_domain 아키텍처

| 경로 | 책임 | 대표 코드 |
| --- | --- | --- |
| `src/common/protocol/vibe/` | Turn 요청과 진행 이벤트 wire 계약 | [`parseVibeTurnRequest`](../src/common/protocol/vibe/index.ts) |
| `src/server/llm/` | OpenAI 호환 chat 클라이언트 | [`chat`](../src/server/llm/index.ts) |
| `src/server/tools/bash/` | 유일한 도구. 별도 OS 프로세스로 실행 | [`runBash`](../src/server/tools/bash/index.ts) |
| `src/server/loop/` | model → bash → model 반복 | [`runTurn`](../src/server/loop/index.ts) |
| `src/server/config/` | 코딩용 추론 인자 schema 검증 | [`readLoopConfig`](../src/server/config/index.ts) |
| `src/server/handlers/` | broker worker thread에 bind할 action registry | [`executeHandler`](../src/server/handlers/index.ts) |
| `src/front/model/` | 이벤트를 화면 상태로 접는 모델 | [`VibeSessionModel`](../src/front/model/session.ts) |

`server`는 `agent/broker/worker`의 `WorkerEmit`만 의존하고 broker 내부는 모른다. `front`는 서버 코드를 전혀 import하지 않는다.
