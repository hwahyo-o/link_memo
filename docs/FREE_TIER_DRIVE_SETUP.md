# Firebase Spark + Cloudflare Worker Drive 설정

이 앱은 Firebase Spark(무료)에서 Firebase Authentication과 Firestore만 사용합니다. Google Drive 토큰 자동 갱신은 Cloudflare Workers/D1 무료 계층이 담당합니다. Google Drive 파일은 공개 링크로 공유하지 않습니다.

## 1. Google Cloud: Drive API와 OAuth 클라이언트

Firebase 프로젝트 **link-note-c8c1d**와 같은 Google Cloud 프로젝트에서 진행합니다.

1. **APIs & Services > Library**에서 **Google Drive API**를 사용 설정합니다.
2. **Google Auth Platform > Branding**에서 앱 정보를 등록하고, 테스트 중이면 사용하는 Google 계정을 Test users에 추가합니다.
3. **Data Access**에 아래 범위를 추가합니다.
   - `openid`
   - `email`
   - `https://www.googleapis.com/auth/drive.file`
4. **Clients > Create client > Web application**을 생성합니다.
5. Authorized JavaScript origins와 Authorized redirect URIs에 각각 아래 값을 추가합니다.

   ```text
   https://hwahyo-o.github.io
   ```

6. Client ID와 Client secret을 보관합니다. Client secret은 GitHub 또는 소스 코드에 넣지 않습니다.

## 2. Cloudflare: 무료 Worker와 D1

1. Cloudflare에서 D1 데이터베이스 **link-memo-drive-credentials**를 생성합니다.
2. Database ID `d41f773d-25d1-4be5-8671-d15f83693cbf`는 이미 main의 Worker 설정에 반영되어 있습니다.
3. **Workers & Pages > Create > Worker**에서 Worker 이름을 `link-memo-drive-api`로 생성하고, 초기 기본 코드는 그대로 한 번 배포합니다.
4. Worker의 **Settings > Variables and Secrets**에서 아래 세 항목을 모두 **Secret**으로 추가합니다.

   | 이름 | 값 |
   |---|---|
   | `GOOGLE_CLIENT_ID` | 1단계에서 만든 Web OAuth Client ID |
   | `GOOGLE_CLIENT_SECRET` | 1단계에서 만든 Client secret |
   | `TOKEN_ENCRYPTION_KEY` | base64 형식의 정확히 32바이트 난수 |

   난수는 로컬에서 아래 명령으로 생성할 수 있습니다. 출력값은 복사 후 안전하게 보관하고 소스 코드에는 넣지 않습니다.

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

5. Cloudflare Account API Token을 생성합니다. 권한은 해당 계정에만 제한하고 다음을 부여합니다.
   - **Workers Scripts: Edit**
   - **D1: Edit**

6. Cloudflare 대시보드에서 Account ID를 복사합니다.

## 3. GitHub Actions로 Worker 배포

저장소 **Settings > Secrets and variables > Actions**에서 아래 Repository secret을 추가합니다.

| 이름 | 값 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 2단계에서 만든 제한된 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 2단계의 Cloudflare Account ID |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Web OAuth Client ID |
| `VITE_DRIVE_WORKER_URL` | 첫 Worker 배포 뒤 출력된 Worker URL |

1. 처음에는 `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID`만 등록합니다.
2. GitHub **Actions > Deploy Drive Worker > Run workflow**를 실행합니다.
3. 워크플로는 D1의 `schema.sql`을 안전하게 재실행하고 Worker를 배포합니다.
4. 완료 로그의 Worker URL(예: `https://link-memo-drive-api.<account>.workers.dev`)을 복사합니다.
5. 그 URL을 `VITE_DRIVE_WORKER_URL`에 등록합니다.
6. GitHub **Actions > Deploy to GitHub Pages > Run workflow**를 실행합니다.

Worker 소스가 main에 변경될 때마다 `Deploy Drive Worker`가 자동 실행됩니다. Cloudflare API Token은 GitHub Secret으로만 보관되며, Worker의 Google OAuth·암호화 Secret은 Cloudflare에서만 보관됩니다.

## 4. 검증

1. 사이트에서 같은 Google 계정으로 로그인합니다.
2. 최초 한 번 Drive 연결을 승인합니다.
3. `link-memo-img` 폴더와 업로드된 이미지를 확인합니다.
4. 새로고침·다른 기기에서 같은 사이트 계정으로 로그인한 뒤 이미지를 열어 봅니다.
5. 이미지 hover/click 중에는 Google 로그인 창이나 계정 선택 창이 열리지 않아야 합니다.

## 5. Firestore 권한 확인

이 구조에서 Firestore에는 Drive Refresh Token을 저장하지 않습니다. 기존 메모 경로만 본인 UID로 제한하고, 만약 이전 실험에서 `driveCredentials` 컬렉션을 만든 적이 있다면 클라이언트 접근을 막습니다.

```text
match /artifacts/{appId}/users/{uid}/memoData/{documentId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
match /driveCredentials/{uid} {
  allow read, write: if false;
}
```

기존에 `match /{document=**}`로 모든 로그인 사용자에게 읽기·쓰기를 허용한 규칙이 있다면 제거하거나 메모 경로로 좁혀야 합니다. Firestore 규칙은 허용 규칙이 하나라도 맞으면 접근을 허용합니다.

## 보안 원칙

- Firebase Firestore에는 `permissionGranted` 같은 상태만 저장합니다.
- Refresh Token은 D1의 AES-GCM 암호문으로만 저장합니다.
- Worker는 Firebase ID Token과 Google OAuth ID Token의 이메일 일치를 확인합니다.
- Worker는 `https://hwahyo-o.github.io` Origin만 허용합니다.
- D1 데이터베이스와 Worker Secret에는 브라우저·GitHub Actions·Firestore에서 직접 접근할 수 없습니다.
