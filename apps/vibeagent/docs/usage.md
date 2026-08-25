# vibeagent 사용법

```powershell
npm run deploy -- vibeagent vibeagent-worker vibeagent-router
```

Gateway만 `18081`을 공개하고 Worker·Router는 내부 전용이다. 세 컨테이너가 같은 이미지에서 `AGENT_ROLE`로 갈린다.

## 환경값

broker 값은 [`agent` 사용법](../../../packages/agent/docs/usage.md), 추론 값은 [`vibeagent_domain` 사용법](../../../packages/vibeagent_domain/docs/usage.md)에 있다. 이 app이 추가로 읽는 값은 다음과 같다.

| 이름 | 기본값 | 의미 |
| --- | --- | --- |
| `VIBE_ADMIN_BASE_URL` | `http://admin:18080` | 계정 서비스. 로그인 프록시와 세션 검증 대상 |
| `VIBE_SESSION_CACHE_MS` | `5000` | 세션 검증 캐시. 짧게 두어야 폐기가 곧 반영된다 |
| `VIBE_WORKSPACE_ROOT` | `/workspace` | 생성 파일 루트. Gateway와 Worker가 같은 볼륨을 공유한다 |

## 추론 대상

기본 배포는 `host.docker.internal:12345/v1`의 `nvidia-nemotron-3.5-lightning-30b-a3b`를 쓴다. 같은 endpoint와 모델이 admin의 model 카탈로그에도 등록돼 있다.
