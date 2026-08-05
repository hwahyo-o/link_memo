# PKM 그래프 계층 배치 재작업 계획 및 인계 문서

> 기준 시각: 2026-08-05 KST
> 작업 브랜치: `drill`
> 상태: category 소유 영역·계층별 방사 배치·간선 방향 분리 구현 및 drill CI 검증 완료; main 병합 전

## 1. 목적

기존의 변칙적인 네트워크 그래프 표현을 유지하면서 다음 배치 규칙을 보장한다.

- 버튼 노드는 자신이 속한 소분류 노드의 중심 영향 반경 안에 위치한다.
- 버튼 노드는 모든 소분류 노드 중 자신의 부모 소분류에 가장 가까워야 한다.
- 소분류 노드는 자신이 속한 대분류 노드의 중심 영향 반경 안에 위치한다.
- 소분류 노드는 모든 대분류 노드 중 자신의 부모 대분류에 가장 가까워야 한다.
- subcategory의 category 중심 거리는 기본 360px 이하로 제한한다.
- item의 subcategory 중심 거리는 기본 300px 이하로 제한한다.
- 같은 부모를 가진 계층 간선은 서로 다른 방사 방향을 사용한다.
- category·subcategory·item을 포함한 category 영역 그룹의 외곽 겹침 깊이는 50px 미만이다.
- 자식 노드는 부모 도형 내부에 들어가지 않는다.
- 노드 간 여백은 노드 도형의 외곽 geometry를 기준으로 계산한다.
- 대분류 중심점 간 거리는 최소 420px이다.
- 대분류 영향 반경의 겹침 깊이는 50px 미만이다.
- 모든 노드는 서로 겹치지 않고, 기본 외곽 여백 96px을 유지한다. 절대 하한은 42px이다.

## 2. 현재 구조와 변경 범위

### 화면

- `pkm.html`
- `styles/pkm.css`
- `src/presentation/pkm/graph-view.js`
- `src/presentation/pkm/workspace.js`
- `src/presentation/pkm/app-controller.js`

화면은 Worker가 반환한 좌표와 기존 Cytoscape geometry를 사용한다. 이번 변경에서는 화면, tooltip, 검색, 선택, 파일 열기 동작을 변경하지 않는다.

### 처리

- `src/application/pkm/graph-projector.js`
- `src/application/pkm/graph-worker.js`
- `src/application/pkm/metadata-cache.js`

projector가 제공하는 `categoryId`, `subcategoryId`, `kind`, `width`, `height`를 Worker의 계층 배치 입력으로 재사용한다. 기존 connected-component seed, force-directed network, golden-angle 후보 탐색, spatial bucket을 유지한다.

### 핵심 규칙

- `src/domain/pkm/graph-node-policy.js`
- `src/domain/pkm/graph-limits.js`
- `src/domain/pkm/graph-layout-policy.js`

새 정책 파일은 geometry와 배치 규칙을 한 곳에서 관리한다.

### 저장·외부 서비스

IndexedDB, Firestore, Firebase Auth, Google Drive Worker, Cloudflare Backup Worker는 변경하지 않는다. 그래프 좌표는 저장하지 않으며 현재 Vault와 graph index 흐름을 그대로 사용한다.

### 앱 시작

`src/bootstrap/pkm-main.js`의 기존 Worker 주입 구조를 재사용한다. 새 의존성이나 외부 라이브러리는 추가하지 않는다.

## 3. 정책 정의

### 노드 외곽 여백

노드의 실제 `width`와 `height`로 AABB를 계산한다.

두 노드가 분리되었다고 판단하려면 다음 중 하나가 참이어야 한다.

- 중심 x 거리 >= 두 노드 폭의 절반 합 + 여백
- 중심 y 거리 >= 두 노드 높이의 절반 합 + 여백

기본 여백은 기존 값인 96px이다. 42px은 요구사항의 절대 하한으로 정책에 기록하고 테스트한다.

### 부모 영향 반경

영향 반경은 부모 중심점에서 자식 중심점까지의 거리다. 도형 내부 포함을 의미하지 않는다.

반경은 다음을 반영해 동적으로 계산한다.

- 부모 도형의 실제 크기
- 직접 자식 도형 중 가장 큰 크기
- 직접 자식 개수
- 기본 외곽 여백
- 변칙 배치에 필요한 spread

후보 좌표는 부모 중심 반경 안에 있어야 하며, 부모와 자식의 AABB 외곽 여백도 동시에 통과해야 한다.

### 최단 부모

- item 후보는 모든 subcategory 중심과 비교해 자신의 부모 subcategory까지의 거리가 가장 짧을 때만 허용한다.
- subcategory 후보는 모든 category 중심과 비교해 자신의 부모 category까지의 거리가 가장 짧을 때만 허용한다.
- 관련 edge가 있는지 없는지와 무관하게 현재 배치 대상 그래프의 같은 계층 노드를 모두 비교한다.
- 동일 거리도 허용하지 않으며, 배치 후보를 다시 탐색하거나 반경 scale을 확장한다.

