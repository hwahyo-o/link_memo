# PKM 그래프 계층 배치 재작업 계획 및 인계 문서

> 기준 시각: 2026-08-05 KST
> 작업 브랜치: `drill`
> 상태: 계층별 radial band 강화 및 배포 완료

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
- category group envelope 외곽 간격은 최소 42px이다.
- category group envelope는 실제 descendant 도형을 포함해 서로 겹치지 않는다.
- 모든 노드는 서로 겹치지 않고, 기본 외곽 여백은 42px이며, 노드 도형 내부 겹침을 허용하지 않는다.

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

기본 여백은 42px이며, 실제 노드 외곽 AABB 기준으로 테스트한다.

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

category group 쌍마다 실제 descendant 도형을 포함한 envelope를 검사한다.

- envelope 외곽 간격 >= 42px
- category·subcategory·item 내부 AABB 충돌 없음

배치가 부족하면 deterministic golden-angle 후보를 계속 탐색하고 group envelope를 확장한다.

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

- 최소 외곽 간격 42px 상수
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

원형 계층 영역, 부모 거리 상한, 부모별 angular slot, 실제 category envelope compact packing, 전체 노드 무겹침 검증을 `drill`에 반영했다.

완료된 Gate:

- category 영역 외곽 반경이 subcategory·item descendant geometry를 포함함
- subcategory 중심 거리 기본 상한 360px 적용
- item 중심 거리 기본 상한 300px 적용
- 같은 부모 간선에 deterministic radial slot과 최소 방향 차이 적용
- item·subcategory가 자기 부모에 가장 가까운 조건 유지
- 전체 노드 외곽 여백과 category 그룹 겹침 규칙 유지
- Branch CI test/build 성공
- PR test/build 성공
- Branch CI #454와 Pages test/build #295 성공
- PR #63 main 병합 완료
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
- AABB 외곽 간격은 42px 하드 최소 정책을 사용한다.
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


## 12. 2026-08-06 PR #61 완료 기록

- PR #59의 descendant envelope compact packing과 orphan 중앙 재배치를 제거했다.
- PR #55의 변칙 네트워크 배치, deterministic seed, golden-angle 후보, spatial bucket, 부모·간선 규칙을 복원했다.
- 일반 노드 외곽 AABB 간격은 42px 하드 최소값으로 적용했다.
- Branch CI run 433과 434, Pages test/build run 286과 287, main Pages run 288이 성공했다.
- main 병합 커밋은 `212b11a`이며 공개 root와 `pkm.html`은 HTTP 200으로 확인했다.
- 화면 screenshot은 생성하지 않았고, 실제 화면 확인은 사용자에게 위임했다.
- 저장·인증·Firestore·Cloudflare·Drive·외부 API·의존성은 변경하지 않았다.
- 최종 원격 브랜치는 `main`만 유지한다.


## 13. 2026-08-06 이미지 기반 재수정 계획

### 확인된 문제

첨부 화면에서 category 노드가 실제 descendant 그룹보다 과도하게 멀리 분산되고, 다량의 item 노드가 같은 영역에서 서로 겹쳐 보인다. 이는 다음 두 조건을 동시에 만족하지 못한 상태다.

- category, subcategory, item을 구분하지 않는 전역 도형 충돌 보장
- 실제 descendant geometry를 사용한 조밀한 category group 배치

현재 Worker는 자식 수가 많은 경우 부모 반경 안에서 후보를 모두 찾지 못해 부분 배치 좌표를 남길 수 있다. 또한 category 중심 거리와 큰 원형 영향 반경을 함께 강제해 category를 필요 이상으로 멀리 밀어낼 수 있다.

### 수정 정책

