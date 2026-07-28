# 로그인 기반 Drive 이미지 정리 인수인계

## 범위

이 기능은 등록 사용자의 인증 세션이 앱 시작 시 확정된 뒤 KST 월별 1회 Google Drive의 `link-memo-img` 폴더를 사이트 이미지 참조와 대조합니다. 현재 사이트 데이터에 없는 Drive 파일은 영구 삭제합니다.

Google Drive 연결 해제 화면과 연결 해제 처리 계약은 이 작업 범위에서 변경하지 않았습니다. 연결이 해제된 계정은 Worker가 Drive 권한을 보유하지 않으므로 월별 대조를 실행하거나 완료로 기록하지 않습니다.

## 계층

| 계층 | 파일 | 책임 |
|---|---|---|
| UI | `src/presentation/app-controller.js`, `index.html`, `index.css` | 로그인 완료 후 실행, 초기화 보존 확인, 캐러셀 개별 삭제, 상태 안내 |
| Processing | `src/application/drive/drive-reconciliation-service.js` | 페이지 작업 반복, 초기화·복원·회원 탈퇴 흐름 조합 |
| Core | `src/domain/drive/image-reconciliation-policy.js` | KST 월, 실행 필요 여부, 현재 파일 집합, 단일 첨부 제거 |
| Storage | `src/infrastructure/http/drive-worker-image-repository.js` | 인증된 Worker API 호출 |
| External | `workers/drive-api/src/index.js`, `workers/drive-api/schema.sql` | Drive 목록·삭제, D1 월 완료 기록과 작업 잠금 |
| Bootstrap | `src/presentation/app-controller.js` 상단 조합부 | 구현체 주입 |

## 월별 대조 계약

- 직접 로그인과 저장된 Firebase 세션 복원 모두 앱 시작 인증으로 간주합니다.
- Firestore·IndexedDB·Cloudflare 체크포인트 병합이 끝나고 `dataLoadState === "ready"`인 경우에만 실행합니다.
- KST 월 키는 클라이언트가 아니라 Worker가 계산합니다.
- D1의 `last_completed_month`가 현재 월이면 같은 달의 이후 로그인에서 생략합니다.
- 지난달 또는 기록 없음이면 실행합니다.
- 일부 삭제 또는 목록 조회가 실패하면 현재 월을 완료 처리하지 않습니다.
- 작업 ID와 5분 lease로 두 기기의 동시 실행을 차단합니다.
- Drive 폴더의 파일 중 현재 사이트가 제출한 파일 ID 집합에 없는 파일만 삭제합니다.
- 목록은 페이지 단위로 처리하며 응답의 작업 ID와 페이지 토큰을 다음 요청에 전달합니다.
- 게스트, Drive 미연결, 불완전한 사이트 데이터는 실행하지 않습니다.

## 초기화와 복원

초기화가 내구 저장된 뒤 Worker에 보존 등록을 요청합니다. Worker는 현재 월을 완료 처리하고 다음 KST 월을 `reset_cleanup_month`로 저장합니다.

다음 달 첫 로그인에서는 자동 삭제 전에 확인 모달을 표시합니다.

- 취소: Drive 이미지를 유지하고 설정의 백업 복원을 이용합니다. 월 완료 기록은 만들지 않습니다.
- 확인: 현재 사이트에 없는 Drive 파일을 영구 삭제합니다.

백업 복원이 로컬과 Firestore에 내구 저장된 뒤 보존 표시를 해제합니다. 복원된 링크가 참조하는 Drive 파일은 다음 대조에서 유지됩니다.

## 캐러셀 한 장 삭제

현재 캐러셀 이미지에 마우스를 올리거나 키보드 포커스를 두면 삭제 버튼이 표시됩니다. 터치 기기에서는 첫 터치 또는 모바일 화면에서 버튼을 사용할 수 있습니다.

삭제는 먼저 사이트 메타데이터를 내구 저장한 뒤 Drive 파일을 삭제합니다. Drive 삭제가 실패하면 이전 이미지 배열을 다시 내구 저장해 사용자가 재시도할 수 있도록 합니다. Drive 삭제 성공 뒤 IndexedDB 원본을 정리합니다. 이미지 전용 항목의 마지막 이미지는 삭제하지 않습니다.

## 회원 탈퇴

Drive가 연결된 경우 Firebase Auth 계정을 삭제하기 전에 다음 순서를 지킵니다.

1. 재인증
2. Drive `link-memo-img` 폴더 삭제
3. D1 Drive 자격 증명과 월별 상태 삭제
4. R2 사용자 백업과 체크포인트 삭제
5. Firestore, IndexedDB, 로컬 상태 삭제
6. Firebase Auth 계정 삭제

Drive 또는 R2 정리가 실패하면 Firebase Auth 계정을 삭제하지 않습니다. Drive 연결 해제 상태의 처리 정책은 별도 작업 범위입니다.

## Worker API

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/images/reconcile` | 현재 KST 월의 대조 필요·초기화 보존 상태 |
| POST | `/images/reconcile` | 현재 사이트 파일 ID를 기준으로 한 페이지 대조 |
| POST | `/images/reconcile/defer` | 초기화 뒤 다음 달까지 보존 |
| POST | `/images/reconcile/restore` | 백업 복원 뒤 보존 표시 해제 |
| DELETE | `/account` | 연결된 Drive 폴더와 D1 사용자 상태 삭제 |
| DELETE | Backup Worker `/v1/account` | 사용자 R2 백업·체크포인트 전체 삭제 |

모든 요청은 Firebase ID Token과 운영 Origin 검증을 통과해야 합니다. 실제 UID, 파일 ID, OAuth 토큰, Worker URL, 프로젝트 ID 및 Secret 값은 문서나 로그에 기록하지 않습니다.

## 운영 확인

1. Drive Worker 워크플로가 D1 스키마를 적용하고 배포됐는지 확인합니다.
2. Backup Worker와 Pages 배포가 모두 성공했는지 확인합니다.
3. 테스트 계정으로 같은 달 두 번 로그인하여 두 번째 대조가 생략되는지 확인합니다.
4. 테스트용 Drive 고아 이미지를 만든 뒤 다음 달 상태를 모의하거나 테스트 환경에서 월 키 정책을 검증합니다.
5. 초기화 후 같은 달 보존, 다음 달 확인 모달, 백업 복원 후 이미지 유지 여부를 확인합니다.
6. 캐러셀에서 중간 이미지 한 장을 삭제하고 다른 기기와 Drive에서 모두 사라졌는지 확인합니다.
7. 테스트 계정 회원 탈퇴 시 Drive 폴더, R2 객체, Firestore와 Auth 데이터가 순서대로 정리되는지 확인합니다.

영구 삭제 검증은 운영 사용자 데이터가 아닌 별도 테스트 계정과 테스트 이미지로 수행합니다.