### 원형 계층 영역

- category 중심에서 subcategory를 제한된 환형 영역에 배치한다.
- 각 subcategory 중심에서 item을 제한된 환형 영역에 배치한다.
- 자식 수가 많아도 부모-자식 거리를 무한히 늘리지 않고 category 영역 외곽을 확장하거나 보조 환형을 사용한다.
- 부모별 자식은 deterministic angular slot과 작은 jitter를 사용해 변칙성을 유지한다.
- 같은 부모의 간선 방향은 최소 각도 차이를 확보하며, 일반 네트워크 간선의 교차는 네트워크 표현 특성상 별도 영역으로 취급한다.

### 대분류 분리

대분류 쌍마다 다음을 검사한다.

- 중심점 거리 >= 420px
- 두 영향 반경의 합과 중심점 거리로 계산한 겹침 깊이 < 50px

배치가 부족하면 golden-angle 후보를 계속 탐색하고 전체 영역을 확장한다.

## 4. 구현 내용

### 도메인 정책

`graph-layout-policy.js`에 다음을 분리했다.

- 배치 상수
- 노드 geometry 정규화
- 외곽 AABB 분리 판정
- 중심점 거리
- 부모 영향 반경 계산
- 대분류 반경 분리 판정
- 부모 거리 상한
- category 영역 외곽 반경
- 같은 부모 간선 방향 분리

### Worker

Worker 최종 패커는 다음 순서로 동작한다.

1. 명시적인 category/subcategory ID와 membership edge로 부모 관계를 구성한다.
2. 대분류 root를 먼저 배치한다.
3. category 영역 외곽 반경과 부모별 제한 환형을 계산한다.
4. category 중심을 먼저 배치하고 subcategory와 item을 부모별 angular slot 안에 배치한다.
5. 모든 후보에 부모 거리 상한, 부모 외곽 여백, 기존 노드 충돌, 같은 계층 최단 부모, 같은 부모 간선 방향 조건을 함께 적용한다.
6. 고아 root와 일반 고아 노드는 기존 변칙 위치를 최대한 유지하며 배치한다.
7. 후보가 부족하면 반경 scale을 단계적으로 확대한다.
8. 유한 좌표와 충돌 없는 좌표만 결과로 반환한다.

## 5. 테스트 계획 및 Gate

### 정책 테스트

- 최소 42px 및 기존 선호 96px 상수
- 실제 geometry 기준 AABB 간격
- 자식 수에 따른 영향 반경 증가
- 50px 이상 영향 반경 겹침 거부

### Worker 테스트

- 기존 10,000 노드 유한 좌표
- 기존 400개 실제 rectangle 무겹침
- 기존 네트워크 인접성 및 변칙성
- 100,000 노드 상한
- category → subcategory → item 관계의 부모 반경
- 대분류 중심 거리 420px 이상
- 모든 계층 노드 외곽 여백
- item → 자신의 subcategory 최단 부모
- subcategory → 자신의 category 최단 부모
- subcategory/item 부모 거리 상한
- 같은 부모 간선 방향 분리
- category 영역 그룹 외곽 겹침 깊이 50px 미만

### 통합 검증

- 전체 Vitest
- Worker 문법 검사
- Vite production build
- whitespace 오류 검사
- 문서와 변경 파일의 secret pattern 검사
- GitHub Actions 결과 확인
- 배포 후 공개 PKM 화면의 실제 asset 확인

## 6. 실패 시 재수정 Loop

1. 부모 반경 실패  
   → 반경 산정 또는 후보 반경을 조정하고 정책·Worker 테스트 재실행

2. 외곽 여백 실패  
   → AABB 후보 판정과 spatial bucket 범위를 확인하고 최종 패커만 수정

3. 대분류 분리 실패  
   → 영향 반경 scale과 category 후보 조건을 조정

4. 변칙성 저하  
   → force 기준 좌표, stable hash, golden-angle 후보 순서를 확인

5. 대규모 성능 실패  
   → 반복 횟수와 bucket 탐색 범위를 측정 후 최소 범위만 조정

6. 기존 기능 회귀  
   → 저장·화면 계층 변경 없이 그래프 정책과 Worker 변경만 재수정

## 7. 보안 및 문서 규칙

이 문서와 후속 문서에는 다음을 기록하지 않는다.

- API key
- OAuth client secret 또는 token
- Firebase, Cloudflare, Worker의 운영 식별자
- 사용자 UID, 이메일, 실제 메모 내용
- private endpoint와 credential

fixture는 가공된 구조와 일반 문자열만 사용한다.

## 8. 현재 검증 상태

원형 계층 영역, 부모 거리 상한, 부모별 angular slot, 같은 부모 간선 방향 분리 정책과 Worker 연결을 `drill`에서 반영하고 `main`에 병합했다.

완료된 Gate:

