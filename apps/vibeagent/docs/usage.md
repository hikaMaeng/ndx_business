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
| `VIBE_WORKSPACE_ROOT` | `/workspace` | 컨테이너 안에서 본 프로젝트 루트 |
| `VIBE_WORKSPACE_HOST_DIR` | `./workspace` | **호스트의 프로젝트 루트.** 바인드 마운트라 생성된 파일을 호스트에서 바로 연다 |
| `VIBE_MAX_CONCURRENT_TURNS` | `256` | 인라인 실행 동시 턴 상한 |

## 추론 대상

기본 배포는 `host.docker.internal:12345/v1`의 `nvidia-nemotron-3.5-lightning-30b-a3b`를 쓴다. 같은 endpoint와 모델이 admin의 model 카탈로그에도 등록돼 있다.

## 프로젝트 루트

브라우저는 호스트에서 돌고 에이전트는 컨테이너 안에서 돈다. 산출물을 네임드 볼륨에 두면 `docker cp` 없이는 꺼낼 수 없으므로, 프로젝트 루트는 **호스트 디렉터리 바인드 마운트**다.

```yaml
volumes:
  - ${VIBE_WORKSPACE_HOST_DIR:-./workspace}:/workspace
```

Gateway와 Worker가 같은 경로를 공유한다 — Worker가 쓰고 Gateway가 `/workspace/<sessionId>/`로 서빙한다. 세션 디렉터리는 저장소 루트의 `workspace/`에 그대로 나타나므로 편집기로 바로 열 수 있다.

다른 위치에 두려면 저장소 루트 `.env`에 `VIBE_WORKSPACE_HOST_DIR`를 지정한다.

## 세션 이어보기

과거 세션은 사이드바에서 고른다. 목록은 `GET /api/vibe/sessions`가 `event_store`를 조회해 만든 read model이라 별도 테이블이 없고, 따라서 실제 기록과 어긋날 수 없다.

세션을 열면 클라이언트가 먼저 브로커에 시작 커서를 요청한 뒤 그 커서로 구독한다. 커서 없이 구독하면 지금부터만 받기 때문이다.
