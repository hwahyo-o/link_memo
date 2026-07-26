# PKM Graph View 아키텍처

이 문서는 `pkm.html`의 구현·동기화·검색·그래프 처리 규칙과 협업 절차를 설명합니다. 실제 API 키, OAuth Client ID, Firebase/Cloudflare 식별자, Worker URL, 토큰, 사용자 UID와 이메일은 이 문서나 소스 예시에 기록하지 않습니다.

## 사용자 흐름

1. Link Memo의 `그래프 뷰 보러가기`를 누르면 독립 페이지 `pkm.html`이 열립니다.
2. 두 페이지가 같은 Origin과 Firebase Auth 인스턴스를 사용하므로 활성 로그인 세션을 다시 입력하지 않습니다.
3. PKM은 전용 IndexedDB `pkm_index_db`를 먼저 복원하고, 로그인 UID 범위의 Firestore PKM 문서와 병합합니다.
4. 기존 Link Memo의 로컬 DB와 Firestore 메인 문서는 스키마 키를 실행 시점에 읽어 PKM 그래프에 가져옵니다. 탐색 과정은 다른 사용자의 경로나 임의의 전역 컬렉션을 조회하지 않습니다.
5. 편집은 `Vault.process(path, task)`를 거쳐 같은 파일의 작업을 순서대로 실행합니다.
6. 변경은 즉시 IndexedDB outbox에 저장되고 마지막 편집 후 3분 동안 입력이 없으면 Firestore로 전송됩니다.
7. 모바일·태블릿 같은 비PC 기기에는 `모든 데이터 즉시 저장` 버튼이 표시됩니다. 버튼은 PKM outbox와 기존 Link Memo outbox를 즉시 처리하지만 3분 유휴 동기화를 끄지 않습니다.

## 5계층과 의존 방향

| 계층 | 주요 경로 | 책임 |
|---|---|---|
| 화면 | `src/presentation/pkm/`, `pkm.html`, `styles/pkm.css` | 파일 트리, 탭, 편집기, Cytoscape 렌더링, 검색·기기별 제어 |
| 처리 | `src/application/pkm/` | Vault 직렬 실행, 메타데이터 캐시, 그래프 투영, Worker, 동기화 조정 |
| 핵심 규칙 | `src/domain/pkm/`, `src/domain/sync/device-policy.js` | 검색, 3단계 강조, JSON Canvas 검증, 파일 병합·tombstone, PC/비PC 분류 |
| 저장·외부 서비스 | `src/infrastructure/pkm/`, 기존 Drive/Firebase 어댑터 | IndexedDB, Firestore chunk, 스키마 탐색, Drive 이미지 |
| 시작·연결 | `src/bootstrap/pkm-main.js` | Auth/DB singleton, Worker, 저장소, 서비스, 화면 주입 |

주 의존 방향은 `presentation → application → domain`, `infrastructure → domain`, `bootstrap → 모든 계층`입니다. DOM, Firebase SDK, IndexedDB, Cytoscape 객체를 핵심 규칙으로 전달하지 않습니다.

## 저장 모델

### IndexedDB

DB 이름은 `pkm_index_db`, 버전은 1입니다.

- `vaultSnapshots`: UID별 최신 Vault snapshot
- `vaultOutbox`: 아직 Firestore가 확인하지 않은 동일 snapshot

파일 레코드는 `path`, `type`, `content`, `updatedAt`, `mutationId`, `deleted`를 가집니다. 삭제는 실제 제거 대신 tombstone으로 병합되어 오래된 장치가 파일을 되살리지 못하게 합니다.

### Firestore

기존 UID 보안 경계 아래에 다음 구조를 사용합니다.

```text
artifacts/{appId}/users/{uid}/memoData/pkm
artifacts/{appId}/users/{uid}/memoData/pkm/vaultChunks/{revision}_{index}
```

루트에는 schema version, revision, chunk ID 목록과 갱신 시각만 저장합니다. 파일은 약 360KB 단위로 묶어 Firestore 단일 문서 제한에 여유를 둡니다. 새 chunk가 모두 저장된 뒤 루트 포인터를 교체하고, 그 다음 이전 chunk를 정리합니다. 중간 실패 시 기존 루트가 계속 이전의 완전한 revision을 가리킵니다.

현재 운영 Rules가 `memoData/{document=**}`를 UID 일치 조건으로 보호해야 합니다. 전역 허용 규칙을 추가하지 않습니다.

## 동기화

모든 기기는 같은 기본 규칙을 사용합니다.

1. 편집기 입력을 250ms로 묶어 Vault에 적용합니다.
2. Vault 변경을 IndexedDB snapshot/outbox에 즉시 기록합니다.
3. 마지막 변경 후 3분 유휴 시 local/remote Vault를 파일 clock으로 병합합니다.
4. 새 Firestore revision을 저장합니다.
5. 쓰기 시작 때의 outbox version과 현재 version이 같을 때만 outbox를 확인 완료합니다.
6. 저장 중 새 편집이 생기면 기존 version만 확인하고 최신 outbox는 다음 동기화에 남깁니다.

비PC의 수동 저장은 대기 중 Drive 이미지 작업을 기다린 뒤 PKM과 Link Memo를 함께 flush합니다. 등록 계정이면 기존 Cloudflare 최신 체크포인트도 갱신합니다. PC에서도 3분 유휴 저장은 동일하게 동작하지만 수동 버튼은 표시하지 않습니다.

