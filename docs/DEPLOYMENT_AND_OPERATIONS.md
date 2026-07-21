# 배포 및 운영 런북

## 구성 요소와 배포 트리거

| 구성 요소 | 워크플로 | 자동 트리거 |
|---|---|---|
| 웹 앱 / GitHub Pages | `.github/workflows/deploy.yml` | `main` push 후 테스트·빌드 성공 |
| Drive Worker / D1 schema | `.github/workflows/deploy-drive-worker.yml` | Drive Worker 경로가 `main`에서 변경됨 |
| Backup Worker / R2 | `.github/workflows/deploy-backup-worker.yml` | Backup Worker 경로가 `main`에서 변경됨 |
| CI | `.github/workflows/ci.yml` | 설정된 push/PR 이벤트 |

## 최초 인프라 준비

1. Firebase Authentication의 로그인 provider를 활성화하고 Firestore Rules를 UID 범위로 제한합니다.
2. Google Cloud에서 Drive API와 OAuth Web client를 설정합니다. 상세 절차는 [FREE_TIER_DRIVE_SETUP.md](FREE_TIER_DRIVE_SETUP.md)를 따릅니다.
3. Cloudflare에 비공개 R2 bucket `link-memo-backups`와 D1 database `link-memo-drive-credentials`를 만듭니다.
4. 두 Worker의 binding, 변수, Secret을 [SECURITY_AND_SECRETS.md](SECURITY_AND_SECRETS.md) 표대로 등록합니다.
5. GitHub Repository secrets를 같은 문서의 표대로 등록합니다.
6. Repository **Settings → Pages → Build and deployment**의 Source가 **GitHub Actions**인지 확인합니다.

## 안전한 최초 배포 순서

Worker URL을 Pages 빌드에 넣어야 하므로 아래 순서를 지킵니다.

1. GitHub Actions에서 **Deploy Drive Worker**를 수동 실행합니다. D1 schema 적용과 Worker 배포 성공을 확인합니다.
2. GitHub Actions에서 **Deploy Backup Worker**를 수동 실행합니다. R2 binding과 런타임 변수 오류가 없는지 확인합니다.
3. 배포된 HTTPS URL을 각각 GitHub Secret `VITE_DRIVE_WORKER_URL`, `VITE_BACKUP_WORKER_URL`로 등록 또는 갱신합니다.
4. **Test and Deploy GitHub Pages**를 수동 실행합니다.
5. Pages URL에서 아래 배포 후 검증을 수행합니다.

Secret 값은 GitHub API로 읽어 검증할 수 없습니다. 값 누락 여부는 워크플로의 구성 검사와 배포 결과로 확인합니다.

## 배포 후 검증

1. 새 브라우저 프로필에서 로그인하고 텍스트, URL, 이미지, 설정을 저장합니다.
2. 3분 유휴 후 새로고침하여 변경이 유지되는지 확인합니다.
3. 다른 기기에서 같은 계정으로 로그인해 최신 `updatedAt` 레코드가 보이는지 확인합니다.
4. 양쪽 기기에서 서로 다른 항목을 편집한 뒤 재접속해 두 변경이 모두 병합되는지 확인합니다.
5. 한 기기에서 삭제한 항목이 다른 기기에서 tombstone으로 반영되어 되살아나지 않는지 확인합니다.
6. 로그아웃 직전 변경 후 로그아웃하고 다시 로그인해 변경이 남는지 확인합니다.
7. 탭을 숨기거나 닫은 뒤 재접속해 종료 체크포인트로 복구 가능한지 확인합니다.
8. 수동 백업 4회, 자동 백업 4회를 시험해 각 목록이 최신 3개만 유지되는지 확인합니다.
9. 백업 다운로드와 복원을 시험하고, 복원 전 상태를 다시 되돌릴 수 있는지 확인합니다.
10. Drive의 `link_memo-img` 폴더에 이미지가 비공개로 저장되고 다른 기기에서도 표시되는지 확인합니다.

## 일상 운영

- 배포 실패: GitHub Actions의 첫 실패 step을 확인합니다. Secret 값은 로그로 출력하지 않습니다.
- Pages만 실패: 필수 `VITE_*` 이름, Pages Source, 테스트/빌드 결과를 확인합니다.
- Drive Worker 실패: D1 ID 형식, API token의 Workers Scripts/D1 권한, D1 schema, Worker runtime 변수/Secret을 확인합니다.
- Backup Worker 실패: R2 binding 이름 `BACKUPS`, bucket 존재 여부, `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS`를 확인합니다.
- 401/403: 로그인 만료, Firebase project 불일치, CORS Origin 불일치, Firestore UID Rules 순으로 확인합니다.
- 기기 간 상태 불일치: 두 장치의 `updatedAt`, `mutationId`, tombstone, IndexedDB outbox와 Firestore 트랜잭션 오류를 확인합니다. 데이터 삭제보다 먼저 snapshot을 다운로드합니다.
- 이미지 실패: Drive 연결 상태, OAuth redirect URI 완전 일치, D1 token 레코드, `drive.file` scope를 확인합니다.

## 백업과 복구

- R2 object 삭제나 D1 token 삭제는 복구가 어려운 작업입니다. 정확한 UID와 대상 백업을 읽기 전용 조회로 먼저 확인합니다.
- 사용자 복원은 설정 화면의 목록/다운로드/복원 흐름을 우선 사용합니다.
- R2에는 수동 3개, 자동 3개, 종료 체크포인트 1개가 사용자별로 존재할 수 있습니다.
- D1 장애 또는 암호화 키 회전 뒤에는 Drive refresh token을 복구하려 하지 말고 사용자가 OAuth를 다시 승인하게 합니다.
- Firebase와 Cloudflare 모두 장애인 경우 IndexedDB를 보존하고 네트워크 복구 뒤 병합합니다. 브라우저 저장소 초기화를 먼저 안내하지 않습니다.

## 협업자 변경 절차

1. `main` 최신 상태에서 목적별 브랜치를 만듭니다.
2. 해당 5계층 안에서 최소 범위로 변경하고 단위 테스트를 추가합니다.
3. `npm ci`, `npm test`, `npm run build`, Secret 패턴 점검을 수행합니다.
4. 아키텍처·환경변수·운영 절차가 바뀌면 같은 PR에서 Markdown을 갱신합니다.
5. PR에서 CI와 보안 diff를 검토한 뒤 `main`에 병합합니다.
6. 자동 배포 결과와 위 배포 후 검증 항목을 확인합니다.