- 모든 category, subcategory, item 쌍을 실제 width·height의 AABB와 42px 외곽 여백으로 검사한다.
- 배치 후보를 모두 소진하면 초기 겹친 좌표를 반환하지 않고 sibling ring을 확장해 재배치한다.
- 많은 item은 단일 원형이 아니라 deterministic multi-ring으로 배치한다.
- category group은 category·subcategory·item descendant의 실제 AABB envelope를 계산해 envelope 외곽 간 최소 42px으로 compact packing한다.
- 기존 420px category 중심 거리 하드 제약은 제거하고, 실제 group envelope 분리를 하드 제약으로 사용한다.
- force-directed seed, connected-component 구조, golden-angle 후보, stable hash, 부모 근접성, angular slot은 유지한다.
- 화면·저장·인증·동기화·외부 서비스·의존성 계층은 변경하지 않는다.

### Phase Gate

1. domain 정책에 envelope와 ring 반경 계산을 추가하고 단위 테스트를 통과한다.
2. Worker가 모든 노드 종류를 전역 충돌 버킷에서 검사하고 최종 충돌 검증을 통과한다.
3. 다량 item fixture와 여러 category fixture에서 모든 AABB 간격이 42px 이상이다.
4. category group envelope가 서로 겹치지 않으며 필요 이상으로 넓게 분산되지 않는다.
5. 전체 test, build, diff check, secret pattern 점검과 Pages 배포가 성공한다.

### 실패 Loop

- 충돌 실패: geometry·bucket·candidate 범위를 확인하고 전역 재배치만 수정한다.
- 다량 item 실패: sibling ring 반경과 ring count를 확장하고 부모 거리 규칙을 재검증한다.
- category 분산 실패: envelope 배치 순서와 외곽 간격을 조정한다.
- 변칙성 저하: force seed와 golden-angle 후보 순서를 확인한다.
- 회귀: 그래프 정책·Worker·테스트 외 계층을 변경하지 않았는지 확인한다.



## 14. 2026-08-06 PR #63 완료 기록

- PR #63은 main에 병합되었다.
- 기능 병합 커밋은 `1130f54`이다.
- Branch CI #454와 Pages test/build #295가 성공했다.
- 이전 오류 Loop에서 orphan bucket 연결 오류와 부동소수점 테스트 오차를 수정했고, 최종 Branch CI #458과 Pages test/build #297도 성공했다.
- category group은 실제 descendant envelope 기반으로 compact 배치한다.
- category·subcategory·item 전체는 실제 AABB 기준 최소 42px 외곽 간격을 사용한다.
- 다량 item은 deterministic multi-ring과 최종 전역 충돌 검증을 사용한다.
- 화면 screenshot은 생성하지 않았다.
- 저장·인증·동기화·외부 서비스·의존성은 변경하지 않았다.
- main Pages workflow #300 및 deploy job 성공, 공개 asset HTTP 200을 확인했다.


## 15. 2026-08-06 최종 배포 기록

- 문서 후속 PR #64 병합 커밋: `93b656d`
- main Pages workflow #300: 성공
- main Pages deploy job: 성공
- 공개 root `https://hwahyo-o.github.io/link_memo/`: HTTP 200
- 공개 `https://hwahyo-o.github.io/link_memo/pkm.html`: HTTP 200
- PKM JavaScript·CSS·favicon asset: HTTP 200
- 실제 브라우저 화면 screenshot은 생성하지 않았으며 화면 확인은 사용자에게 위임한다.
- 기능 변경 대상은 그래프 정책·Worker·관련 테스트뿐이며 저장·인증·동기화·외부 서비스·의존성은 변경하지 않았다.

## 16. 2026-08-06 캔버스 중심 계층 재배치 계획

### 목적

현재 구조를 유지하면서 그래프 좌표의 중심을 기준으로 계층 순서를 명확히 한다.
- category는 캔버스 중심에 가장 가깝게 배치
- subcategory는 category 다음 radial band
- item은 subcategory 다음 radial band
- subcategory는 모든 category 중 부모 category에 가장 가까움
- item은 모든 subcategory 중 부모 subcategory에 가장 가까움
- 기존 변칙 네트워크, 42px AABB, 실제 envelope compact packing, 전역 무겹침 유지

### 구현 범위

- graph-worker.js category 중심 우선 후보 순서
- subcategory/item radial band 후보 조건
- 모든 동급 부모 후보 대상 부모 최단 거리 검증
- 최종 radial hierarchy 검증과 AABB 검증 결합
- 화면·저장·인증·외부 서비스·의존성 변경 없음

