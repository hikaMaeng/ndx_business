# Architecture

Source is partitioned by runtime:

| Path         | Contract                                                                    | Drill-down                                                       |
| ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/common` | Runtime-neutral domain code shared by server and front.                     | `src/common/protocol/organization/index.ts#OrganizationInferenceService` |
| `src/server` | Server-only domain rules and persistence. Must not import from `src/front`. | `src/server/organizations/index.ts#assignOrganizationInferenceService` |
| `src/front`  | Front-only pure model state. Must not own app UI composition.               | `src/front/models/model/store.ts#ensureModelsFeatureModel` |
| `src/front/theme` | The design scale both apps read: surfaces, type family, type steps. Tokens only — no element rules, no layout. | `src/front/theme/theme.css` |

Packages must never import from `apps/`. App code may import this package by
workspace package name only.

## The shared scale

`admin_domain/front/theme.css` is the single definition of the palette and the
type scale, imported by `apps/admin` and `apps/vibeagent` alike. It ships as a
package export (`admin_domain/front/theme.css`), copied into `dist` by
`copy-assets.mjs` because `tsc` emits no stylesheets.

It holds custom properties and nothing else, so importing it can only add
names — it cannot move anything on a page that has not asked for a name. Each
app maps its own vocabulary onto it downstream
(`apps/admin/src/front/theme/linker.css`) rather than re-picking values.

Why the dependency runs this way round: the coding agent verifies every
session against the Admin account service, so Admin is upstream of it in fact.
Declaring that in `package.json` describes the system as it already is.
`admin_domain` imports no workspace package itself, so no cycle is possible.

## 저장소

PostgreSQL 하나. `admin` 전용 스키마에 산다 — 같은 서버가 이벤트 로그와 큐도
담고 있고 `users`·`sessions`·`organizations`는 누구나 쓸 법한 이름이라서다.

모든 도메인 함수는 `Pool`을 받고 async다. 동기 드라이버에서 옮겨오며 함수 44개와
라우트 29개가 함께 바뀌었고, 그게 스키마 번역보다 큰 비용이었다.

쿼리는 `?`로 쓰고 `database/index.ts`의 어댑터가 `$1`로 번호를 매긴다. 예순 곳
넘는 호출부에서 손으로 번호를 매기면 같은 타입의 인자 둘이 조용히 뒤바뀐다.

### 반드시 지킬 것

- `users.email`은 `citext`다. 일반 `text`로 바꾸면 `A@x.com`과 `a@x.com`이 서로
  다른 계정이 된다.
- `ensureAdminSchema`는 `auth_settings` 1번 행을 시드한다. 없으면 모든 설정 저장이
  0행을 고치고 **성공을 보고한다.**
- 풀에는 `error` 핸들러가 있어야 한다. 유휴 커넥션이 끊기는 것은 정상인데,
  처리하지 않으면 Node가 프로세스를 죽인다. DB를 공유하므로 재배포마다 일어난다.

## 프로젝트

폴더이자 레코드다. 폴더는 코딩 에이전트의 볼륨에, 레코드는 여기에 — 누구 것이고
어느 조직의 정책 아래 도는지는 디렉터리 엔트리가 말할 수 없다.

| 열 | 뜻 |
| --- | --- |
| `owner_id` | 만든 계정. 폴더도 이 계정 이름의 디렉터리 아래 있다 |
| `organization_id` | null이면 개인 프로젝트 |
| `name` | 계정 안에서만 유일하면 된다 |

`organization_id`는 CASCADE가 아니라 RESTRICT다. 조직을 지우면서 디스크에 남아
있는 폴더를 조용히 주인 없게 만들면 안 된다.

조직 소속은 라우트가 아니라 `createProject`에서 검사한다. 속하지 않은 조직을
주장하는 것은 그 조직의 스킬과 퍼미션을 주장하는 것이다.

## 배포가 구성하는 것

스킬 · MCP · 커맨드 · 훅 · 프롬프트가 **하나의 테이블, 하나의 병합**을 쓴다.
`kind`가 무엇인지 말하고 `value`는 그 종류가 필요로 하는 것이며 이 층은 읽지 않는다.

3계층이다 — 조직(사슬) · 개인 전역 · 개인 프로젝트. 두 방향으로 병합된다:

| | 이기는 쪽 |
| --- | --- |
| 기본값 | 가까운 층. 프로젝트 → 계정 → 하위 조직 → 상위 조직 |
| 강제 | 바깥 조직. 모든 개인 층을 이기고, 조직 사이에서는 루트가 이긴다 |

### 프롬프트만 다른 점

앞의 넷은 세션이 **할 수 있는 일**을 정하므로 컨텍스트로 들어간다. 프롬프트는
사람이 고르고 고쳐서 보내는 **텍스트**다. 컨텍스트에 들어가지 않으므로 프리픽스
캐시를 건드리지 않고, 그래서 길이에 제약이 없다.

가는 곳은 입력창이다. 고르면 채워지고 커서가 끝에 놓이며, 그 뒤로는 그냥 편집
가능한 글이다. 고르는 것이 곧 보내는 것은 아니다 — 고쳐 쓰라고 있는 것이다.
