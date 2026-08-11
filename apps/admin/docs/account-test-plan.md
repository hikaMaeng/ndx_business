# Account full verification plan

## Purpose

전 계정 기능이 하나의 공유 세션 토큰과 여러 장비 세션 기록을 일관되게
유지하는지 검증한다. 테스트 대상은 `apps/admin/src/server/app.ts`와
`packages/admin_domain/src/server/auth/index.ts`의 실제 HTTP·SQLite 경로다.

## Test data and isolation

각 실행은 임시 SQLite 파일과 고유 이메일을 사용한다. 운영 `admin_data`
볼륨은 사용하지 않는다. 장비는 다음 식별자를 사용한다.

| Device | Transport | User agent |
| --- | --- | --- |
| `browser-a` | `Authorization: Bearer` | desktop browser |
| `mobile-b` | configured cookie | mobile app |
| `plugin-c` | configured custom header | VS Code/CLI |

토큰 원문은 로그와 스크린샷에 출력하지 않는다. 모든 실행은 요청 시각,
응답 코드, 세션 수, 장비 수, `lastRequestAt`을 증거로 남긴다.

## Coverage matrix

### Account lifecycle

- 자동 승인 회원가입 → 로그인 → `/api/auth/me` 성공
- 필터 승인: 일치 metadata 승인, 불일치 metadata pending
- 수동 승인: pending 목록 표시, approve 후 로그인, reject 후 로그인 거부
- 잘못된 이메일·짧은 비밀번호·중복 이메일·잘못된 비밀번호 거부
- 비활성 계정의 기존 토큰 요청 거부

### Shared token and devices

- 같은 계정의 두 번 로그인에서 `sessionToken`이 동일함
- 세션 목록에는 해당 계정의 활성 토큰이 하나만 존재함
- 세 장비가 각각 하나의 `session_devices` 행으로 기록됨
- 동일 장비의 반복 요청은 장비 행을 중복 생성하지 않고 `requestCount`와
  `lastRequestAt`만 갱신함
- 서로 다른 장비의 요청이 하나의 공유 세션 `expiresAt`을 연장함
- 모든 장비 요청이 중단된 뒤 idle timeout이 지나면 토큰이 만료됨
- 만료·revoke 후 세션과 장비 기록이 retention 정책에 따라 삭제 또는 보존됨

### Token transport

- `Authorization: Bearer <token>` 인증
- 설정된 전용 헤더 인증
- 설정된 쿠키 인증
- 헤더와 쿠키에 같은 토큰이 있으면 성공
- 서로 다른 토큰이 동시에 있으면 `401` 거부
- 설정되지 않은 헤더·쿠키 이름은 인증에 사용되지 않음
- 헤더·쿠키 이름 변경 후 새 이름만 수용되고 기존 토큰은 유지됨
- 설정값에 허용되지 않는 문자·빈 값이 들어가면 `400`으로 거부됨
- 로그인 응답이 현재 쿠키 이름으로 `HttpOnly`, `SameSite=Lax`, `Path=/`
  쿠키를 발급함

### Logout and administration

- 일반 로그아웃은 공유 토큰을 revoke하여 모든 장비에서 즉시 실패함
- 관리자 세션 revoke는 해당 공유 토큰과 연결 장비 전체를 종료함
- 활성 세션 목록에 이메일·생성 시각·최근 사용 시각·만료 시각이 표시됨
- 어드민 세션 화면에 장비 label·요청 횟수·최근 요청 시각이 표시됨
- 정책 저장 후 회원가입 정책, idle timeout, retention, transport 이름이
  재조회되어 유지됨

### Browser and deployed service

- 로그인 화면의 email/password/sign-in locator 동작
- 로그인 후 좌측 메뉴의 Overview, Policy, Accounts, Sessions, System 전환
- Policy 화면에서 헤더 키와 쿠키 이름 저장
- Sessions 화면에서 장비 목록 렌더링
- 320px 이상 모바일 폭에서 메뉴와 콘텐츠 가로 overflow 없음
- `npm run deploy admin` 이후 published port와 `/health` 검증
- 배포된 URL에서 로그인·메뉴 전환·세션 목록 브라우저 시나리오 실행

## Execution order

1. `npm run lint --workspace admin`
2. `npm test --workspace admin_domain`
3. `npm test --workspace admin`
4. i18n, architecture, docs 계약 검사
5. 임시 SQLite를 사용한 API matrix 실행
6. `npm run deploy admin` 실행 및 deploy report 보관
7. 배포 URL에 headless smoke 및 scenario 실행
8. 결과와 미실행 항목을 이 문서의 실행 기록에 추가

## Pass criteria

모든 필수 시나리오가 성공하고 다음 불변식이 모두 참이어야 한다.

- 계정당 활성 공유 토큰은 최대 하나
- 장비당 세션 장비 레코드는 최대 하나
- 모든 인증 transport가 같은 토큰 검증 경로를 사용
- 서로 다른 토큰 충돌은 거부
- 장비 요청이 공유 세션 idle 만료를 연장
- revoke·계정 비활성화 후 모든 transport가 실패
- 테스트는 운영 데이터·운영 Docker volume을 변경하지 않음

## Evidence and failure handling

API 결과는 `test/YYYYMMDD/<HHMMSS>_account-verification/` 아래에 JSON 또는
Markdown으로 저장한다. 브라우저 증거는 같은 폴더의 report와 PNG로 저장한다.
실패 시 마지막 정상 요청, 입력 transport, 응답 코드, DB의 session/device
요약을 남기고 token 원문과 비밀번호는 제거한다. 배포 검증 실패는 코드
테스트 통과와 별도로 보고한다.