### Process Phase

1. 문서를 먼저 갱신하고 drill에서 계획·Gate를 고정한다.
2. Worker의 category 중심 우선, 계층 radial band, 전체 부모 후보 최단 검사를 최소 diff로 구현한다.
3. 기존 무겹침·변칙성·대규모 테스트에 radial hierarchy fixture와 검증을 추가한다.
4. CI와 production build를 통과시킨 뒤 draft PR에서 diff와 결과를 재검토한다.
5. PR을 main에 병합하고 Pages 배포와 공개 asset 응답을 확인한다.
6. 사용자 화면 확인은 사용자가 직접 수행하며 screenshot은 만들지 않는다.

### Gate

1. category 중심 반경 < subcategory 최소 반경
2. subcategory 최대 반경 < item 최소 반경
3. 모든 subcategory가 부모 category를 가장 가까운 category로 가짐
4. 모든 item이 부모 subcategory를 가장 가까운 subcategory로 가짐
5. 모든 노드가 실제 도형 기준 최소 42px 간격
6. force seed/golden-angle/stable hash/대규모 테스트 유지
7. 변경 범위가 graph policy, graph Worker, 관련 테스트, 인계 문서로 제한됨

### 실패 시 재수정 Loop

- radial band 실패: 중심 산정과 도형 외곽 여유를 확인하고 후보 floor만 조정한다.
- 부모 최단 실패: 모든 같은 종류의 배치 완료 부모를 비교하는 조건과 부모별 배치 순서를 확인한다.
- 무겹침 실패: AABB geometry와 spatial bucket을 확인하고 radial 조건과 함께 재검증한다.
- category 분산 또는 변칙성 저하: 기존 force seed, stable hash, golden-angle 순서를 확인한다.
- CI/build 실패: 실패한 테스트와 변경 계층만 재수정한 후 동일 Gate를 반복한다.

## 17. 2026-08-06 캔버스 중심 계층 재배치 검증 기록

- PR #67에서 category를 중심 주변 deterministic ring에 먼저 배치했다.
- subcategory는 모든 category보다 큰 radial band에서, item은 모든 subcategory보다 큰 radial band에서 후보를 허용한다.
- subcategory와 item은 배치가 끝난 모든 동일 종류 부모를 비교해 지정 부모가 엄격히 가장 가깝도록 검사한다.
- 기존 실제 AABB 기준 42px 외곽 간격, 전역 무겹침 검증, force seed, golden-angle, stable hash, 부모 방향 규칙을 유지한다.
- 첫 Branch CI #476은 기존 부모 거리 상한 회귀로 실패했고, category ring과 radial floor 계산을 수정했다.
- 두 번째 Branch CI #480은 category envelope 분리 회귀로 실패했고, descendant envelope를 수용할 compact category ring 여유를 보정했다.
- 최종 Branch CI #482와 Pages test/build #308은 성공했다.
- 변경 파일은 이 문서들, graph-worker.js, graph-worker.test.js로 제한했다.
- 화면·저장·인증·동기화·외부 서비스·의존성은 변경하지 않았다.
- API key, token, secret, 운영 식별자, 사용자 데이터는 문서와 fixture에 기록하지 않았다.
- screenshot은 생성하지 않았으며 실제 화면 확인은 사용자에게 위임한다.
- 현재 상태: PR #67 main 병합 대기.

## 18. 2026-08-06 최종 병합·배포 기록

- PR #67은 `main`에 병합되었다.
- 최종 main 병합 커밋: `17d3b0f48d8fae0c09f1c56d4914274d9883622d`.
- PR Branch CI #482와 Pages test/build #308이 성공했다.
- 공개 root와 PKM 페이지는 HTTP 200으로 확인했다.
- 배포된 PKM JavaScript asset도 HTTP 200으로 확인했으며 화면 screenshot은 생성하지 않았다.
- 변경 대상은 graph-worker.js, graph-worker.test.js, 계획·인계 문서이며 저장·인증·동기화·외부 서비스·의존성은 변경하지 않았다.
- 최종 원격 branch는 `main`만 유지한다.
- 실제 화면의 시각적 확인은 사용자에게 위임한다.

