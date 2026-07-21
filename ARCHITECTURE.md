# Link Memo 아키텍처

이 문서는 구현의 기준입니다. 의존성은 UI와 외부 서비스에서 핵심 규칙을 향하며, 핵심 규칙은 DOM·Firebase·Cloudflare를 알지 못합니다.

## 필수 5계층

| 계층 | 경로 | 책임 |
|---|---|---|
| 1. UI | `src/presentation/` | DOM 이벤트 수집, 렌더링, 모달과 사용자 피드백 |
| 2. Processing | `src/application/` | 유스케이스 조합, 비동기 흐름, 3분 유휴 동기화, KST 백업 스케줄 |
| 3. Core Logic Rules | `src/domain/` | 충돌 해결, tombstone, 백업 보관 개수, 데이터 검증 |
| 4. Storage & Services | `src/infrastructure/` | IndexedDB, Firebase Auth/Firestore, Cloudflare, Google Drive 통신 |
| 5. Bootstrap | `src/bootstrap/` | 구현체 주입, 앱 시작, 전역 상태 연결 |

허용되는 주 의존 방향은 `presentation → application → domain`, `infrastructure → domain`, `bootstrap → 모든 계층`입니다. `src/features`, `src/ui`, `src/storage`의 기존 파일은 외부 참조 호환용 재내보내기만 유지합니다.

## 저장소별 역할

| 저장소 | 역할 | 보안 경계 |
|---|---|---|
| IndexedDB | 즉시 UI 반영, 오프라인 snapshot/outbox, 로컬 이미지 큐 | 현재 브라우저 프로필 |
| Firestore | 로그인 사용자의 정규 메모·카테고리·설정 상태 | Firebase ID Token의 UID |
| Cloudflare R2 | 수동/자동 백업과 최신 종료 체크포인트 | Backup Worker가 검증한 UID 접두사 |
| Google Drive | 이미지 바이너리와 `link_memo-img` 폴더 | 사용자가 승인한 `drive.file` 범위 |
| Cloudflare D1 | Drive refresh token 암호문과 폴더 식별자 | Drive Worker 전용 바인딩 |

브라우저는 R2/D1 자격 증명을 받지 않습니다. Firestore/R2에는 Drive 파일의 비공개 식별자만 보관하고 공개 공유 URL은 만들지 않습니다.

## 동기화 규칙

1. 사용자가 편집하면 UI 상태와 IndexedDB snapshot/outbox를 먼저 갱신합니다.
2. 작업 중 자동 저장은 마지막 변경 후 3분 유휴 시 Firestore 트랜잭션으로 수행합니다.
3. 로그인·재접속 시 로컬, Firestore, Cloudflare 종료 체크포인트를 동일한 병합 규칙으로 합치고 결과를 다시 저장·렌더링합니다.
4. 로그아웃은 이미지 큐 → IndexedDB → Firestore → Cloudflare 체크포인트가 성공한 뒤 `signOut()`을 호출합니다. 실패하면 로그아웃을 중단하고 재시도 가능한 오류를 표시해야 합니다.
5. `visibilitychange`가 `hidden`이면 유휴 시간과 무관하게 일반 동기화를 즉시 시도합니다.
6. `pagehide`에서는 종료 시간 제약을 고려해 인증된 작은 JSON 체크포인트를 `fetch(..., { keepalive: true })`로 전송합니다.

`keepalive`는 브라우저가 전달을 최종 보장하는 프로토콜이 아닙니다. 따라서 정합성의 기준은 IndexedDB outbox와 다음 로그인 시 병합이며, 종료 체크포인트는 복구 가능성을 높이는 보조 경로입니다. 큰 이미지 바이너리는 종료 요청에 포함하지 않습니다.

## 충돌 해결과 확장

- 레코드 비교 우선순위는 유효한 `updatedAt`, 그다음 결정적인 `mutationId`입니다.
- 같은 항목의 더 최신 레코드가 승리하며, 삭제는 `deleted: true` tombstone으로 전파합니다.
- 장치 시계가 같거나 타임스탬프가 겹쳐도 `mutationId`로 모든 장치가 같은 결과를 선택합니다.
- 새 데이터 타입은 `domain/<type>`에 정규화·비교 규칙, `application/<type>`에 흐름, `infrastructure`에 어댑터를 추가합니다. 기존 병합기를 타입별 전략 레지스트리로 확장하고 UI에 서비스 구현을 직접 넣지 않습니다.
- 데이터 스키마 변경 시 이전 백업을 읽는 마이그레이션 또는 기본값을 제공하고, 복원 테스트를 추가합니다.

핵심 구현은 `src/domain/sync/memo-merge-policy.js`, `src/application/memos/memo-sync-service.js`, `src/application/sync/lifecycle-sync-service.js`, `src/infrastructure/firestore/memo-repository.js`입니다.

## 백업 규칙

- 수동 백업과 자동 백업은 각각 최신 3개를 독립적으로 유지합니다.
- 자동 백업 예약 시각은 KST 기준 0, 4, 8, 12, 16, 20시이며 사이트가 열려 있을 때만 실행합니다.
- 종료 체크포인트는 백업 3+3에 포함하지 않고 사용자별 최신 1개만 유지합니다.
- 목록·다운로드·삭제·복원은 항상 검증된 Firebase UID 범위에서 수행합니다.
- 보관 개수는 UI가 아니라 `src/domain/backups/backup-policy.js`와 Backup Worker 양쪽에서 강제합니다.

## 상태 복구 원칙

Firestore, R2 또는 Drive 중 하나가 일시 실패해도 로컬 snapshot/outbox를 삭제하지 않습니다. 네트워크 복구 또는 다음 로그인 때 재시도하며, 성공 확인 전에는 더 오래된 원격 상태로 화면을 되돌리지 않습니다. 복원은 현재 상태를 별도 백업한 뒤 선택한 백업을 병합/적용하는 흐름을 유지합니다.

