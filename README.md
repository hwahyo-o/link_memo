# Link Memo

Link Memo는 텍스트·URL·이미지·설정을 기기 간 동기화하는 Vanilla JavaScript 웹 앱입니다. 화면은 IndexedDB를 우선 사용해 오프라인에서도 반응하고, 로그인 사용자의 데이터는 Firebase와 병합되며 Cloudflare에 별도 백업됩니다. 이미지 원본은 사용자가 승인한 Google Drive의 비공개 `link_memo-img` 폴더에 저장됩니다.

## 현재 구현 범위

- 메모 단위 `updatedAt` + `mutationId` 충돌 해결과 삭제 tombstone
- 마지막 변경 후 3분 유휴 시 작업 중 자동 동기화
- 로그인 시 IndexedDB·Firestore·종료 체크포인트를 병합해 최신 상태 표시
- 로그아웃 전에 이미지 큐 → IndexedDB → Firestore → Cloudflare 저장을 `await`
- `visibilitychange(hidden)` 즉시 동기화와 `pagehide` keepalive 체크포인트
- KST 0/4/8/12/16/20시 접속 중 자동 백업
- Cloudflare R2에 사용자별 수동 3개 + 자동 3개, 별도 종료 체크포인트 1개 유지
- Google Drive 이미지 업로드와 Cloudflare D1의 암호화된 OAuth 토큰 보관

## 문서 안내

작업 전 아래 순서로 읽으면 저장소의 구성, 보안 경계, 배포 및 장애 대응을 빠짐없이 파악할 수 있습니다.

1. [ARCHITECTURE.md](ARCHITECTURE.md) — 필수 5계층, 데이터 모델, 동기화와 백업 흐름
2. [docs/SECURITY_AND_SECRETS.md](docs/SECURITY_AND_SECRETS.md) — Secret 분류, 권한, 금지 사항, 유출 대응
3. [docs/DEPLOYMENT_AND_OPERATIONS.md](docs/DEPLOYMENT_AND_OPERATIONS.md) — 최초 설정, 배포 순서, 검증, 운영 런북
4. [docs/FREE_TIER_DRIVE_SETUP.md](docs/FREE_TIER_DRIVE_SETUP.md) — Google OAuth·Drive·D1 상세 설정
5. [cloudflare-backup-worker/README.md](cloudflare-backup-worker/README.md) — R2 백업 Worker의 경계와 API

문서와 코드가 다르면 코드를 먼저 확인하고, 같은 변경에서 문서를 함께 수정합니다. 실제 프로젝트 ID, 계정 ID, 데이터베이스 ID, Worker URL, 토큰, 키 값은 Markdown·소스·예제 로그에 기록하지 않습니다.

## 로컬 개발

요구 사항은 Node.js 20 이상입니다.

```bash
npm ci
npm test
npm run dev
```

프로덕션 번들 검증은 `npm run build`로 수행합니다. 로컬 환경값은 Git에 포함되지 않는 `.env.local`에 넣고, 이름과 역할은 [보안 문서](docs/SECURITY_AND_SECRETS.md)만 기준으로 삼습니다.

## 변경 완료 기준

기능 변경은 다음 조건을 모두 만족해야 합니다.

- UI → Processing → Core → Storage 순서의 책임 분리가 유지됨
- 새 데이터 타입에 병합·직렬화·백업 정책을 모듈로 추가할 수 있음
- `npm test`와 `npm run build` 통과
- 인증된 UID 밖의 Firestore·R2·D1·Drive 데이터에 접근할 수 없음
- Secret 또는 실제 인프라 식별자가 diff와 Markdown에 없음
- 동기화, 백업, 환경변수, 운영 절차가 바뀌면 관련 Markdown도 함께 갱신됨