## 19. 2026-08-06 전역 중심 계층 재배치 계획

### 요청 규칙

- category 노드는 캔버스 중심에 가장 가까운 radial band에 배치한다.
- subcategory 노드는 모든 category보다 캔버스 중심에서 멀리 배치한다.
- 각 subcategory는 모든 category 중 자신의 부모 category가 가장 가까워야 한다.
- item 노드는 모든 category·subcategory보다 캔버스 중심에서 멀리 배치한다.
- 각 item은 모든 subcategory 중 자신의 부모 subcategory가 가장 가까워야 한다.
- 모든 노드는 실제 도형 AABB 기준 최소 42px 외곽 간격을 유지한다.

### Process Phase

1. 현재 main에서 drill을 만들고 이 계획을 먼저 기록한다.
2. Worker의 layout center와 화면 fit center를 일치시키는 좌표 계약을 확인한다.
3. category를 먼저 배치하고 category radial band를 고정한다.
4. subcategory를 category band 밖에서 배치하고 모든 category 부모 후보와 최단 조건을 검사한다.
5. item을 subcategory band 밖에서 배치하고 모든 subcategory 부모 후보와 최단 조건을 검사한다.
6. category envelope compact packing 이후에도 전역 radial 순서와 AABB 무겹침을 재검증한다.
7. 실패한 조건만 최소 수정하고 동일 Gate를 반복한다.

### Phase Gate

- Gate A: 변경 전 main·drill ref와 변경 파일 범위를 확인한다.
- Gate B: 문서에 API key, token, 운영 식별자, 사용자 데이터가 없다.
- Gate C: category radius < subcategory radius < item radius를 모든 계층 노드에 대해 통과한다.
- Gate D: subcategory와 item의 부모가 각각 모든 동일 계층 후보 중 엄격히 최단이다.
- Gate E: 모든 노드가 AABB 기준 42px 이상 떨어지고 기존 force·golden-angle·stable hash가 유지된다.
- Gate F: 전체 test, production build, CI, Pages 배포, 공개 asset 응답이 성공한다.
- Gate G: main 병합 후 원격 branch는 main만 남는다.

### 실패 시 재수정 Loop

- 중심 순서 실패: Worker center와 화면 fit center의 좌표 계약 및 최종 recenter 순서를 확인한다.
- 부모 최단 실패: 모든 배치 완료 부모 후보 수집과 strict distance 비교를 확인한다.
- 무겹침 실패: 실제 node geometry, spatial bucket, candidate ring을 확인한다.
- category 분산 실패: envelope 이동을 취소하거나 category ring 반경만 최소 조정한다.
- 변칙성·성능 회귀: force seed, golden-angle, stable hash, 대규모 반복 상한을 확인한다.
- CI/build 실패: 실패 로그에 해당하는 계층만 수정하고 동일 Gate를 다시 수행한다.

### 변경 제한

- 화면, 저장, 인증, Firestore, 외부 서비스, 의존성, 앱 시작 계층은 변경하지 않는다.
- screenshot은 생성하지 않는다.
- 완료 후 이 문서에 실제 commit, CI, Pages, HTTP, branch 정리 결과를 기록한다.

## 20. 2026-08-06 전역 중심 계층 재배치 검증 기록

- PR #69에서 최종 도형 bounds center를 원점으로 정규화해 Cytoscape fit 중심과 layout center를 일치시켰다.
- category보다 subcategory가 중심에 가까워지지 않도록 전역 radial floor를 검사한다.
- category·subcategory보다 item이 중심에 가까워지지 않도록 전역 radial floor를 검사한다.
- subcategory와 item은 모든 동일 종류 부모 후보와 strict nearest-parent 조건을 통과해야 한다.
- 부모가 없는 subcategory/item도 해당 계층 band 바깥의 deterministic 후보로 배치한다.
- 첫 Branch CI #496은 기존 orphan item 500px 분리 회귀로 실패했고, orphan item 외곽 floor를 보정했다.
- 최종 Branch CI #498과 Pages test/build #315는 성공했다.
- 변경 범위는 이 문서들, graph-worker.js, graph-worker.test.js로 제한했다.
- 화면·저장·인증·동기화·외부 서비스·의존성은 변경하지 않았다.
- screenshot은 생성하지 않았다.
- 현재 상태: PR #69 main 병합 대기.

