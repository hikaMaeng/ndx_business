# vibeagent_domain 사용법

app은 worker thread 진입 모듈에서 registry를 bind한다.

```ts
import { startWorkerEntry } from "agent/broker/worker";
import { executeHandler } from "vibeagent_domain/server";

startWorkerEntry(executeHandler);
```

## 환경값

| 이름 | 기본값 | 의미 |
| --- | --- | --- |
| `VIBE_INFERENCE_BASE_URL` | 없음(필수) | OpenAI 호환 endpoint |
| `VIBE_INFERENCE_MODEL` | 없음(필수) | 모델 식별자 |
| `VIBE_INFERENCE_TEMPERATURE` | `0.15` | 코딩용 저온도 |
| `VIBE_INFERENCE_TOP_P` | `0.9` | 꼬리 절단 |
| `VIBE_INFERENCE_MAX_TOKENS` | `8192` | reasoning 모델이라 넉넉히 |
| `VIBE_MAX_ITERATIONS` | `24` | Turn당 model 호출 상한 |
| `VIBE_TOOL_TIMEOUT_MS` | `120000` | bash 한 건 상한 |
| `VIBE_TOOL_MAX_OUTPUT_BYTES` | `200000` | 출력 버퍼 상한 |
| `VIBE_WORKSPACE_ROOT` | `/workspace` | 세션 작업 디렉터리 루트 |
