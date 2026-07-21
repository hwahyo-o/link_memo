# 보안 및 Secrets 기준

이 문서는 Key Requirement 5의 기준입니다. 값 자체는 어디에도 기록하지 않고 이름, 소유 위치, 최소 권한만 문서화합니다.

## GitHub Actions Repository secrets

| 이름 | 사용 위치 | 설명 |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | Pages 빌드 | Firebase 웹 설정 |
| `VITE_FIREBASE_AUTH_DOMAIN` | Pages 빌드 | Firebase Auth 도메인 |
| `VITE_FIREBASE_PROJECT_ID` | Pages 빌드 | Firebase 프로젝트 식별자 |
| `VITE_FIREBASE_STORAGE_BUCKET` | Pages 빌드 | Firebase 웹 설정 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Pages 빌드 | Firebase 웹 설정 |
| `VITE_FIREBASE_APP_ID` | Pages 빌드 | Firebase 웹 앱 식별자 |
| `VITE_FIREBASE_MEASUREMENT_ID` | Pages 빌드, 선택 | Analytics를 쓸 때만 등록 |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Pages 빌드 | 공개 OAuth Web Client ID |
| `VITE_DRIVE_WORKER_URL` | Pages 빌드 | 배포된 Drive Worker HTTPS URL |
| `VITE_BACKUP_WORKER_URL` | Pages 빌드 | 배포된 Backup Worker HTTPS URL |
| `CLOUDFLARE_API_TOKEN` | Worker 배포 | 대상 계정에 제한된 배포 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | Worker 배포 | Cloudflare 계정 식별자 |
| `CLOUDFLARE_D1_DATABASE_ID` | Drive Worker 배포 | D1 binding 식별자 |

`VITE_*` 값은 번들에 포함되어 브라우저에서 볼 수 있으므로 비밀 자격 증명으로 간주하면 안 됩니다. 보안은 Firebase Security Rules, OAuth redirect/origin 제한, Worker의 ID Token 검증으로 보장합니다. Google client secret, refresh token, Cloudflare API token, 암호화 키에는 절대 `VITE_` 접두사를 쓰지 않습니다.

## Cloudflare 런타임 설정

Drive Worker `link-memo-drive-api`:

| 구분 | 이름 | 설명 |
|---|---|---|
| D1 binding | `DRIVE_CREDENTIALS` | `link-memo-drive-credentials` 데이터베이스 |
| 변수 | `FIREBASE_PROJECT_ID` | ID Token issuer/audience 검증 |
| 변수 | `ALLOWED_ORIGIN` | 정확히 하나의 운영 Origin |
| 변수 | `GOOGLE_OAUTH_REDIRECT_URI` | 등록된 OAuth redirect URI와 완전히 동일 |
| Secret | `GOOGLE_CLIENT_ID` | Google OAuth Web Client ID |
| Secret | `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| Secret | `TOKEN_ENCRYPTION_KEY` | base64 디코딩 시 정확히 32바이트 |

Backup Worker `link-memo-backup-worker`:

| 구분 | 이름 | 설명 |
|---|---|---|
| R2 binding | `BACKUPS` | 비공개 `link-memo-backups` bucket |
| 변수 | `FIREBASE_PROJECT_ID` | ID Token 검증 |
| 변수 | `ALLOWED_ORIGINS` | 쉼표로 구분한 명시적 운영/개발 Origin |

Cloudflare의 민감 항목은 Dashboard의 Secret 또는 `wrangler secret put`으로만 설정합니다. `wrangler.toml/jsonc`, Actions 로그, 이슈, PR 본문에 실제 값을 넣지 않습니다.

## 접근 제어 원칙

- Firestore는 인증 사용자 UID와 문서 경로 UID가 같은 경우에만 허용합니다. 전역 `match /{document=**}` 허용 규칙을 두지 않습니다.
- Backup Worker는 Firebase ID Token을 검증하고 R2 key를 서버에서 `users/<verified uid>/...` 형태로 생성합니다. 요청자가 object key나 다른 UID를 지정할 수 없습니다.
- Drive Worker는 Firebase 사용자와 Google ID Token 이메일 일치를 확인하고 refresh token을 AES-GCM 암호문으로만 D1에 저장합니다.
- R2 bucket은 public access를 비활성화합니다. Drive 파일은 공개 공유하지 않습니다.
- CORS는 `*` 대신 정확한 Origin allowlist를 사용합니다. 인증 요청에 요청 Origin을 무조건 반사하지 않습니다.
- 로그에는 Authorization header, OAuth code, ID/refresh/access token, Secret, 전체 백업 본문을 남기지 않습니다.

## 저장소 점검 체크리스트

커밋 전 다음을 확인합니다.

```bash
git diff --check
git grep -n -I -E "(BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|client_secret|refresh_token|CLOUDFLARE_API_TOKEN=|TOKEN_ENCRYPTION_KEY=)"
npm test
npm run build
```

검색 결과의 변수명·테스트 fixture는 문맥을 확인하고, 실제 값 또는 작동 가능한 자격 증명은 제거합니다. `.env*`, Wrangler 로컬 상태, 빌드 결과, 임시 도구, 압축 백업은 `.gitignore` 대상이어야 합니다.

## 유출 대응

1. 노출된 자격 증명을 즉시 폐기·회전합니다. Git 기록 삭제만으로는 안전해지지 않습니다.
2. Google OAuth client secret, Cloudflare API token, `TOKEN_ENCRYPTION_KEY`의 영향 범위를 각각 확인합니다.
3. 암호화 키가 노출되면 기존 D1 token 레코드를 폐기하고 사용자에게 Drive 재연결을 요구합니다.
4. GitHub Actions와 Cloudflare 로그에서 오용을 확인하고 Firebase 세션/규칙도 점검합니다.
5. 원인과 재발 방지 조치를 실제 값 없이 문서화하고, 필요하면 Git 이력 정리는 별도 승인 후 수행합니다.

