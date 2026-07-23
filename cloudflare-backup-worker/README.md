# Link Memo Cloudflare Backup Worker

이 Worker만 비공개 R2 bucket에 접근합니다. 브라우저는 R2 자격 증명이나 object key를 받지 않으며 Firebase ID Token으로만 요청합니다.

## Cloudflare 설정

1. R2에 private bucket `link-memo-backups`를 만들고 public access를 활성화하지 않습니다.
2. Worker binding 이름 `BACKUPS`로 bucket을 연결합니다.
3. 런타임 변수 `FIREBASE_PROJECT_ID`와 쉼표 구분 `ALLOWED_ORIGINS`를 등록합니다. 실제 값은 저장소에 커밋하지 않습니다.
4. GitHub Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`가 준비되면 `Deploy Backup Worker` workflow로 배포합니다.
5. 배포 URL을 GitHub Secret `VITE_BACKUP_WORKER_URL`에 등록하고 Pages를 다시 배포합니다.

## API와 보관 정책

모든 경로는 `/v1` 아래입니다. 상태 확인 경로를 제외한 데이터 경로에는 `Authorization: Bearer <Firebase ID token>`이 필요합니다.

| 요청 | 역할 |
|---|---|
| `GET /v1/health` | 배포 대상과 API 버전 확인(인증 불필요) |
| `GET /v1/backups` | 인증 사용자 백업 목록 |
| `POST /v1/backups` | 수동/자동 백업 생성 후 타입별 최신 3개 보관 |
| `GET /v1/backups/:id` | 단일 백업 다운로드 |
| `DELETE /v1/backups/:id` | 단일 백업 삭제 |
| `GET /v1/checkpoints/latest` | 최신 종료 체크포인트 조회 |
| `POST /v1/checkpoints/latest` | 최신 종료 체크포인트 교체 |

Worker는 검증된 UID로 R2 경로를 직접 만들고 호출자가 제공한 UID/object path를 신뢰하지 않습니다. 종료 체크포인트는 수동 3개 + 자동 3개 보관 제한과 별도로 최신 1개를 유지합니다.

전체 배포와 운영은 [`docs/DEPLOYMENT_AND_OPERATIONS.md`](../docs/DEPLOYMENT_AND_OPERATIONS.md), Secret 원칙은 [`docs/SECURITY_AND_SECRETS.md`](../docs/SECURITY_AND_SECRETS.md)를 참조합니다.