## 21. 2026-08-06 최종 완료 기록

- PR #69가 main에 병합되었다.
- 최종 main commit: `b32289e6c3a2ef7fb93dcf136dd7ac3b6c53d333`.
- Branch CI #498, #502와 Pages test/build #315, #317이 성공했다.
- 공개 root `https://hwahyo-o.github.io/link_memo/`: HTTP 200.
- 공개 PKM 페이지 `https://hwahyo-o.github.io/link_memo/pkm.html`: HTTP 200.
- 실제 화면 screenshot은 생성하지 않았다.
- 최종 원격 branch는 `main`만 유지한다.
- 변경하지 않은 계층: 화면 구조 외 저장·인증·동기화·외부 서비스·의존성·앱 시작.

## 22. 2026-08-06 계층별 radial band 강화 계획

### 추가 요청 규칙

- category는 캔버스 중심에 가장 가까운 조밀한 중심 band를 유지한다.
- subcategory는 모든 category보다 중심에서 멀리 있어야 하며, 부모 category가 모든 category 중 가장 가까워야 한다.
- item은 모든 category·subcategory보다 중심에서 멀리 있어야 하며, 부모 subcategory가 모든 subcategory 중 가장 가까워야 한다.
- item band는 subcategory band보다 추가 radial 여유를 둔 외곽 band로 배치한다.
- item은 부모별 deterministic outward multi-ring으로 분산해 한 지점에 과도하게 밀집하지 않는다.
- category·subcategory·item 전체는 실제 도형 AABB 기준 최소 42px 간격을 유지한다.

### 전역 Gate

- category 최대 반경 < subcategory 최소 반경
- subcategory 최대 반경 + radial 여유 < item 최소 반경
- category 반경 분산을 필요한 envelope 범위 안에서 최소화한다.
- 각 subcategory의 부모 category가 모든 category 중 strict nearest이다.
- 각 item의 부모 subcategory가 모든 subcategory 중 strict nearest이다.
- 실제 fit bounds center를 layout center로 사용한다.

### Process Phase

1. drill을 main에서 생성하고 이 규칙을 문서에 먼저 고정한다.
2. 현재 category ring과 subcategory band를 보존하면서 item 전역 외곽 floor를 계산한다.
3. item 부모별 outward multi-ring 후보에 전역 item floor, 부모 최단, AABB, 간선 방향 조건을 함께 적용한다.
4. category compact packing 후 category 밀집도와 전체 radial band를 다시 검증한다.
5. 실패 시 radial floor·ring 반경·category ring만 최소 수정한다.
6. 테스트·build·CI·Pages·공개 응답을 확인하고 main에 병합한다.

### 실패 시 재수정 Loop

- item이 안쪽이면 subcategory 최대 반경 산정과 item floor를 확인한다.
- item이 부모에서 과도하게 멀면 outward ring 수와 부모 후보 각도만 조정한다.
- category가 흩어지면 envelope compact packing과 category ring 반경을 확인한다.
- 부모 최단 실패면 모든 동일 계층 부모 후보 수집을 확인한다.
- 무겹침 실패면 실제 geometry AABB와 spatial bucket을 확인한다.
- 기존 네트워크성이 저하되면 force seed, golden-angle, stable hash를 복원한다.

### 변경 제한

- 화면 구조, 저장, 인증, 동기화, 외부 서비스, 의존성, 앱 시작 계층은 변경하지 않는다.
- screenshot은 생성하지 않는다.
- 완료 결과와 검증 수치는 이 문서에 기록한다.

## 23. 2026-08-06 radial band 강화 검증 기록

