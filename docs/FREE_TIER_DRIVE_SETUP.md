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

6. Client ID와 Client secret을 보관합니다. Secret은 GitHub 또는 소스 코드에 넣지 않습니다.

## 2. Cloudflare: 무료 Worker와 D1

1. Cloudflare 계정에서 **Workers & Pages > D1 SQL Database > Create**를 선택합니다.
2. 이름을 `link-memo-drive-credentials`로 입력하고 생성합니다.
3. 생성 화면의 Database ID를 복사해 `workers/drive-api/wrangler.jsonc`의 `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`를 교체합니다.
4. Worker 작업 폴더에서 의존성을 설치합니다.

   ```bash
   cd workers/drive-api
   npm install
   ```

5. D1 스키마를 적용합니다.

   ```bash
   npx wrangler d1 execute link-memo-drive-credentials --remote --file=./schema.sql
   ```

6. Worker Secret을 등록합니다. `TOKEN_ENCRYPTION_KEY`는 base64 형식의 **정확히 32바이트 난수**여야 합니다.

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put TOKEN_ENCRYPTION_KEY
   ```

7. Worker를 배포합니다.

   ```bash
   npm run deploy
   ```

8. 출력된 Worker URL(예: `https://link-memo-drive-api.<account>.workers.dev`)을 복사합니다.

## 3. GitHub Pages 빌드 설정

저장소 **Settings > Secrets and variables > Actions**에서 아래 Repository secret을 설정합니다.

| 이름 | 값 |
|---|---|
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Web OAuth Client ID |
| `VITE_DRIVE_WORKER_URL` | 2단계에서 배포한 Worker URL |

그 다음 GitHub Actions의 **Deploy to GitHub Pages** 워크플로를 다시 실행합니다.

## 4. 검증

1. 사이트에서 같은 Google 계정으로 로그인합니다.
2. 최초 한 번 Drive 연결을 승인합니다.
3. `link-memo-img` 폴더와 업로드된 이미지를 확인합니다.
4. 새로고침·다른 기기에서 같은 사이트 계정으로 로그인한 뒤 이미지를 열어 봅니다.
5. 이미지 hover/click 중에는 Google 로그인 창이나 계정 선택 창이 열리지 않아야 합니다.

## 보안 원칙

- Firebase Firestore에는 `permissionGranted` 같은 상태만 저장합니다.
- Refresh Token은 D1의 AES-GCM 암호문으로만 저장합니다.
- Worker는 Firebase ID Token과 Google OAuth ID Token의 이메일 일치를 확인합니다.
- Worker는 `https://hwahyo-o.github.io` Origin만 허용합니다.
- D1 데이터베이스와 Worker Secret에는 브라우저·GitHub Actions·Firestore에서 직접 접근할 수 없습니다.
