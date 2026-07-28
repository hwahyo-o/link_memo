# 반응형 저장·Drive 이미지·로그아웃 인수인계

이 문서는 실제 키, 토큰, 계정·프로젝트·데이터베이스 식별자, 배포 비밀값을 포함하지 않습니다. 이후 협업자는 이 문서와 루트의 ARCHITECTURE.md, PKM_ARCHITECTURE.md, 보안·배포 문서를 함께 읽어야 합니다.

## 완료 조건

- viewport 너비가 1024px 이하이면 비PC로 분류합니다. User-Agent, 운영체제, 터치 지원 여부는 사용하지 않습니다.
- 비PC에서 게스트의 즉시 저장 버튼은 숨기고, Google 및 이메일/비밀번호 등록 계정에는 표시합니다.
- 비PC에서 이메일/비밀번호 로그인 또는 회원가입이 성공한 해당 로그인 시도에는 Google 연동 안내 모달을 한 번 표시합니다.
- 640px 이하 메인 헤더는 왼쪽 홈, 오른쪽 그래프·즉시 저장, 그 아래 계정 정보, 다음 행 제목 순서입니다. 계정 정보와 로그아웃 버튼은 같은 가로줄을 유지합니다.
- 그래프 이동 아이콘은 Font Awesome 6의 fa-hexagon-nodes입니다.
- Google 계정이 Drive 권한을 가진 경우 즉시 저장 성공 전에 모든 첨부 이미지의 Drive 파일 존재 여부를 검증하고 누락본을 업로드합니다.
- 게스트 로그아웃은 로컬 IndexedDB 저장이 확인되면 원격 dirty 상태와 관계없이 진행할 수 있습니다.

## 계층별 책임

### 화면 계층

- index.html, index.css: 헤더 영역과 640px 반응형 배치, 아이콘 마크업.
- src/presentation/app-controller.js: 로그인 방식별 안내, 버튼 표시 갱신, 사용자에게 보이는 오류 연결.
- src/presentation/sync/mobile-save-controller.js: 등록 사용자·비PC 조건에 따른 버튼 상태와 수동 저장 실행.
- src/presentation/pkm/app-controller.js: PKM 화면에 동일한 viewport 표시 정책 적용.

### 처리 계층

- src/application/sync/lifecycle-sync-service.js: 한 번의 저장 Promise를 공유하고 저장 단계를 순서대로 조율합니다.
- src/application/drive/drive-image-service.js: Drive 세션 복구, 원격 파일 검증, 누락 이미지 재업로드, 최종 완전성 판정.
- src/application/memos/image-attachment-queue.js: 로컬 이미지 저장과 초기 Drive 업로드를 제한된 동시성으로 처리합니다.

### 핵심 규칙 계층

- src/domain/sync/device-policy.js: 비PC의 유일한 기준인 최대 viewport 너비와 media query를 제공합니다.
- Drive 사용 가능 여부와 이미지 참조 형식은 기존 src/domain/drive 정책을 그대로 사용합니다.

### 저장·외부 서비스 계층

- IndexedDB 저장소는 현재 기기의 이미지 원본과 메모 outbox를 보관합니다.
- Drive Worker 저장소는 Firebase ID 토큰으로 인증하고 Drive 업로드·검증·다운로드를 수행합니다.
- Firestore는 다른 기기가 읽을 메모와 Drive 파일 참조를 보관합니다.
- Cloudflare 체크포인트는 등록 계정의 마지막 영속 상태를 별도 보관합니다.

### 의존성 연결 계층

src/presentation/app-controller.js가 저장소와 서비스를 생성해 lifecycle 서비스에 주입합니다. Google 계정이며 Drive 연결이 활성화된 경우에만 Drive 이미지 보장 함수를 주입 경로에서 실행합니다. 이메일/비밀번호 계정과 게스트에 Drive 호출을 추가하지 않습니다.

### 앱 시작 계층

src/main.js와 PKM 시작 모듈은 환경 설정과 SDK 의존성을 준비하고 각 화면 컨트롤러를 시작합니다. viewport 변경 구독은 화면 컨트롤러 수명에 맞춰 연결합니다.

## 저장 순서와 실패 규칙

등록 계정의 수동 저장은 다음 순서를 유지합니다.

1. 진행 중 이미지 큐가 모두 끝날 때까지 대기합니다.
2. Google+Drive 연결 사용자라면 Drive 세션과 모든 파일을 검증하고 누락본을 업로드합니다.
3. Drive 파일 ID가 반영된 최신 payload를 IndexedDB에 기록합니다.
4. Firestore outbox를 비우고 다시 로컬 상태를 읽어 dirty가 false인지 검증합니다.
5. Cloudflare 종료 체크포인트를 저장합니다.

2단계에서 현재 기기의 로컬 원본도 없거나 Drive 세션·업로드가 실패하면 저장은 실패합니다. Firestore에 불완전한 이미지 참조를 새 성공 상태로 확정하지 않습니다. 사용자는 현재 기기의 원본을 유지한 채 연결 또는 네트워크를 복구하고 다시 저장해야 합니다.

게스트는 1단계와 IndexedDB 기록·payload 존재 검증까지만 수행합니다. 게스트에게 제공하지 않는 Firestore·Cloudflare 완료 조건을 요구했던 것이 기존 로그아웃 차단의 원인이었습니다.

## 검증 명령과 수동 점검

    npm ci
    npm test
    npm run build

배포 후 실제 모바일 Chrome 또는 같은 viewport의 브라우저에서 다음을 확인합니다.