- PR #71에서 category·subcategory·item radial band 사이에 최소 42px 여유를 추가했다.
- subcategory는 category 최대 반경보다 42px 이상 바깥에서만 허용한다.
- item은 subcategory 최대 반경보다 42px 이상 바깥에서만 허용한다.
- parentless subcategory/item도 해당 band 바깥으로 배치한다.
- 기존 category envelope compact packing, 실제 AABB 42px 무겹침, strict nearest-parent, deterministic multi-ring을 유지했다.
- Branch CI #514와 Pages test/build #321이 성공했다.
- 변경 범위는 문서, graph-layout-policy.js, graph-worker.js, 관련 테스트로 제한했다.
- 저장·인증·동기화·외부 서비스·의존성·앱 시작 계층은 변경하지 않았다.
- screenshot은 생성하지 않았다.
- 현재 상태: PR #71 main 병합 대기.

## 24. 2026-08-06 최종 radial band 강화 완료 기록

- PR #71이 main에 병합되었다.
- 기능 병합 commit: `f4630779da64ca7f9858dcb7b52316c248c18f33`.
- Branch CI #514·#518, Pages test/build #321·#323이 성공했다.
- category 최대 반경과 subcategory 최소 반경 사이에 최소 42px radial gap을 적용했다.
- subcategory 최대 반경과 item 최소 반경 사이에 최소 42px radial gap을 적용했다.
- item은 부모별 outward multi-ring과 strict nearest-parent 조건을 유지한다.
- 공개 화면 확인은 사용자가 수행하며 screenshot은 생성하지 않는다.
- 최종 원격 branch는 main만 유지한다.


## 26. 2026-08-06 item-only post-compaction reflow 최종 기록

- 첨부 이미지의 재현 문제를 기준으로 category·subcategory 좌표는 유지하고 연결된 item 좌표만 최종 재탐색하는 `reflowItemsOutward`를 `graph-worker.js`에 반영했다.
- 재탐색은 subcategory band 바깥 radial floor, 부모 도형 외곽, 부모 nearest, 부모 기준 outward 방향, sibling edge angle, AABB 42px 검사를 모두 통과한 후보만 사용한다.
- 다수 sibling item은 고정 fan 폭으로 실패하지 않도록 sibling 수와 최소 edge angle에 맞춰 fan 폭을 deterministic하게 확장한다.
- 최종 canvas-center 정규화 후 radial 검증이 실패하면 item-only 재배치와 정규화를 최대 4회 반복하고, 기존 전역 fallback은 보존한다.
- 변경 범위는 graph worker와 기존 worker 테스트이며 화면, 처리 외 계층의 저장·외부 서비스·의존성 연결은 변경하지 않았다.
- 검증: Branch CI #552 성공, Pages test/build #338 성공. screenshot은 생성하지 않았다.
- 상태: PR #73 main 병합 완료; main push 배포 트리거 전파 확인 필요.


## 27. 2026-08-06 최종 병합 기록

- PR #73은 main에 병합되었고 merge commit은 `dfd0e40bd93e578568b6c93506a1c3b844a72a8e`이다.
- 병합 직전 검증: Branch CI #552 성공, Pages test/build #338 성공.
- main push 기반 Pages 배포 workflow가 구성되어 있으며 병합으로 배포 트리거가 발생한다.
- 이 turn에서는 사용자가 화면을 직접 확인한다고 했으므로 screenshot과 브라우저 화면 검증은 수행하지 않았다.
- 원격 불필요 branch 정리 결과: `main`만 유지.
- 상태: main 병합 완료, 배포 workflow 트리거 확인 대기.


## 28. 2026-08-06 모든 item 유형 공통 외곽 재배치 계획

### 문제 정의

첨부 이미지에서 색상과 콘텐츠 유형이 서로 다른 item 노드들이 모두 하나의 item 계층임에도 캔버스 중심부에 섞여 있다. 따라서 색상, `contentKind`, facet, 연결 종류를 배치 기준으로 사용하지 않고 `kind === "item"` 전체를 동일한 계층으로 취급한다.

