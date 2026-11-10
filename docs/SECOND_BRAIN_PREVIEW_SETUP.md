# 세컨드 브레인 스테이징 프리뷰 준비

## 현재 상태

PR `#79`는 초안이며, 저장소에는 비운영 프리뷰 배포 파이프라인이 아직 없습니다. GitHub Pages 배포는 `main` 푸시에서만 실행되고, PR 작업은 테스트와 빌드까지만 수행합니다.

운영 Firebase와 Worker를 프리뷰에서 재사용하면 로그인 사용자의 실제 Vault 데이터에 연결될 수 있습니다. 따라서 운영 백엔드에 연결하지 않고 아래처럼 별도 스테이징을 구성해야 합니다. 이 문서는 설정 계획이며, 아직 외부 리소스를 만들거나 배포하지 않았습니다.

## 분리할 리소스

| 리소스 | 스테이징 이름 | 목적 |
|---|---|---|
| Firebase 프로젝트 | `link-memo-second-brain-staging` | 테스트 로그인과 Firestore 데이터 분리 |
| Cloudflare D1 | `link-memo-drive-credentials-preview` | 스테이징 Drive 토큰·파일 소유권 분리 |
| Cloudflare Worker | `link-memo-drive-api-preview` | 프리뷰 Origin만 허용하는 문서/Drive API |
| Cloudflare Pages | `link-memo-second-brain-preview` | 운영 GitHub Pages와 분리된 화면 주소 |

예상 화면 주소는 `https://second-brain-preview.link-memo-second-brain-preview.pages.dev`입니다. 이 주소는 Pages 프로젝트를 만든 뒤 실제 배포 결과로 확인해야 합니다.

## 준비 순서

### 1. Firebase 스테이징 프로젝트

Firebase Console에서 새 프로젝트를 만들고 **Spark(무료) 요금제**에 둡니다. 운영 프로젝트를 복제하거나 운영 데이터를 가져오지 않습니다.

- 필요한 Authentication 제공자와 테스트 계정만 설정합니다.
- Firestore를 만들고, 기존 앱의 UID별 보안 규칙을 확인해 적용합니다.
- Firebase Web 앱을 추가하고 API key, Auth domain, Project ID, Storage bucket, Sender ID, App ID를 기록합니다.
- 실제 사용자 데이터는 가져오지 않습니다.

### 2. Drive OAuth 스테이징 클라이언트

새 Google OAuth Web Client를 만듭니다. 운영 클라이언트를 재사용하지 않습니다.

- 테스트 Google 계정만 Test users에 등록합니다.
- Pages 프리뷰 Origin과 Worker 설정에서 정한 redirect URI만 허용합니다.
- Client secret은 GitHub Secret 또는 Cloudflare Secret에만 저장합니다.
- Google Drive 폴더와 D1 데이터는 운영 리소스와 분리합니다.

### 3. Cloudflare 스테이징 리소스

Cloudflare에서 위 이름으로 새 D1, Worker, Pages 프로젝트를 준비합니다.

- Worker의 D1 binding은 스테이징 D1만 가리킵니다.
- Worker `ALLOWED_ORIGIN`은 Pages 프리뷰 Origin 하나로 제한합니다.
- Worker 변수의 `FIREBASE_PROJECT_ID`와 OAuth Client는 스테이징 Firebase/Google 프로젝트 값으로 설정합니다.
- 새 API token은 최소 권한으로 제한합니다: Pages 배포에는 Pages Write, Worker 배포에는 Workers Scripts Edit 및 D1 Edit.
- Pages 프로젝트의 운영 branch는 `main`으로 두고, 프리뷰 배포는 `second-brain-preview` branch alias로 분리합니다.

### 4. GitHub Actions 설정

별도 프리뷰 워크플로를 추가할 때 사용할 값은 Actions Repository Secrets에 저장합니다. 실제 값은 이 문서나 채팅, 소스 코드에 기록하지 않습니다.

- Firebase Web 앱 설정: `SECOND_BRAIN_PREVIEW_FIREBASE_API_KEY`, `SECOND_BRAIN_PREVIEW_FIREBASE_AUTH_DOMAIN`, `SECOND_BRAIN_PREVIEW_FIREBASE_PROJECT_ID`, `SECOND_BRAIN_PREVIEW_FIREBASE_STORAGE_BUCKET`, `SECOND_BRAIN_PREVIEW_FIREBASE_MESSAGING_SENDER_ID`, `SECOND_BRAIN_PREVIEW_FIREBASE_APP_ID`
- 프리뷰 연결: `SECOND_BRAIN_PREVIEW_DRIVE_WORKER_URL`, `SECOND_BRAIN_PREVIEW_BACKUP_WORKER_URL`, `SECOND_BRAIN_PREVIEW_GOOGLE_OAUTH_CLIENT_ID`
- 배포 권한: `CLOUDFLARE_PAGES_PREVIEW_API_TOKEN`, `CLOUDFLARE_WORKER_PREVIEW_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_PREVIEW_DATABASE_ID`

운영용 `VITE_*` 설정과 운영 D1 ID는 프리뷰 워크플로에서 참조하지 않습니다. 프리뷰 배포는 기능 브랜치에서만 실행하고 `main` 배포 경로는 건드리지 않습니다.

### 5. 프리뷰와 데이터 분리 확인

배포 뒤 다음 항목을 확인하고 나서 UI/계정 검증을 시작합니다.

1. 화면 URL이 별도 Pages 프리뷰 도메인인지 확인합니다.
2. 앱이 스테이징 Firebase Project ID와 프리뷰 Worker URL을 사용 중인지 확인합니다.
3. Drive 연결이 테스트 Google 계정에만 허용되는지 확인합니다.
4. 새로 만든 테스트 메모가 운영 PKM에서 보이지 않는지 확인합니다.
5. 업로드 파일이 프리뷰 Drive 폴더와 스테이징 D1에만 기록되는지 확인합니다.

## 비용 기준

Cloudflare Pages Free에는 배포 한도(월 500회)가 있고, D1은 Workers Free에서 무료 실험 사용량을 제공합니다. Firebase Spark는 no-cost 요금제입니다. 무료 한도를 초과하거나 유료 플랜 전환이 필요하다는 메시지가 나타나면 진행하지 않습니다.

- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Cloudflare D1 pricing and FAQ](https://developers.cloudflare.com/d1/reference/faq/)
- [Firebase pricing](https://firebase.google.com/pricing/)

## 다음 작업

Firebase 스테이징 Project ID와 Cloudflare 스테이징 리소스를 마련한 후, 이 저장소에 프리뷰 전용 배포 워크플로를 추가하고 비운영 주소를 생성합니다. 설정 값이나 Client secret은 채팅으로 전달하지 않습니다. 프리뷰 배포가 성공하면 로그인, 분류, 동기화, 첨부 검증을 진행합니다.
