# PKM 그래프 재구성 계획

> 상태: 구현·검증·main 병합·배포 완료 (PR #44 / `e7656ce`)
> 기준 저장소: `hwahyo-o/link_memo`
> 기준 브랜치/커밋: `main` / `c0c5e544ae06524931c65b952018b08b50ba699e`
> 기준 시각: 2026-08-02 (KST)

이 문서는 PKM 그래프 노드 중첩, 레거시 회색 노드, 노드 표현, 범례, 대규모 렌더링, 파일 열기 동작과 확대 속도를 한 번에 수정하기 위한 실행 기준이다. 구현은 사용자 승인 뒤 `main`에서 새 `drill` 브랜치를 만들어 진행한다. API 키, OAuth Client ID, Firebase/Cloudflare 식별자, Worker URL, 토큰, 사용자 UID·이메일과 실제 사용자 메모 내용은 코드·테스트 fixture·문서·로그에 기록하지 않는다.

## 1. 조사 결과와 문제별 원인

### 노드 중첩

- 현재 Worker는 모든 노드를 점으로 취급하고 초기 간격을 `110 x 86` 정도로 둔다.
- 반발력은 노드의 실제 폭·높이를 입력받지 않는다.
- 화면 계층은 레이아웃 완료 뒤 모바일 노드를 최대 `280 x 136`으로 키운다.
- 따라서 레이아웃 좌표가 유효해도 실제 캡슐 경계는 겹친다.

### 회색 노드

- 회색은 검색의 `미일치` 데이터가 아니라 새 `.graph-index`에 포함되지 않은 모든 기존 Vault 파일에 주는 기본 색 `#e2e8f0`이다.
- PR #42 이전 importer는 소분류 하나를 Markdown 하나로 집계했다. PR #42는 버튼 하나당 Markdown 하나를 만들지만, 이전 importer가 만든 집계 파일을 식별·정리하는 migration은 포함하지 않았다.
- 회색 노드에는 자동 생성된 레거시 파일뿐 아니라 사용자가 직접 작성·수정한 Markdown/JSON Canvas와 기본 시작 파일도 포함될 수 있다. 색만 보고 일괄 영구 삭제하면 데이터 손실 위험이 있다.

### 노드 모양과 텍스트

- 현재 `category`, `subcategory`, `item`은 둥근 사각형이며 기본 파일 노드는 원형이다.
- Cytoscape의 기본 단일 `label` 스타일은 같은 노드 안에서 제목과 해시태그에 서로 다른 글자 크기·굵기를 적용할 수 없다.
- 제목/키워드를 분리된 데이터 필드와 표시 계층으로 다뤄야 한다.

### 범례와 색상

- 검색 상태 범례와 노드 유형 범례가 모두 캔버스 위에 상시 떠 있어 모바일에서 노드를 가린다.
- 현재 `link-image`와 `link-image-text`가 모두 `#DE6863`으로 중복된다.
- 사용자 확정 색상은 `image = #FF9797`, `link-image = #FFA374`, `link-image-text = #DE6863`이다. 이 세 유형은 서로 다른 색으로 유지한다.

### 핵심 내용 툴팁과 파일 열기

- 현재 PC tooltip은 노드에서 pointer가 벗어나는 즉시 닫히고 `pointer-events: none`이므로 tooltip으로 이동하거나 누를 수 없다.
- 현재 비PC는 노드 첫 tap에 tooltip, 빠른 두 번째 tap에 파일 열기를 사용한다.
- 목표 동작은 PC hover 또는 비PC 첫 tap으로 핵심 내용 tooltip을 열고, tooltip 자체를 누르면 해당 파일을 여는 것이다.
- 노드에서 tooltip으로 pointer가 이동하는 짧은 구간에는 tooltip이 유지되어야 한다.
- 핵심 내용이 비어 tooltip을 만들 수 없는 node도 있을 수 있으므로, `path`가 있는 모든 node는 PC double-click 또는 비PC double-tap으로 연결된 Markdown 파일을 열 수 있어야 한다.

### 검색·선택 시각 상태

- 현재 검색 강조는 direct/context/dimmed class만 사용하고 선택 상태와 조합된 단일 정책이 없다.
- 현재 `node:selected`는 검은색 border만 추가하므로 요청한 노드 고유 색 border·drop shadow·opacity 조합을 표현하지 못한다.
- 실제 반투명 dimmed overlay layer와 node z-order를 분리해 관리해야 한다.

### 대규모 렌더링

- Worker가 좌표를 계산하는 동안 현재 화면 계층은 모든 노드·간선을 Cytoscape에 추가한다.
- `hideEdgesOnViewport`, `textureOnViewport`, `pixelRatio: 1`은 조작 비용은 낮추지만 100,000 노드/500,000 간선을 한 번에 materialize하는 메모리 비용을 제거하지 않는다.
- 전체 보기와 확대 보기의 표현 단계를 분리하고, 상세 단계에서는 viewport 주변 요소만 materialize해야 한다.

### 파일 열기/닫기와 확대

- 현재 파일을 연 시점이 아니라 `편집 완료` 시점에 `graphView.center(path)`가 호출된다. 요구 동작과 반대다.
- `center()`는 항상 zoom `1.2`로 바꿔 닫을 때 기존 viewport를 보존하지 못한다.
- 휠 민감도는 `0.2`다. 약 4배 가속 목표는 `0.8`을 기준으로 기기별 과도한 점프가 없는지 확인한다.

## 2. 데이터 분류 및 삭제 정책

파일은 색이 아니라 출처와 무결성 증거로 분류한다.

| 분류 | 판정 근거 | 그래프 표시 | 영구 처리 |
|---|---|---|---|
| 현재 Link Memo 파생 파일 | 현재 `.graph-index` 항목의 path와 생성 hash 일치 | 표시 | 보존 |
| PR #42 이전 자동 집계 파일 | 레거시 projector로 현재 원본에서 다시 만든 path/content와 byte 단위 일치, 또는 그에 준하는 결정론적 provenance 일치 | 미표시 | tombstone 허용 |
| 수정된 레거시 집계 파일 | 레거시 경로/표식은 맞지만 재생성 content와 불일치 | 미표시 | 보존, 자동 삭제 금지 |
| 사용자 작성 Markdown/JSON/Canvas | 생성 provenance 없음 | 기본 미표시 | 보존, 자동 삭제 금지 |
| 기본 시작 파일 | 정확한 path, mutationId, 원본 content가 모두 기본 fixture와 일치 | 미표시 | tombstone 허용 |
| 현재 파생 index manifest/shard | `.graph-index.json`, `.graph-index/*.json` | 미표시 | 현행 reconciliation만 관리 |

삭제는 물리적 즉시 제거가 아니라 기존 Vault 병합 규칙에 맞는 tombstone으로 기록한다. 사용자가 편집한 파일과 출처를 증명할 수 없는 파일은 삭제하지 않는다. migration은 idempotent해야 하며 두 번 실행해도 새 tombstone이나 충돌을 만들지 않아야 한다.

## 3. 목표 구조: 5계층

### 화면 계층

- `pkm.html`, `styles/pkm.css`: 검색 상태 범례 제거, 그래프 도구에 노드 유형 범례 버튼·세로 tooltip, 실제 dimmed overlay, 접근 가능한 hover/focus/tap 상태, 모바일 배치.
- `src/presentation/pkm/graph-view.js`: overview/detail 의미론적 zoom, viewport culling, 캡슐 노드, 분리된 제목/키워드 표시, 선택 상태, 검색·선택 시각 상태 적용, 파일 focus, 휠 확대 속도, tooltip 수명주기.
- `src/presentation/pkm/workspace.js`, `app-controller.js`: 파일을 열 때 focus하고 탭/편집기를 닫을 때 viewport를 변경하지 않는 명시적 이벤트 계약.

### 처리 계층

- `src/application/pkm/graph-projector.js`: 표시 가능한 노드만 투영하고 제목·keyword label·실제 geometry를 제공한다.
- `src/application/pkm/graph-worker.js`: 실제 노드 사각 경계를 고려한 layout, 공간 hash 기반 충돌 제거, 전체 좌표·extent·공간 index용 데이터를 반환한다.
- 별도 소형 migration service: 레거시 예상 결과를 재구성하고 안전 삭제 후보만 tombstone으로 변환한다.

### 핵심 규칙 계층

- 노드 유형별 색, 표시 여부, geometry, semantic zoom 임계값을 순수 정책으로 모은다.
- 검색 활성 여부, direct/context/non-match, 선택 node ID를 입력으로 받아 opacity, border, shadow, dimmed overlay 위·아래 layer를 반환하는 순수 시각 상태 정책을 둔다.
- 레거시 파일 분류는 DOM/Firebase/Cytoscape를 모르는 순수 함수로 둔다.
- 삭제 가능 판정은 path 또는 mutationId 하나만으로 통과하지 않고 재생성 content/hash까지 요구한다.

### 저장·외부 서비스 계층

- 기존 IndexedDB/Firestore Vault repository와 tombstone 병합 방식을 재사용한다.
- 원본 Link Memo, 사용자 편집 파일, Drive 이미지 참조를 직접 삭제하지 않는다.
- 외부 AI/API 호출을 추가하지 않는다.

### 의존성 연결 및 앱 시작 계층

- `src/bootstrap/pkm-main.js`는 새 정책·migration·view 의존성을 조립한다.
- 로그인 session 전환 시 전체 graph model, viewport index, tooltip, pending layout 요청을 함께 초기화한다.
- migration은 hydrate 뒤, graph projection 앞에 한 번 적용하고 기존 persist/flush 경계를 사용한다.

## 4. 구현 설계

### 4.1 겹침 없는 안정 레이아웃

- 그래프 성격은 방향성이 약한 계층+키워드 혼합 네트워크이므로 기존 force 계열을 유지하되, category/subcategory 계층력을 우선한다.
- 모든 노드에 실제 `width`, `height`, `padding`을 입력한다.
- 각 force iteration 뒤 공간 hash의 인접 cell에서 AABB 충돌을 검사해 최소 분리 벡터를 적용한다.
- 마지막 deterministic overlap-removal pass와 component packing을 실행한다.
- 동일 입력은 동일 좌표를 만들며, 작은 변경에서 기존 노드 좌표가 과도하게 이동하지 않도록 stable ID 순서를 유지한다.
- Gate는 모든 노드 쌍 전수 비교가 아니라 공간 index로 검사하되, 테스트 fixture에서는 실제 교차 수가 0임을 검증한다.

### 4.2 캡슐과 제목/키워드 타이포그래피

- 모든 유형의 외형은 pill/capsule로 통일한다.
- 전체 보기에서는 label 없는 축약 캡슐/점과 유형 색만 표시한다.
- 상세 보기에서는 viewport 안 노드에 제목과 키워드를 별도 text layer로 그린다.
- 제목은 keyword보다 정확히 4px 크게 하고 `700` 이상, keyword는 `400~500`으로 둔다.
- 사용자 텍스트는 `textContent` 또는 Canvas text API만 사용하고 HTML 문자열로 삽입하지 않는다.

### 4.3 범례

- `직접 일치 / 1-hop 문맥 / 미일치` 상시 범례는 삭제한다. 검색 강조 동작 자체는 유지한다.
- 그래프 도구에 `노드 유형 범례` 버튼을 추가한다.
- PC: hover와 keyboard focus에서 tooltip 표시, pointer leave/blur/Escape에서 닫는다.
- 모바일/태블릿: 첫 tap으로 열고, 바깥 tap·Escape·다른 도구 선택으로 닫는다.
- tooltip 항목은 색상 swatch + 유형명을 한 줄씩 세로 배열하고, 캔버스를 과도하게 가리지 않도록 viewport 안에 배치한다.

### 4.4 고유 색상

- 사용자 확정값: `image = #FF9797`, `link-image = #FFA374`, `link-image-text = #DE6863`.
- 나머지 기존 유형 색상도 포함해 exact hex 중복이 없는지 자동 검사한다.
- 색 정의는 한 모듈에서만 소유하고 projector, legend, test가 이를 가져다 쓴다.

### 4.5 핵심 내용 툴팁과 파일 열기

- PC는 item node `pointerenter`/keyboard focus에서, 비PC는 첫 tap에서 핵심 내용 tooltip을 연다.
- tooltip은 `pointer-events: auto`, button 또는 접근 가능한 link 역할을 가지며 click/tap/Enter/Space로 연결된 Markdown 파일을 연다.
- 노드를 떠나면 즉시 제거하지 않고 짧은 hide grace timer를 시작한다. tooltip에 `pointerenter`하면 timer를 취소하고, node와 tooltip 모두에서 pointer가 벗어났을 때만 닫는다.
- tooltip을 누르는 동안에는 먼저 파일 open 명령을 전달한 뒤 tooltip을 닫는다. pointerdown 시점에 선행 blur/outside-click이 tooltip을 제거하지 않도록 이벤트 순서를 테스트한다.
- 핵심 내용이 있는 node의 기본 파일 열기 경로는 PC `hover → tooltip click`, 비PC `첫 tap → tooltip tap`이다.
- tooltip 유무와 무관하게 `data(path)`가 있는 node의 PC double-click과 비PC double-tap을 파일 열기 fallback으로 유지한다. 두 경로는 같은 `openNodeFile(path)` 명령으로 합쳐 한 번만 실행한다.
- 핵심 내용이 없는 node는 빈 tooltip을 표시하지 않는다. single click/tap은 node 선택만 수행하고 double-click/double-tap이 연결 파일을 연다.
- `data(path)`가 없는 category/subcategory 같은 구조 node는 double-click/double-tap으로 임의의 하위 파일을 열지 않는다.
- tooltip에는 핵심 내용과 `파일 열기`라는 명확한 action affordance를 제공한다. 핵심 내용은 `textContent`로만 주입한다.
- pan/zoom, 다른 node 선택, 빈 canvas tap, Escape, 파일 open, 인증 session 변경에서 tooltip을 닫는다.

### 4.6 검색·선택 시각 상태 정책

시각 상태는 `deriveNodeVisualState({ searchActive, matchKind, selectedNodeId, nodeId })`와 같은 순수 함수 한곳에서 결정한다. `searchActive`는 검색 필드의 trim 결과가 비어 있지 않은 상태다. 검색 debounce 중에도 dimmed overlay는 즉시 활성화하고, 직전 결과가 있으면 새 결과가 확정될 때까지 유지한다.

#### 검색어가 없을 때

| 선택 상태 | 대상 node | opacity | border | shadow | layer |
|---|---|---:|---|---|---|
| 선택 없음 | 모든 node | 100% | 유형 기본 border | 없음 | 기본 |
| 선택 있음 | 선택 node | 100% | 유형 기본 또는 node 고유 색 강조 | node 색, `3px 4px 5px` | 기본 위 |
| 선택 있음 | 비선택 node | 70% | 유형 기본 border | 없음 | 기본 |

Drop shadow의 정확한 계약은 CSS/Cytoscape 좌표 기준 `offset-x: 3px`, `offset-y: 4px`, `blur: 5px`, 색상은 node의 `data(color)`와 동일하게 한다.

#### 검색어가 있을 때

검색 활성 시 canvas 위에 실제 반투명 dimmed overlay를 추가한다. `위` node는 overlay보다 높은 z-order, `아래` node는 overlay보다 낮은 z-order에 놓는다.

| 검색 관계 | 선택 존재 | 대상 node 상태 | overlay 기준 | opacity | border | shadow |
|---|---|---|---|---:|---|---|
| 직접 일치 | 없음 | direct | 위 | 100% | 파랑 3px | 없음 |
| 직접 일치 | 있음 | 선택 node | 위 | 100% | node 색 3px | node 색 `3px 4px 5px` |
| 직접 일치 | 있음 | 비선택 node | 위 | 85% | 파랑 3px | 없음 |
| 1-hop 문맥 | 없음 | context | 위 | 85% | 하늘색 3px | 없음 |
| 1-hop 문맥 | 있음 | 선택 node | 위 | 100% | node 색 3px | node 색 `3px 4px 5px` |
| 1-hop 문맥 | 있음 | 비선택 node | 위 | 70% | 하늘색 3px | 없음 |
| 미일치 | 없음 | non-match | 아래 | 70% | 유형 기본 border | 없음 |
| 미일치 | 있음 | 비선택 node | 아래 | 70% | 유형 기본 border | 없음 |
| 미일치 | 있음 | 선택 node | 위 | 100% | node 색 3px | node 색 `3px 4px 5px` |

마지막 행은 추가 요청에 명시되지 않은 조합이다. 선택 node가 검색 미일치일 때도 선택 피드백이 사라지지 않도록 위 정책을 기본 제안으로 기록하며, 사용자 승인으로 확정한다.

이 상태 전이는 사용자 주석으로 확정한다.

1. 검색 중 미일치 node를 선택하면 `overlay 위 + opacity 100% + node 색 3px border + node 색 3px/4px/5px shadow`를 적용한다.
2. 그 node의 선택이 해제되는 즉시 `선택 없음 + 미일치` 행으로 다시 평가한다.
3. 결과는 `overlay 아래 + opacity 70% + 유형 기본 border + shadow 없음`이다.
4. 다른 node를 선택해 기존 node가 비선택 미일치가 된 경우에는 표의 `미일치 + 선택 있음 + 비선택 node` 행에 따라 `overlay 아래 + opacity 70%`를 적용한다.

- node 선택은 click/tap/keyboard activation으로 설정하고 빈 canvas의 click/tap 또는 Escape로 해제한다. drag 종료는 빈 canvas 선택 해제로 오인하지 않는다.
- 검색어 변경·검색 mode 변경은 선택 node를 자동 해제하지 않는다.
- 선택 node와 검색 결과 node는 viewport 밖에 있더라도 detail renderer가 우선 materialize한다.
- edge는 연결된 양 끝 node의 가장 높은 강조 수준을 따르되 node보다 앞에 오지 않으며, 검색 미관련 edge는 overlay 아래 또는 낮은 opacity로 둔다.

### 4.7 의미론적 zoom과 viewport 렌더링

- Worker는 전체 노드 위치와 전체 extent를 먼저 계산한다. 화면 밖 노드는 위치만 보존한다.
- overview 단계: 전용 Canvas layer에 모든 노드를 작은 단색 capsule/dot로 batch draw하고 간선·label은 생략 또는 강하게 샘플링한다.
- detail 단계: viewport + overscan에 들어오는 노드만 Cytoscape/상세 layer에 materialize한다. 간선은 양 끝점 또는 segment가 가시 범위에 관련된 것만 표시한다.
- pan/zoom 중에는 `requestAnimationFrame` 단위로 viewport query를 합치고, 정지 뒤 detail을 보강한다.
- 공간 index는 grid 기반으로 시작해 의존성을 늘리지 않는다. 실제 성능 Gate를 못 넘을 때만 검증된 R-tree 도입을 재검토한다.
- 검색 결과, 선택 노드, 현재 연 파일은 viewport 밖이어도 focus 작업 동안 우선 materialize한다.

### 4.8 파일 focus와 viewport 유지

- 파일 tree/tap/double-tap으로 파일을 실제로 열 때 해당 노드 좌표로 이동하고 읽기 가능한 detail zoom으로 확대한다.
- 탭 닫기와 `편집 완료`는 graph pan/zoom을 변경하지 않는다.
- 열기 전 viewport를 자동 복원하지 않는다. 사용자가 마지막으로 보고 있던 위치는 닫은 시점 그대로 유지한다.
- 그래프에 표시하지 않는 보존 파일을 file tree에서 열면 graph viewport는 변경하지 않는다.

### 4.9 휠 확대

- `wheelSensitivity`를 `0.2`에서 `0.8` 기준으로 조정한다.
- min/max zoom clamp, trackpad 작은 delta, 일반 mouse wheel, 모바일 pinch, zoom 버튼을 각각 검증한다.
- `prefers-reduced-motion`에서는 focus/fit animation duration을 최소화한다.

## 5. Process Phase, Gate, 실패 시 재수정 Loop

### Phase 0 — 승인과 기준 고정

- 사용자에게 본 문서, 확정 색상, 확정된 미일치 node 선택/해제 전이, tooltip 없는 node의 double-click/double-tap fallback, 삭제 안전 정책, 검증 환경 제약을 보고한다.
- **Gate 0:** 사용자 명시적 진행 승인.
- 실패/변경 요청 시 본 문서만 수정하고 구현에 들어가지 않는다.

### Phase 1 — 브랜치와 회귀 fixture

- GitHub 연결 앱으로 최신 `main` SHA를 재확인하고 정확히 `drill` 브랜치를 생성한다.
- 레거시 자동 생성/사용자 편집/수동 파일 fixture, 겹침 fixture, zoom/legend/focus 계약 테스트를 먼저 추가한다.
- **Gate 1:** 기존 동작 보존 조건과 새 실패 테스트가 문서 요구를 정확히 표현한다.
- 실패 시 fixture 또는 요구 해석을 고친 뒤 반복한다.

### Phase 2 — 핵심 정책과 안전 migration

- 색상·geometry·표시 정책과 레거시 분류 순수 함수를 구현한다.
- 안전 자동 생성 파일만 tombstone 처리하고 나머지는 보존·미표시한다.
- **Gate 2:** 삭제 허용 fixture 100% 삭제, 보존 fixture 0% 삭제, 재실행 idempotent.
- 실패 시 삭제를 중단하고 판정 조건을 더 보수적으로 좁힌다.

### Phase 3 — 레이아웃과 projection

- geometry-aware force, 충돌 제거, component packing, 실제 label field를 구현한다.
- **Gate 3:** 대표 계층/키워드 fixture에서 overlap 0, 좌표 finite, deterministic, 상한 준수, 기존 핵심 간선 보존.
- 실패 시 repulsion을 무작정 높이지 않고 geometry/padding/collision pass 순으로 원인을 분리해 재수정한다.

### Phase 4 — 화면·상호작용·가상화

- 캡슐, 분리 typography, legend tooltip, 핵심 내용 tooltip→파일 열기, tooltip 없는 node의 double-click/double-tap fallback, 검색·선택 상태 matrix, dimmed overlay, overview/detail, viewport culling, open-focus/close-preserve, wheel sensitivity를 구현한다.
- **Gate 4:** PC와 360~430px 모바일에서 필수 조작 가능, 범례가 그래프를 상시 가리지 않음, node→tooltip pointer 이동 중 tooltip 유지, tooltip 유무와 무관한 파일 열기 fallback 동작, hover 의존 기능에 tap/focus 대체 경로 존재, 상태 matrix 전 조합과 선택 해제 전이 일치.
- 실패 시 각 기능을 독립적으로 되돌릴 수 있는 작은 모듈 경계에서 수정한다.

### Phase 5 — 자동 검증과 보안 diff 검토

- `npm test`, `npm run build`, diff whitespace 검사와 secret pattern 검사를 실행한다.
- 보안 diff 검토에서 사용자 텍스트 HTML 삽입, 광범위 삭제, UID 경계 이탈, prototype pollution/비정상 JSON, 과도한 메모리 사용을 확인한다.
- **Gate 5:** 테스트/빌드 모두 성공, reportable 보안 회귀 0, 불필요한 dependency·dead code 0.
- 실패 시 원인 파일만 수정하고 Phase 2~5의 관련 Gate를 다시 통과한다.

### Phase 6 — PR, 병합, 배포

- `drill`에 의도별 작은 커밋을 만들고 PR을 생성한다.
- GitHub Actions test/build가 모두 성공하고 최종 diff가 문서와 일치할 때만 `main`에 병합한다.
- `main` push가 시작한 Pages deploy 성공과 배포 SHA를 확인한다.
- **Gate 6:** main SHA = 병합 결과, Pages workflow 성공, 공개 `pkm.html`이 새 asset을 참조.
- 실패 시 main을 억지로 재병합하지 않고 drill에서 수정 → PR check → 재병합/재배포 Loop를 따른다.

### Phase 7 — 배포 QA와 정리

- desktop/mobile에서 검색, 범례, overlap, 색상, focus, viewport 유지, wheel/pinch, 대규모 fixture, 콘솔 오류를 확인한다.
- `main` 외 임시 브랜치를 확인하고 작업 브랜치를 삭제한다.
- **Gate 7:** 기능/시각/성능/접근성 QA 통과, 문서 최신화, 불필요 branch 0.
- 실패 시 결함을 drill에서 재현하고 Phase 3 또는 4로 돌아간다.

## 6. 검증 절차

### 단위/통합 테스트

1. 노드 geometry가 desktop/non-PC 실제 크기와 일치한다.
2. 레이아웃 뒤 모든 fixture node AABB 사이에 최소 padding이 존재한다.
3. 같은 입력의 위치가 deterministic하다.
4. legacy expected content와 완전히 일치한 파일만 tombstone 된다.
5. 사용자 편집·수동 파일·현재 파생 파일은 보존된다.
6. 현재 graph에는 index-backed category/subcategory/item만 표시되고 숨긴 파일의 간선도 남지 않는다.
7. 모든 node type 색이 서로 고유하고 exact hex 계약을 만족한다.
8. title/keyword 별도 field와 `4px` 차이 계약을 만족한다.
9. 핵심 내용 tooltip은 node에서 tooltip으로 pointer가 이동하는 동안 유지되고 tooltip click/tap/keyboard activation이 정확한 파일을 한 번만 연다.
10. summary가 없는 `path` node는 빈 tooltip을 만들지 않고 PC double-click/비PC double-tap으로 정확한 파일을 한 번만 연다.
11. summary가 있는 node도 tooltip action과 double-click/double-tap 양쪽을 지원하되 하나의 gesture에서 중복 open하지 않는다.
12. `path`가 없는 구조 node의 double-click/double-tap은 파일을 열지 않는다.
13. 검색·선택 상태 matrix의 모든 행이 opacity, border 폭·색, shadow offset/blur/color, overlay z-order 계약을 만족한다.
14. 검색 중 선택된 미일치 node의 선택을 해제하면 같은 rendering frame 또는 다음 animation frame 안에 overlay 아래·opacity 70%·shadow 없음으로 전환된다.
15. 기존 미일치 node 대신 다른 node를 선택하면 기존 node는 overlay 위·opacity 70%의 비선택 상태로 전환된다.
16. 검색 highlight 계산은 기존 direct/context/dimmed 집합을 유지하고, 검색어 변경 중 선택 node를 보존한다.
17. 파일 open은 focus를 요청하고 close/finish는 viewport 명령을 발생시키지 않는다.
18. viewport query는 overscan 내부 node/edge만 반환하고 선택/search target은 보존한다.

### 성능 테스트

- 소형, 10k, 50k, 100k node fixture에서 layout 시간, materialized element 수, peak memory proxy, pan/zoom frame drop과 long task를 기록한다.
- Gate 기준은 전체 데이터 수가 아니라 화면에 materialize된 수가 viewport 밀도에 비례하는지로 본다.
- 최악 입력에서 UI가 정지하면 edge density 제한, overscan, detail threshold를 순서대로 조정한다.

### 시각/접근성 QA

- 첨부 모바일 screenshot과 목표 관계도를 기준으로 node overlap, capsule, 색, label hierarchy, 범례 tooltip 세로 목록, 핵심 내용 tooltip의 pointer 이동과 파일 열기를 비교한다.
- 검색어 없음/직접 일치/1-hop/미일치와 선택 없음/선택 node/비선택 node 조합을 각각 screenshot 또는 computed style ledger로 검증한다.
- desktop, mobile portrait, mobile landscape에서 캔버스가 첫 화면의 주 작업 영역으로 유지되는지 확인한다.
- keyboard focus, Escape, coarse pointer hit area, 색상 외 node type text, reduced motion을 확인한다.

### 배포 검증

- PR 및 main workflow 결과와 배포 commit SHA를 확인한다.
- 인증이 필요한 실제 사용자 데이터 삭제는 자동화된 public QA로 실행하지 않는다.
- 배포 뒤 사용자가 로그인한 화면에서 삭제 후보 수/보존 후보 수를 먼저 보여주고, 실제 tombstone 적용 전 dry-run 결과를 확인할 수 있게 한다.

## 7. 유지보수 원칙

- 새 대형 프레임워크를 추가하지 않고 기존 Cytoscape + Worker 구조를 유지한다.
- 색, geometry, visibility, migration 판정은 중복 상수 대신 각 1개의 정책 source만 둔다.
- overview renderer와 detail renderer는 같은 graph model/position store를 읽고 데이터를 복제하지 않는다.
- 레거시 migration은 완료 marker 또는 idempotent 판정으로 반복 실행 비용과 위험을 막는다.
- 임시 feature flag, 사용되지 않는 fallback, 중복 event listener, debug logging, 배포 산출물을 소스에 남기지 않는다.

## 8. 현재 환경 제약과 승인 전 결정 항목

- 현재 연결된 GitHub 앱은 repository read/write, branch 생성, commit, PR, merge, workflow 조회를 지원한다.
- 현재 실행 환경에는 `git`, `gh`, `node`, `npm` 명령과 조작 가능한 브라우저가 없다. 따라서 구현 시 로컬 명령 대신 GitHub 연결 앱과 GitHub Actions를 주 검증 경로로 사용한다.
- 연결 앱에는 branch 삭제 기능이 노출되지 않았다. 병합 뒤 `drill` 삭제는 GitHub의 자동 source branch 삭제가 켜져 있지 않다면 사용자의 GitHub UI 작업이 필요할 수 있다.
- 확정 색상: `image = #FF9797`, `link-image = #FFA374`, `link-image-text = #DE6863`.
- 확정 전이: 검색 활성 상태의 선택된 미일치 node는 `overlay 위 + opacity 100% + node 색 3px border + node 색 3px/4px/5px shadow`; 선택 해제 시 `overlay 아래 + opacity 70% + 기본 border + shadow 없음`.
- 확정 fallback: tooltip이 없더라도 `path`가 있는 node는 PC double-click/비PC double-tap으로 연결 파일을 연다.
- 승인 필요: 안전 삭제는 dry-run 분류를 먼저 표시하고, 자동 생성과 byte 단위로 일치하는 레거시 파일 및 수정되지 않은 기본 시작 파일에만 제한한다는 정책.



## 10. 구현 및 검증 결과 (2026-08-02 KST)

- 도메인: 노드 색상·크기·검색/선택 시각 상태를 `graph-node-policy.js`로 단일화했다.
- 처리: Worker가 전체 위치를 계산하고 실제 최대 노드 크기와 30px 간격으로 최종 패킹해 AABB 겹침을 제거한다.
- 화면: 축소 개요에서는 간선·라벨을 생략하고 색상 캡슐만 표시하며, 확대 시 현재 viewport와 overscan 범위의 HTML 라벨만 생성한다.
- 핵심 규칙: 제목은 굵은 14px, 해시태그는 10px로 4px 차이를 보장한다. 비PC에서는 같은 4px 차이를 유지해 20px/16px를 사용한다.
- 저장·외부 서비스: 인덱스 밖 파일은 그래프에서 숨긴다. `mutationId === "link-memo-import"`이고 `Link Memo/**/*.md`인 구형 자동 생성 파일만 tombstone 처리하며, 나머지는 보존한다.
- 의존성·시작: `app-controller`가 migration, graph projection, viewport, workspace 이벤트를 조립한다. 파일 열기에서만 그래프를 이동·확대하고 닫기/편집 완료는 pan/zoom을 바꾸지 않는다.
- 상호작용: PC hover와 비PC 1회 탭으로 요약 tooltip을 열고, pointer grace 구간 동안 유지한다. tooltip click 및 모든 Markdown 노드의 double-click/double-tap은 동일한 `openPath` 계약을 사용한다.
- 범례: 검색 범례를 제거했고 그래프 도구의 노드 유형 버튼에서 세로 tooltip으로 제공한다.
- 색상: 이미지 `#FF9797`, 링크+이미지 `#FFA374`, 링크+이미지+텍스트 `#DE6863`을 포함해 전체 유형 색상을 고유하게 했다.
- 확대 속도: Cytoscape wheel sensitivity를 0.2에서 0.8로 변경했다.

### Gate 결과

- 단위·통합 테스트: 29개 파일, 101개 테스트 통과.
- 무겹침 검증: 실제 196×72 / 188×68 노드 400개 전체 쌍 검사에서 겹침 0건.
- 대규모 검증: 10,000개 노드 레이아웃 유한 좌표, 100,000개 상한 유지.
- 빌드: Vite production build 성공.
- 비밀정보 검사 기준: 새 문서·코드에 API key, token, UID, email, 운영 payload를 기록하지 않았다.
- GitHub Gate: Branch CI와 Test and Deploy GitHub Pages 성공(47개 테스트 파일, 189개 테스트).
- 배포 확인: `pkm.html` HTTP 200, 배포 자산에서 범례/dim layer, `wheelSensitivity: 0.8`, `openPath`, legacy cleanup 코드를 확인했다.
- 브랜치 정리: GitHub 앱에 ref 삭제 API가 없고 로컬 Git 자격증명이 없어 `drill` 삭제는 보류되었다. 코드·배포에는 영향이 없으며 GitHub UI에서 병합된 브랜치 삭제가 필요하다.

## 11. 후속 변경 계획: 방사형 레이아웃·검색 상태 재조정

### 11.1 문제별 수정 계획

1. 현재 최종 패킹이 정사각 격자라 계층 관계가 약하다. category → subcategory → item 부모 관계를 깊이로 계산하고, 깊이별 원형 ring에 배치하는 방사형 트리 레이아웃으로 변경한다. 각 ring은 실제 노드 최대 폭·높이와 간격을 반영해 AABB가 겹치지 않도록 반지름을 산출한다.
2. 라벨 HTML layer가 `pan/zoom` 이벤트만 듣고 노드 `position` 이벤트를 듣지 않아 드래그 직후 텍스트가 분리된다. `drag position`에서 같은 프레임에 라벨을 재배치하고, layout 결과·resize에도 동일한 sync 경로를 사용한다.
3. 검색어가 있을 때 명시적 clear 버튼을 상시 표시한다. native search cancel UI는 숨기고 값이 비어 있을 때만 버튼을 숨긴다.
4. 검색 상태를 다음 값으로 고정한다: 무검색 비선택 1.0, 무검색 선택 외 0.5, direct 1.0/0.7, context 0.7/0.5, non-match 0.5. 검색 dim layer는 기존 12%에서 24%로 조정한다.
5. 검색 전부터 선택된 non-match는 검색 중에도 위 레이어·100%·노드 색 3px border·노드 색 shadow를 유지하고, 선택 해제 즉시 non-match 0.5 아래 레이어로 복귀한다. direct/context 선택 노드는 노드 색 3px border와 opacity 80% shadow(5px/7px/7px)를 사용한다.

### 11.2 Process Phase와 Gate

- **Phase A — 도메인 규칙**: radial depth 계산 계약, 새 opacity/shadow 상태 테이블, 검색 clear 상태 테스트 작성. Gate: 순수 함수 테스트와 색상·geometry 불변식 통과.
- **Phase B — 처리/화면 연결**: worker ring 배치, drag position 라벨 sync, clear button DOM/event, dim layer 24% 적용. Gate: 기존 기능 테스트·무겹침·정적 UI 계약 통과.
- **Phase C — 검증/배포**: production build, GitHub Actions, 공개 Pages smoke check. Gate: CI 녹색·배포 자산 확인 후에만 main 병합.

### 11.3 실패 시 재수정 Loop

레이아웃 겹침 → ring 반지름/간격 재계산 → AABB 회귀 테스트. 라벨 분리 → position 이벤트·requestAnimationFrame 순서 확인 → 드래그 테스트. 검색 상태 불일치 → 순수 정책 매트릭스와 DOM opacity/border를 대조 → 실패 상태만 수정. CI 실패 → 로그의 단일 원인을 수정하고 동일 Gate를 재실행한다.

### 11.4 검증 절차

단위 테스트로 각 상태 조합과 ring 좌표를 검증하고, 정적 테스트로 clear button 상시 노출 계약·drag sync·24% dim layer를 확인한다. 브라우저 세션이 제공되면 desktop/mobile에서 검색 입력·clear·노드 드래그·선택/검색 순서를 수행한다. Browser 세션이 없으면 Vite build, Vitest, 공개 HTML/asset HTTP 검증을 수행하고 미검증 브라우저 항목을 보고한다.

### 11.5 구현 결과 및 Gate 판정

- Phase A/B Gate: 방사형 깊이·ring 좌표와 검색 시각 정책의 Vitest 계약을 통과했다. 노드 AABB 무겹침, 계층별 반지름 증가, 100k 노드 제한을 회귀 검증했다.
- Phase B Gate: 드래그·position 이벤트에서 Cytoscape 노드와 HTML 라벨을 함께 갱신하며, 검색 clear 버튼·24% dim layer·shadow 좌표를 정적 UI 계약으로 확인했다.
- Phase C Gate: Vitest 30개 파일 108개 테스트와 Vite production build가 성공했다. PR #45의 Branch CI와 Test and Deploy GitHub Pages가 모두 성공했다.
- 브라우저 세션은 현재 제공되지 않아 실제 포인터 조작은 자동화하지 못했다. 대신 공개 Pages HTTP 200 및 배포된 HTML/자산의 기능 토큰을 병합 후 재확인한다.

## 12. 후속 변경 계획: 네트워크 그래프·선택 효과·검색 dim 계층

### 12.1 문제별 수정 계획

1. 동심원 방사형 ring 배치를 일반적인 네트워크 그래프로 교체한다. 초기 좌표는 연결 성분·부모 관계를 고려한 deterministic seed로 만들고, 링크 힘·반발력·충돌 반경을 제한된 반복으로 계산한다. 최종 AABB 패킹으로 노드 겹침은 계속 방지한다.
2. 한 번 클릭/탭으로 선택된 노드는 Cytoscape `shadow-color`와 `shadow-opacity`를 이용한 색상 동일 box-shadow를 유지한다. 검색 중에도 선택 노드의 shadow와 z-index가 검색 dim layer보다 위에 남아야 한다.
3. 검색 중 dim layer는 그래프 전체 위에 놓되, 검색 직접 일치·1-hop 노드와 선택 노드는 dim layer보다 위에 올린다. 미일치 노드는 dim layer 아래에 두어 어둡게 보이게 하고, 일치 노드는 검색 전 배경색·opacity를 유지한다. dim layer 자체는 단일 오버레이로 중복 어둡게 하지 않는다.

### 12.2 Process Phase와 Gate

- **Phase A — 도메인/레이아웃**: 네트워크 force 계약, connected component seed, 충돌 반경, 선택 shadow·검색 layer 정책을 순수 함수 테스트로 고정한다. Gate: 유한 좌표·성분 분리·AABB 무겹침·상태 매트릭스 통과.
- **Phase B — 화면 연결**: worker 네트워크 배치, Cytoscape 선택 이벤트, dim layer z-index/layer 분리와 라벨 동기화를 반영한다. Gate: 정적 UI 계약과 기존 검색·더블클릭·파일 열기 회귀 통과.
- **Phase C — 검증/배포**: Vitest, Vite build, GitHub Actions, 공개 Pages HTML/asset smoke check를 수행한다. Gate: 모든 CI 성공 후에만 main 병합.

### 12.3 실패 시 재수정 Loop

네트워크 겹침 → 반발력/충돌 반경/최종 패킹 재조정 → 무겹침 회귀 테스트. 선택 shadow 누락 → select/tap 이벤트와 visual policy 입력을 대조 → 선택·검색 순서별 테스트. 일치 노드까지 어두워짐 → dim layer와 노드 layer/z-index를 분리 → opacity·stacking 정적 계약 재실행. CI 실패 시 실패 로그의 단일 원인만 수정하고 동일 Gate를 반복한다.

### 12.4 검증 절차

도메인 테스트로 연결 성분·force 좌표·선택 shadow·direct/context/non-match layer를 검증한다. 정적 테스트로 dim layer가 `z-index` 2, 일치 노드가 30, 미일치 노드가 1인지 확인한다. 브라우저 세션이 제공되면 desktop/mobile에서 노드 선택, 검색 입력, 일치/미일치 대비를 확인한다. 세션이 없으면 로컬 테스트·빌드 및 공개 번들의 상태 토큰을 검증하고 브라우저 미검증을 보고한다.

## 13. 후속 변경 계획: 캡슐 노드·충분한 충돌 여백·fileTree 타이포그래피

### 13.1 문제별 수정 계획

1. Cytoscape `round-rectangle`에 노드 높이의 절반인 `corner-radius`를 지정해 모든 노드를 캡슐 형태로 렌더링한다.
2. 네트워크 레이아웃의 충돌 분리 기준을 노드 반쪽 크기 + 64px로 높이고, 최종 분리 반복을 늘려 AABB 겹침과 과밀 배치를 방지한다.
3. `#fileTree` 내부 그룹/제한 안내 텍스트는 18px에서 16px로, 파일 행 텍스트는 20px에서 18px로 재정의한다. 모바일 미디어 쿼리보다 높은 선택자 우선순위를 사용해 모든 화면 크기에 동일하게 적용한다.

### 13.2 Process Phase와 Gate

- **Phase A — 렌더링/레이아웃**: corner-radius 데이터 계약, 64px 충돌 여백, fileTree 선택자 테스트 작성. Gate: 캡슐 스타일 토큰·AABB 무겹침·최소 분리 간격 통과.
- **Phase B — 회귀 검증**: 기존 검색/선택 shadow/dim layer와 파일 트리 상호작용을 유지한 상태에서 정적 UI 계약과 전체 테스트를 실행한다. Gate: 기존 기능 회귀 없음.
- **Phase C — 배포**: production build, GitHub Actions, 공개 Pages 자산 확인 후 main 병합한다.

### 13.3 실패 시 재수정 Loop

캡슐 모서리 미적용 → Cytoscape corner-radius 데이터 매핑 확인 → 스타일 회귀 테스트. 겹침 또는 여백 부족 → 충돌 반경·cell size·반복 수 조정 → 전체 쌍 AABB와 최소 분리 간격 재검증. fileTree만 글자가 커짐 → `#fileTree` 선택자 우선순위 확인 → desktop/mobile CSS 회귀 테스트.

### 13.4 검증 절차

노드 스타일에 `round-rectangle`와 `corner-radius`가 연결되는지 정적 테스트하고, worker 좌표에서 겹침 0건과 최소 64px 분리 간격을 계산한다. `#fileTree` 그룹 라벨·파일 행의 최종 font-size를 정적 CSS 계약으로 확인한다. 브라우저 세션이 없으면 원격 CI 및 공개 Pages 번들 smoke check를 수행하고 포인터 기반 시각 검증의 제한을 기록한다.

## 14. 후속 수정 계획: 밀집 네트워크의 최종 AABB 패킹 보강

### 14.1 문제별 수정 계획

1. force 계산 중 같은 영역에 몰린 노드가 반복형 충돌 보정 후에도 겹칠 수 있으므로, 레이아웃 마지막에 force 결과의 상대 순서를 보존하는 공간 버킷 기반 greedy 패킹을 추가한다.
2. 각 노드는 이미 배치된 이웃 후보와 실제 폭·높이 + 64px 여백을 비교하고, 충돌하면 오른쪽 빈 위치로 이동한 후 다시 검사한다. 배치 완료 시점에는 모든 앞선 노드와 AABB가 분리되도록 한다.

### 14.2 Process Phase와 Gate

- **Phase A — 충돌 규칙**: greedy 패커와 버킷 후보 탐색을 구현하고 밀집 fixture의 전체 쌍 겹침 0건·최소 64px 분리 간격을 검증한다.
- **Phase B — 회귀 검증**: 네트워크 링크 거리·캡슐 corner-radius·검색/선택 시각 정책을 유지한 채 대규모 레이아웃과 파일 트리 테스트를 실행한다.
- **Phase C — 배포**: CI와 Pages smoke check가 성공한 후에만 main 병합한다.

### 14.3 실패 시 재수정 Loop

밀집 영역 겹침 재현 → 패커 후보 버킷 범위와 오른쪽 이동 규칙을 조정 → 전체 쌍 AABB 회귀를 반복한다. 대규모 성능 저하 → 버킷 크기와 후보 탐색 범위를 측정 → 100k 상한 테스트를 다시 실행한다.