- category 영역 외곽 반경이 subcategory·item descendant geometry를 포함함
- subcategory 중심 거리 기본 상한 360px 적용
- item 중심 거리 기본 상한 300px 적용
- 같은 부모 간선에 deterministic radial slot과 최소 방향 차이 적용
- item·subcategory가 자기 부모에 가장 가까운 조건 유지
- 전체 노드 외곽 여백과 category 그룹 겹침 규칙 유지
- Branch CI test/build 성공
- PR test/build 성공
- main 병합 성공
- 캐시를 제외한 공개 PKM HTML, JavaScript asset, graph Worker asset HTTP 200 확인
- 새 Worker asset에서 거리 상한과 category/subcategory 계층 배치 코드 확인
- 변경 문서·fixture·소스에서 API key, token, 운영 식별자, 사용자 데이터 패턴을 확인하지 못함

미수행 또는 제한된 항목:

- 브라우저 직접 조작 도구가 없어 시각적 visual smoke test는 수행하지 못함
- 전용 보안 스캔 도구가 연결되지 않아 변경 파일 대상 정적 비밀값 점검만 수행함
- GitHub connector에 원격 branch ref 삭제 기능이 없어 병합된 `drill` 삭제는 수행하지 못함

## 9. 실패 시 재검증 순서

1. CI 실패 시 실패한 파일과 단계만 확인한다.
2. 부모 거리 상한 실패 시 `parentDistanceLimit`과 category group envelope를 확인한다.
3. 간선 방향 겹침 실패 시 부모별 angular slot, sibling peer 수집, 최소 각도 조건을 확인한다.
4. 부모 최단 조건 실패 시 `nearestParentSatisfied`와 배치 순서를 확인한다.
5. 외곽 여백 실패 시 AABB 후보 판정과 spatial bucket 범위를 확인한다.
6. category 그룹 겹침 실패 시 descendant geometry를 포함한 그룹 반경과 category 중심 배치를 확인한다.
7. build 또는 Pages 실패 시 새 Worker asset 생성과 main push deploy 상태를 분리해 확인한다.
8. 각 수정 뒤 동일한 테스트·build·asset Gate를 다시 통과시킨다.


## 10. 2026-08-05 추가 요구사항 반영

### 이미지에서 확인한 문제

첨부된 그래프처럼 category, subcategory, item이 서로 다른 category 영역에 섞이면 item과 subcategory의 부모를 사용자가 잘못 해석할 수 있다. 특히 item이 다른 subcategory 사이에 끼거나 같은 부모의 간선이 동일 방향으로 뻗으면 계층 구조가 무너져 보인다.

### 추가 정책

이번 구현은 기존 변칙 네트워크 그래프 시드를 유지하면서 다음 후보 검사를 추가한다.

- 모든 category descendant는 자신의 category가 소유한 외곽 반경 안에 있어야 한다.
- 후보 node의 geometry와 preferred gap을 포함한 뒤 다른 category region의 외곽 밖에 있어야 한다.
- 자신의 category까지의 거리가 다른 category까지의 거리보다 짧아야 한다.
- subcategory는 기존 category 부모 거리 상한 360px 안에서 배치한다.
- item은 기존 subcategory 부모 거리 상한 300px 안에서 배치한다.
- item 후보는 부모 subcategory에서 category 반대 방향으로 최소 outward projection을 확보한다.
- 같은 부모의 간선은 deterministic slot과 최소 각도 차이를 계속 사용한다.
- AABB 외곽 간격은 preferred 96px, 절대 최소 42px 정책을 계속 사용한다.
- category group 외곽 겹침 깊이는 50px 미만을 계속 사용한다.

### 변경 파일

- src/domain/pkm/graph-layout-policy.js
  - categoryRegionContains
  - categoryOwnershipSatisfied
  - hierarchyBandSatisfied
- src/application/pkm/graph-worker.js
  - category ancestor 추적
  - category region ownership 후보 검사
  - item outward fan 배치
- src/application/pkm/graph-worker.test.js
  - category region 계층화
  - item 부모 근접성
  - item outward band
  - 다른 category region 침범 방지

### 검증 기록

- PR #55 Branch CI 성공
- PR #55 Test and Deploy GitHub Pages 성공
- 변경 범위에는 저장, 인증, Firestore, Cloudflare Worker, 외부 API, 의존성 변경 없음
- 변경 파일에 API key, token, client secret, private key, 사용자 식별자 패턴 없음
- 브라우저 직접 시각 검증은 Browser 연결 도구 부재로 미수행이며, 배포 산출물 확인 단계에서 별도로 기록한다.

### 다음 Gate

1. PR diff와 CI 결과를 다시 확인한다.
2. PR을 main에 병합한다.
3. main Pages workflow 성공을 확인한다.
4. 공개 HTML과 최신 graph Worker asset HTTP 응답을 확인한다.
5. GitHub connector가 branch ref 삭제를 지원하지 않으면 drill 삭제 필요 상태를 명시한다.
