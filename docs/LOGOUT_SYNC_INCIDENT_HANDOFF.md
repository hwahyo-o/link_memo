# 로그아웃 동기화 장애 수정 인수인계

## 1. 문서 목적과 보안 원칙

이 문서는 모바일 편집 후 다른 기기에서 로그아웃할 때 동기화 경고가 반복되던 장애의 원인, 수정 범위, 검증 기준과 후속 운영 절차를 설명합니다.

이 파일에는 실제 API 키, 액세스 토큰, 계정 식별자, Firebase 프로젝트 식별자, Cloudflare 계정 식별자, Worker 배포 주소, 사용자 UID, 이메일, 백업 내용 또는 기타 비공개 값을 기록하지 않습니다. 명령을 실행할 때도 실제 값은 GitHub Actions Secret 또는 Cloudflare 런타임 설정에서만 읽고 로그에 출력하지 않습니다.

## 2. 증상과 판별 기준

관찰된 흐름은 다음과 같습니다.

1. 모바일에서 편집을 완료합니다.
2. 모바일 또는 PC에서 로그아웃을 시도합니다.
3. IndexedDB와 Firestore 저장이 끝나도 Cloudflare 종료 체크포인트 저장이 실패합니다.
4. 앱은 데이터 유실을 막기 위해 `signOut()`을 호출하지 않고 경고 모달을 표시합니다.
5. 탭을 닫거나 다른 기기에서 기다려도 동일한 배포 설정을 사용하므로 문제가 반복됩니다.

이 장애는 사용자 데이터 충돌이나 기기 간 전파 지연만의 문제가 아니었습니다. 브라우저 개발자 도구에서 Backup Worker의 `/v1/backups` 또는 `/v1/checkpoints/latest` 요청이 404, 500 또는 호환되지 않는 응답을 내는지 먼저 확인해야 합니다.

## 3. 확정된 원인

두 가지 배포 설정 문제가 연속으로 존재했습니다.

- Pages 번들이 현재 Backup Worker가 아닌 이전 Worker 주소로 빌드되어 데이터 API가 404를 반환했습니다.
- 올바른 Worker를 배포한 뒤에도 Worker 런타임의 Firebase 프로젝트 변수와 허용 Origin 변수가 배포 설정에 포함되지 않아 데이터 API가 `WORKER_CONFIG_MISSING`으로 실패했습니다.

로그아웃 처리 자체는 의도대로 동작했습니다. Firestore 이후의 Cloudflare 체크포인트 저장이 실패했기 때문에, 최신 데이터가 모든 영속 계층에 저장됐다고 확정할 수 없어 로그아웃을 중단한 것입니다.

## 4. 계층별 책임과 변경 위치

| 계층 | 책임 | 관련 파일 |
|---|---|---|
| 화면 | 실패 단계를 사용자가 이해할 수 있는 안내로 변환 | `src/presentation/auth/logout-error-message.js`, `src/presentation/app-controller.js` |
| 처리 | 이미지, 로컬 저장, Firebase, 로컬 검증, Cloudflare 체크포인트 순서를 유지하고 실패 단계를 보존 | `src/application/sync/lifecycle-sync-service.js` |
| 핵심 규칙 | 백업 스키마, 보관 개수, 병합과 충돌 규칙 | 이번 수정에서 동작 변경 없음 |
| 저장·외부 서비스 | Worker API, Firebase ID Token 검증, R2 접근, CORS | `cloudflare-backup-worker/src/index.js`, `cloudflare-backup-worker/wrangler.toml` |
| 의존성 연결·앱 시작 | 저장소와 서비스를 조립 | 기존 조립 구조 유지 |
| 배포 | Pages 빌드 전에 Worker 서비스명, API 버전, 준비 상태를 확인 | `.github/workflows/deploy.yml` |

주 의존 방향은 `presentation → application → domain`을 유지합니다. 화면 코드는 HTTP 상태나 Worker 구현을 직접 처리하지 않고, 처리 계층이 붙인 `syncStage`만 안내 문구로 변환합니다.