1. 게스트, Google, 이메일/비밀번호 계정 각각의 버튼 표시 조건.
2. 이메일/비밀번호 로그인 직후 안내 문구가 한 번 표시되는지.
3. 320px와 640px에서 홈·작업 버튼·계정 정보·제목이 겹치지 않고, 긴 이메일에서도 계정 정보와 로그아웃 버튼이 같은 줄인지.
4. Google+Drive 사용자로 모바일에서 이미지를 등록하고 즉시 저장한 뒤, 다른 기기에서 이미지가 보이는지.
5. Drive 네트워크를 차단했을 때 즉시 저장이 성공으로 표시되지 않는지.
6. 게스트 편집 후 로그아웃이 로컬 저장 검증을 거쳐 완료되는지.

## 보안·운영 주의

- OAuth client secret, 암호화 키, Firebase 서비스 계정, 실제 Worker URL과 계정·프로젝트 ID를 소스·Markdown·로그에 기록하지 않습니다.
- 브라우저에는 Drive refresh token을 저장하지 않습니다. 토큰은 Worker의 암호화 저장 경계를 유지합니다.
- Drive 파일은 사용자 전용 비공개 폴더와 최소 권한 범위를 유지합니다.
- 장애 로그에는 오류 코드와 단계만 남기고 토큰, 요청 본문, 사용자 데이터는 남기지 않습니다.


## 게스트 로컬 전용 세션과 로그아웃

신규 게스트에게 Firestore 문서와 IndexedDB snapshot이 모두 없을 때 dataLoadState가 missing으로 남으면 writeLocalMemo가 실행되지 않는다. 그 상태에서 로그아웃 검증이 로컬 payload를 찾지 못해 MEMO_LOCAL_PERSIST_INCOMPLETE가 발생하고, 이전 기본 오류 문구는 이를 클라우드 실패로 잘못 안내했다.

게스트 세션은 다음 규칙을 사용한다.

1. 로그인 시 IndexedDB snapshot을 복구하고, 없으면 기본 메모를 dataLoadState ready인 로컬 세션으로 초기화한다.
2. 편집은 메모리 화면 상태와 IndexedDB에만 반영한다.
3. Firestore 구독·예약 동기화·온라인 복귀 동기화, Google Drive, Cloudflare 백업은 실행하지 않는다.
4. 로그아웃은 이미지 로컬 작업 → IndexedDB 쓰기 → IndexedDB payload 재확인 순서로 실행한다.
5. 로컬 payload가 확인된 경우 Firebase 로그아웃을 진행한다.
6. 실제 IndexedDB 실패는 클라우드 오류가 아닌 로컬 저장 공간 오류로 안내하며, 등록 계정의 원격 영속성 규칙에는 영향을 주지 않는다.

게스트 로그아웃 뒤 새 익명 로그인은 새 UID이므로 이전 게스트 데이터를 자동 복구하지 않는다. 데이터를 계속 사용하려면 로그아웃 전에 계정 연동을 완료해야 한다. 계정 연동으로 익명 상태가 등록 상태로 전환되면 같은 UID의 IndexedDB payload를 Firestore에 최초 저장하고 이후 등록 사용자 동기화 경로를 활성화한다.


## 모바일 사용자 정보 단일 행 규칙

640px 이하에서 `.main-header-user`에 `flex-wrap: wrap`이 적용되면 긴 이메일과 로그아웃 버튼의 합산 너비가 컨테이너를 넘어 버튼이 다음 줄로 이동한다. 모바일 사용자 영역은 다음 두 칸 그리드로 유지한다.

- 사용자 정보: `minmax(0, 1fr)`로 남은 공간을 사용하고, 긴 텍스트는 말줄임표로 표시한다.
- 로그아웃 버튼: `auto` 너비와 줄바꿈 금지 규칙으로 항상 같은 가로줄에 남긴다.
- DOM, 인증 이벤트, 로그아웃 처리, 저장소 및 외부 서비스 호출은 변경하지 않는다.
- `!important`와 JavaScript viewport 분기는 추가하지 않는다.

회귀 테스트는 모바일 CSS에 그리드 열 정의, 사용자 텍스트 말줄임, 버튼 줄바꿈 금지가 존재하고 기존 `flex-wrap`이 다시 들어오지 않는지 확인한다.


## Drive 업로드와 연결 해제의 공통 장애 경계

이미지 로컬 저장은 성공하지만 Drive 업로드와 연결 해제가 동시에 실패하면 파일 형식보다 공통 Worker 경계를 먼저 확인한다. 두 동작은 Firebase ID 토큰과 동일한 Drive Worker 주소를 사용하므로 프런트엔드 설정 누락, Worker 도달 실패, Origin 불일치 또는 인증 만료가 두 기능을 함께 중단시킬 수 있다.

현재 규칙은 다음과 같다.

1. Pages 배포 전에 OAuth Client ID와 Drive Worker URL의 존재를 값 노출 없이 검사한다.
2. Drive Worker health와 D1 준비 상태가 확인되지 않으면 Pages를 배포하지 않는다.
3. Worker 요청이 401이면 Firebase ID 토큰을 한 번 갱신한 뒤 동일 요청을 재시도한다.
4. 네트워크·CORS 실패는 `DRIVE_WORKER_UNREACHABLE`로 분류하고 내부 오류 내용은 사용자에게 노출하지 않는다.
5. 설정 누락, 인증 만료, Origin 불일치, 자격증명 손상을 서로 다른 안전한 안내 문구로 표시한다.
6. 원격 연결 해제가 실패하면 로컬 상태만 성공으로 바꾸지 않는다.

운영 검증에서는 이미지 첨부 후 로컬 실패가 0인지뿐 아니라 Drive 참조가 생성됐는지, 다른 기기에서 열리는지, 연결 해제 후 재승인이 가능한지를 함께 확인한다.