### 구현 범위

- category 좌표를 먼저 확정한다.
- subcategory 좌표를 category보다 중심에서 멀고 자신의 category에 가장 가까운 위치에 확정한다.
- 모든 item 좌표를 그 이후 계산하며, item의 부모 subcategory 좌표는 이동시키지 않는다.
- item은 실제 최종 node bounds center 기준으로 subcategory band보다 바깥에 배치한다.
- 모든 후보는 부모 도형 외곽, 부모 nearest, outward 방향, sibling fan, AABB 최소 42px을 만족해야 한다.
- 저장, 외부 서비스, 의존성, 앱 시작 계층은 변경하지 않는다.

### Phase Gate

1. 메타데이터 Gate: 모든 item 유형이 `kind === "item"`과 부모 ID를 통해 분류된다.
2. 계층 Gate: category < subcategory < item의 radial band가 전 item에 대해 성립한다.
3. 관계 Gate: item이 다른 subcategory보다 자신의 부모 subcategory에 가깝다.
4. 도형 Gate: 모든 노드 도형 사이 AABB 최소 42px 간격을 통과한다.
5. 회귀 Gate: 혼합 유형·대량 item·고아 item·기존 네트워크 테스트가 통과한다.
6. 배포 Gate: Branch CI, Pages test/build 성공 후 main 병합과 branch 정리를 수행한다.

### 실패 수정 Loop

후보 부족 시 item ring 반경과 sibling fan만 deterministic하게 확장한다. 부모 좌표를 이동시키거나 색상별 예외를 추가하지 않는다. Gate 실패가 반복되면 실패한 fixture와 수치를 문서화하고 해당 배치 단계만 수정한 뒤 전체 검증을 재실행한다.


## 29. 2026-08-06 구현 및 검증 결과

- 구현 기준: main의 기존 hierarchy/force/AABB packing을 유지하고, `reflowItemsOutward`의 대상만 `nodes.filter(node => node.kind === "item")`로 확장했다.
- `contentKind`, 색상, facet, 연결 유형은 배치 분기 조건으로 사용하지 않는다.
- 부모 subcategory가 확인되는 item은 기존 parent-nearest/outward/sibling fan/AABB 후보 탐색을 사용한다.
- 부모가 없거나 계층 배치 대상에서 누락된 item은 canvas 외곽 ring 후보로 재시도한다.
- item 수가 많은 경우에만 bounded dense retry와 최종 outer-band convergence를 수행한다. category/subcategory 좌표 및 저장·외부 서비스 계층은 변경하지 않았다.
- AABB 검증의 기본 최소 여백은 `GRAPH_LAYOUT_RULES.minimumRadialBandGap = 42`와 기존 `preferredNodeGap = 42`를 따른다.

### 실제 Gate 결과

- 혼합 fixture: link/image/text/file `contentKind` 4종, item 24개 통과.
- 전체 Vitest: 206 tests passed.
- Branch CI run 612: success.
- GitHub Pages test/build run 367: success.
- secret scan: 변경 diff에 API key, token, private ID, credential 기록 없음.
- screenshot 및 브라우저 화면 캡처: 생성하지 않음. 화면 확인은 사용자 수행 범위로 남겼다.

### 인수인계 상태

- 구현 커밋 head: `f7c54ad9e45e2d453c5280e7651dc7be50eb7be4`
- PR: #75, base `main`, merge 전 검토 상태.
- 다음 단계: PR #75 merge → main push 배포 workflow 확인 → 원격 branch를 main만 남기도록 정리.


## 30. 2026-08-06 main 병합·배포 인수인계