## 5. 구현된 보호 장치

### Worker 준비 상태

`GET /v1/health`는 사용자 데이터나 환경값을 반환하지 않습니다. 고정된 서비스 계약, API 버전과 준비 여부만 반환합니다.

준비 상태는 다음 조건이 모두 충족될 때만 참입니다.

- Firebase 프로젝트 런타임 변수 존재
- 허용 Origin 런타임 변수 존재
- R2 binding 존재

설정이 빠지면 health는 성공으로 위장하지 않고 503과 `ready: false`를 반환합니다. 데이터 경로는 계속 Firebase ID Token을 요구합니다.

### Pages 배포 차단

Pages 배포는 Secret에 저장된 Worker 주소의 health 응답을 확인합니다. 서비스 계약, API 버전 또는 `ready: true`가 맞지 않으면 빌드 산출물을 운영에 배포하지 않습니다. Worker와 Pages가 동시에 배포될 수 있으므로 제한된 횟수만 재시도합니다.


### 모바일 홈·뒤로가기 이탈

모바일 브라우저의 홈 또는 뒤로가기는 `visibilitychange(hidden)` 다음 `pagehide`를 짧은 간격으로 발생시킬 수 있습니다. 이탈 동기화는 다음 순서를 유지합니다.

1. 최신 화면 상태를 IndexedDB snapshot/outbox에 확정합니다.
2. 겹쳐 발생한 이탈 이벤트는 같은 로컬 저장 Promise를 공유합니다.
3. 일반 hidden 경로는 Firestore flush 후 Cloudflare 체크포인트를 저장합니다.
4. pagehide 경로는 로컬 저장이 끝난 최신 payload만 keepalive 체크포인트로 전송합니다.
5. 실패하면 최신 세션 payload로 keepalive를 한 번 더 시도하며 IndexedDB outbox는 삭제하지 않습니다.

화면 계층에는 이탈 저장을 별도로 실행하는 중복 `pagehide` 리스너를 두지 않습니다. 모바일 운영체제가 웹 프로세스를 즉시 종료하면 네트워크 완료를 절대적으로 보장할 수 없으므로, 로컬 outbox와 다음 재접속 병합은 계속 최종 복구 경로로 유지합니다.

### 로그아웃 오류 안내

처리 계층은 다음 단계명을 사용합니다.

- `image-uploads`
- `local-persist`
- `firebase`
- `local-verify`
- `cloudflare-checkpoint`

Cloudflare 단계에서 주소 또는 API 불일치가 확인되면 일반 네트워크 오류와 구분해 안내합니다. 어떤 단계가 실패해도 성공 확인 전에는 로그아웃하지 않는 기존 데이터 보호 규칙을 유지합니다.

## 6. 설정 관리 규칙

| 값 종류 | 저장 위치 | 문서/로그 규칙 |
|---|---|---|
| 브라우저가 사용하는 Worker 주소 | GitHub Actions Secret | 실제 값을 Markdown, PR 본문 또는 로그에 복사하지 않음 |
| Firebase 브라우저 설정 | GitHub Actions Secrets | 변수명만 문서화하고 값은 출력하지 않음 |
| Cloudflare 배포 자격 증명 | GitHub Actions Secrets | 최소 권한을 사용하고 값은 출력하지 않음 |
| Worker 공개 배포 식별자 | Worker 배포 설정 | 운영 대상 변경 시 코드 리뷰와 함께 갱신 |
| R2 binding | Worker 배포 설정 | binding 이름과 실제 bucket 연결을 배포 전에 대조 |
| 사용자 토큰과 데이터 | 런타임 전용 | 콘솔, 테스트 fixture, 문서에 기록하지 않음 |

환경값을 점검할 때 `env`, `printenv`, Secret 전체 출력 또는 번들 전체 붙여넣기를 사용하지 않습니다. 존재 여부와 기대 동작만 검사합니다.