비PC 판별은 화면 폭이 아니라 브라우저 기기 정보를 사용합니다. Android 휴대전화·태블릿, iPhone, iPad, iPadOS 데스크톱 User-Agent는 비PC입니다. Windows/macOS/Linux/ChromeOS는 터치 화면이어도 PC로 유지합니다.

## 메타데이터와 검색

`graph-worker.js`는 Markdown에서 다음 값을 추출합니다.

- 첫 H1 또는 파일명 제목
- 본문
- hashtag
- HTML comment
- `[[wiki link]]`
- HTTP(S) URL

`MetadataCache`가 Worker 결과를 path별로 보관합니다. `SearchEngine`은 검색어를 NFKC 정규화하고 소문자로 비교합니다.

- `키워드 모두 포함`: 모든 token이 제목·본문·태그·댓글·링크를 합친 문자열에 존재
- `키워드 중 하나라도 포함`: token 하나 이상이 존재
- 입력은 300ms debounce
- `X` 또는 `ESC`: 검색과 강조 상태 초기화

검색 결과는 다음 세 집합으로 계산합니다.

1. `.is-direct-match`: 직접 일치, opacity 1, 확대, 고대비 파란색
2. `.is-context-match`: 직접 일치 노드와 inbound 또는 outbound edge 하나로 연결, cyan, 중간 확대
3. `.is-dimmed`: 나머지 노드, 낮은 opacity와 회색

`검색 결과 노드 모아보기`는 직접 일치와 1-hop 문맥 노드가 있을 때만 보이며 두 집합을 50px padding으로 맞춥니다.

## 그래프 Worker와 성능

Worker는 메타데이터 파싱과 레이아웃을 메인 스레드 밖에서 수행합니다. 레이아웃은 공간 hash의 인접 cell만 계산하는 근사 반발력과 edge 인력을 사용해 모든 노드 쌍을 비교하는 `O(n²)` 루프를 피합니다. 3,000개를 넘으면 반복 횟수를 낮추고 Cytoscape는 다음 렌더링 설정을 사용합니다.

- 단순 원형 node와 직선 edge
- `pixelRatio: 1`
- viewport 조작 중 edge 숨김
- viewport texture 사용
- element ID 직접 조회
- 검색 강조 시 필요한 소수 node에만 shadow

Cytoscape는 기존 앱의 외부 브라우저 의존성 사용 방식과 동일하게 `pkm.html`에서 정확한 버전을 고정해 불러옵니다. 버전을 갱신할 때는 공식 성능 지침, 10,000-node fixture, 브라우저 콘솔과 Pages 배포를 함께 검증합니다.

10,000-node 테스트는 좌표의 유한성, 결과 개수, Worker 실행을 검증합니다. 실제 FPS는 브라우저, GPU, edge 수와 화면 픽셀 수의 영향을 받으므로 배포 전 대표 데스크톱 환경에서 pan/zoom 프레임과 long task를 함께 확인합니다.

## JSON Canvas 1.0

파서는 다음을 검증합니다.

- `nodes`: `text`, `file`, `link`, `group`
- 공통 필드: `id`, `type`, `x`, `y`, `width`, `height`, 선택적 `color`
- file의 `file`, 선택적 `subpath`
- link의 `url`
- group의 `label`, `background`, `backgroundStyle`
- `edges`: `id`, `fromNode`, `toNode`, side, endpoint arrow, color, label
- node/edge ID 중복과 존재하지 않는 node 참조

손상된 `.canvas` 하나는 해당 파일의 연결만 제외하며 나머지 Vault 렌더링을 중단하지 않습니다.

## 이미지

편집기에서 이미지를 선택하면 브라우저 IndexedDB에 먼저 저장합니다. 기존 Link Memo의 Drive 연결 상태가 유효하면 같은 `drive.file` 범위와 기존 Drive Worker를 통해 즉시 `link-memo-img` 폴더에 업로드합니다. 브라우저에는 refresh token이나 client secret을 저장하지 않습니다. Drive 연결이 없으면 로컬 참조를 남기며 사용자는 Link Memo 설정에서 Drive를 연결할 수 있습니다.

## 유지보수와 확장

- 파일 타입 추가: `vault-policy.js`의 허용 타입과 전용 parser를 추가합니다.
- 검색 필드 추가: Worker metadata 결과에 필드를 추가하고 `search-engine.js`의 haystack만 확장합니다.
- 강조 단계 변경: `graph-highlight-rules.js`의 집합 계산과 `graph-view.js` 스타일을 함께 변경합니다.
- 스키마 변경: `PKM_SCHEMA_VERSION`을 올리고 이전 snapshot migration 테스트를 추가합니다.
- Firestore 경로·chunk 변경: Rules, repository, 복원 테스트와 이 문서를 같은 변경에 갱신합니다.
- UI는 SDK 오류 코드나 Firestore 경로를 직접 해석하지 않습니다.
- 임시 fallback, 사용되지 않는 feature flag, 중복 lifecycle listener를 남기지 않습니다.

## 변경 완료 체크리스트

```bash
npm ci
npm test
npm run build
git diff --check
```

추가로 데스크톱·iPhone·iPad·Android 태블릿의 버튼 표시, 3분 유휴 저장, 수동 전체 저장, 검색, 노드 더블클릭 편집, 편집 완료 후 중심 복귀, 10,000-node pan/zoom, 콘솔 오류와 Secret 패턴을 확인합니다.