- PR #75 squash merge 완료.
- main merge commit: bec98f1bbecb2e665b973038680006012c53e7a2.
- .github/workflows/deploy.yml의 push 대상이 main이고, test/build 성공 후 Pages deploy job이 실행되는 구조임을 확인했다.
- PR 기준 Pages test/build run 367과 Branch CI run 612는 성공했다.
- main push 배포 run의 상세 상태와 실제 서비스 화면은 연결 도구에서 제공되지 않아, live URL 도착 및 브라우저 화면은 검증 완료로 주장하지 않는다. 사용자가 화면을 직접 확인한다.
- 다음 문서 커밋(PR #76) merge 후 원격 drill 삭제를 완료해 main만 유지한다.


## 31. 2026-08-06 item 중심 잔류 재수정 계획

### 추가 문제

실제 그래프에서 다양한 contentKind의 item이 category/subcategory보다 캔버스 중심에 가까운 위치에 남는 사례가 재확인되었다. 기존 dense retry가 실패한 뒤 global repack으로 되돌아가면서 item outer-band 보장이 사라질 수 있다.

### 수정 원칙

- 모든 kind item을 색상·contentKind와 무관하게 단일 outer-band 대상으로 유지한다.
- category와 subcategory의 확정 좌표를 item 재배치 중 이동시키지 않는다.
- item 후보가 부족하면 global center repack을 사용하지 않고 item ring/fan만 확장한다.
- 최종 bounds center를 다시 계산한 뒤 모든 item의 최소 반경을 재검증한다.
- 실패 시 bounded retry를 반복하고, 검증되지 않은 좌표를 성공 결과로 반환하지 않는다.

### Gate 및 Loop

- Gate A: category max radius + 42px < subcategory min radius.
- Gate B: subcategory max radius + 42px < every item radius.
- Gate C: 각 item이 모든 subcategory 중 자신의 부모와 가장 가깝다.
- Gate D: 모든 node AABB가 42px 여백으로 분리된다.
- Gate 실패 시 item-only ring 확장 → bounds center 재계산 → 전체 검증 순서로 반복한다.
- 기존 네트워크·저장·외부 서비스·앱 시작 계층은 수정하지 않는다.


## 32. 2026-08-06 구현 및 검증 결과

### 구현

- `kind: "item"` 전체를 contentKind, 색상, 계층 메타데이터 유무와 관계없이 item 재배치 대상으로 통합했다.
- bounds center 재정렬 후 dense item의 radial floor를 현재 subcategory 좌표에서 다시 계산하도록 했다.
- item이 8개 이하이면 기존 부모 중심 fan 배치를 유지하고, 8개를 초과하면 category/subcategory band를 먼저 복구한 뒤 item을 12-slot 대칭 outer ring으로 배치한다.
- item이 포함된 레이아웃에는 무제약 `repackGlobally()`를 fallback으로 사용하지 않는다.
- 노드 AABB 충돌 검사와 기존 부모 외곽·nearest-parent 검사를 유지한다.

### 검증

- Branch CI run 651: success.
- Pages test/build run 385: success. PR 환경이므로 deploy job은 실행 대상이 아니며, live URL 및 브라우저 화면은 별도 확인 대상이다.
- 전체 테스트: 48개 파일, 207개 테스트 통과.
- 회귀 fixture: link/image/text/file contentKind와 부모 연결이 없는 item을 함께 포함하고, category < subcategory < every item 및 모든 노드 AABB 42px 분리를 확인한다.
- 임시 계측 코드와 화면 캡처는 저장소에 포함하지 않았다.

### 전달 상태

- 구현 PR: #77. 검증 성공 후 main 병합 및 Pages 배포 트리거를 진행한다.
- 공개 문서에는 API key, token, 내부 ID, 인증 정보 및 배포 비밀값을 기록하지 않는다.


## 33. 2026-08-06 최종 전달 상태

- PR #77은 main에 squash merge 완료되었고, merge commit은 `beff48247f2b897010cb1f6768b96043e1b19e84`이다.
- 원격 브랜치는 main만 남겼다. 작업용 drill 브랜치는 최종 문서 정정 후 다시 삭제한다.
- main push 기반 Pages 배포 workflow가 배포 조건을 충족하도록 반영되었다. 연결 도구에서는 main push 배포 run 상세와 live URL 화면을 제공하지 않으므로, 실제 화면 도착은 사용자가 직접 확인한다.
- 브라우저 스크린샷과 비밀정보는 생성·기록하지 않았다.