## 7. 재현 가능한 검증 절차

### 정적·자동 검사

1. 의존성을 설치합니다.
2. `npm test`를 실행합니다.
3. `npm run build`를 실행합니다.
4. PR의 Branch CI와 Pages 테스트/빌드가 모두 성공했는지 확인합니다.
5. 변경 diff에서 실제 Secret 값, 토큰, 사용자 데이터가 추가되지 않았는지 확인합니다.

관련 회귀 테스트는 다음 위치에 있습니다.

- `tests/backup-worker-policy.test.js`: 준비/미준비 health와 기존 토큰 정책
- `src/application/sync/lifecycle-sync-service.test.js`: 저장 순서와 Cloudflare 실패 단계
- `src/presentation/auth/logout-error-message.test.js`: 사용자 안내 분류

### 운영 읽기 전용 검사

실제 주소는 Secret 또는 승인된 운영 설정에서 읽고 명령이나 문서에 직접 적지 않습니다.

1. health가 HTTP 200이며 서비스 계약, API 버전, `ready: true`를 반환하는지 확인합니다.
2. 인증 없이 `/v1/backups`와 `/v1/checkpoints/latest`를 호출했을 때 401인지 확인합니다. 404는 주소/API 불일치, 500은 Worker 설정 또는 외부 서비스 문제로 분류합니다.
3. 승인된 Pages Origin으로 health를 호출했을 때 해당 Origin의 CORS 허용 헤더가 있는지 확인합니다.
4. 운영 HTML이 가리키는 최신 JavaScript 자산을 확인합니다.
5. 번들에 현재 Worker 주소가 포함되고 폐기된 Worker 주소가 포함되지 않았는지 불리언 결과만 확인합니다. 번들이나 주소 전체를 로그에 남기지 않습니다.
6. 테스트 계정의 최신 모바일 변경이 PC에 보이는지 확인한 뒤 로그아웃합니다. 네트워크에서 체크포인트 저장 성공 후 Firebase 로그아웃이 실행되는지 확인합니다.
7. 테스트 계정 자격 증명과 사용자 데이터는 스크린샷, 이슈, PR 또는 이 문서에 남기지 않습니다.

## 모바일 수동 세이브

모바일 일반 로그인 계정에는 메인 화면 상단의 홈 버튼 옆에 세이브 버튼을 표시합니다. 데스크톱과 Cloudflare 체크포인트를 사용할 수 없는 게스트 계정에는 표시하지 않습니다.

사용자가 세이브 버튼을 누른 경우에만 다음 즉시 저장을 실행합니다.

1. 진행 중인 이미지 저장 작업의 종료를 기다립니다.
2. 현재 편집 상태를 IndexedDB snapshot/outbox에 저장합니다.
3. Firestore에 최신 구조화 데이터를 병합합니다.
4. IndexedDB outbox가 방금 저장한 버전과 일치할 때만 완료 처리합니다.
5. 로컬 영속 상태가 최신이며 dirty 상태가 아님을 확인합니다.
6. Cloudflare의 사용자별 최신 종료 체크포인트를 교체합니다.

이 동작은 새 백업 항목을 만들지 않으며 기존 3분 유휴 동기화 간격을 변경하지 않습니다. 사용자의 명시적 클릭 한 번에만 실행하고, 저장 중 연속 클릭과 동시에 시작된 로그아웃은 같은 durable save Promise를 공유하여 Firebase 중복 호출을 막습니다.

버튼은 저장 중 비활성화되고 성공·실패 상태를 아이콘과 접근성 상태 영역에 표시합니다. 실패하더라도 IndexedDB outbox를 삭제하거나 로그아웃하지 않습니다.

### 최초 1회 온보딩

모바일 일반 로그인 계정의 실제 홈 또는 메인 화면이 표시될 때 다음 안내를 브라우저별 최초 1회만 표시합니다.

> 모바일에서 편집을 완료한 후에는 상단의 세이브 버튼을 눌러 저장까지 완료해주세요.

확인 여부는 계정 ID, 이메일 또는 토큰을 포함하지 않는 브라우저 로컬 불리언으로만 관리합니다. Firebase 또는 Cloudflare에는 온보딩 상태를 저장하지 않으므로 추가 네트워크 호출이 발생하지 않습니다. 브라우저 저장소가 삭제되면 안내가 다시 표시될 수 있습니다.

## 8. 장애 재발 시 진단 순서

1. Pages와 Worker의 최신 배포가 모두 성공했는지 확인합니다.
2. health 상태를 확인합니다.
   - 404: Worker 주소 또는 API 경로 불일치
   - 503: 필수 런타임 변수 또는 R2 binding 누락
   - 200이지만 `ready: false`: 계약 위반이므로 배포 중단
3. 데이터 API의 인증 없는 응답을 확인합니다.
   - 401: 경로와 인증 경계가 존재하는 정상 상태
   - 403: Origin 또는 사용자 유형 정책 확인
   - 500: Worker 설정, Firebase 공개키 조회 또는 R2 상태 확인
4. 인증 요청의 오류 코드를 확인하되 토큰을 로그에 출력하지 않습니다.
5. IndexedDB snapshot/outbox를 삭제하지 않습니다. 먼저 복구 가능한 로컬 상태와 Firestore 상태를 비교합니다.
6. 오류가 Cloudflare 단계라면 Firestore 저장 성공 여부를 별도로 확인합니다.
7. 복구 후 동일한 테스트 계정으로 모바일 편집 → PC 확인 → 로그아웃 순서를 다시 검증합니다.

## 9. 배포와 롤백

정상 배포 순서는 다음과 같습니다.

1. `drill` 브랜치에서 수정합니다.
2. 테스트와 빌드를 통과시킵니다.
3. PR diff와 보안 경계를 검토합니다.
4. `main`에 병합합니다.
5. Backup Worker 배포 성공을 확인합니다.
6. Pages의 Worker 호환성 검사와 배포 성공을 확인합니다.
7. 운영 읽기 전용 검사와 인증된 로그아웃 흐름을 확인합니다.
8. 확인이 끝난 뒤 작업 브랜치를 삭제합니다.

롤백은 문제가 발생한 계층만 되돌립니다. Worker 계약과 Pages 사전검증을 서로 다른 버전으로 남기지 않습니다. 데이터 스키마나 R2 객체를 삭제하는 롤백은 수행하지 않으며, 먼저 이전 코드 커밋으로 되돌리고 health와 인증 경계를 다시 확인합니다.

## 10. 유지보수 기준

- 새 외부 서비스 버전을 도입할 때 health의 API 버전과 Pages 검증을 함께 갱신합니다.
- 로그아웃 순서를 바꿀 때는 처리 계층 테스트로 호출 순서를 고정합니다.
- 화면 안내에는 내부 URL, UID, 토큰, 응답 본문 또는 환경값을 노출하지 않습니다.
- 대형 컨트롤러에 새 오류 분기나 HTTP 처리를 직접 추가하지 않습니다.
- 임시 우회 코드, 사용되지 않는 fallback, 중복 page lifecycle listener를 추가하지 않습니다.
- 설정값은 “값을 어디에 저장하는지”만 문서화하고 실제 값은 승인된 Secret/런타임 설정에서 관리합니다.

## 11. 완료 판정

다음 조건을 모두 만족해야 이 장애를 완료로 판정합니다.

- PR 테스트와 빌드 성공
- Backup Worker 배포 성공
- Pages 배포 성공
- health 200과 `ready: true`
- 데이터 API의 인증 없는 요청이 401
- 허용 Origin CORS 정상
- 운영 번들에 현재 Worker 설정 반영
- 인증된 모바일 편집 → PC 확인 → 로그아웃 흐름 성공
- 비공개 값이 문서, diff, 로그에 추가되지 않음
- 작업 브랜치 정리
