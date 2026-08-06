# PR #59 to #55 rollback and 42px network graph handoff

> 기준 시각: 2026-08-06 KST
> 작업 브랜치: `drill`
> 상태: PR #63 main 병합 완료, Pages 배포 확인 대기

## 1. 목표와 범위

현재 그래프의 이미지 기반 문제를 수정한다. 변칙 네트워크 그래프를 유지하면서 category group은 실제 descendant envelope 기준으로 compact하게 배치하고, 모든 노드의 외곽 AABB 간 최소 여백을 42px로 적용한다.

보존할 동작:

- force-directed network graph의 변칙 좌표와 deterministic seed
- connected-component seed, golden-angle 후보 탐색, spatial bucket 충돌 탐색
- category/subcategory/item 부모 관계, 부모 근접성, 부모 거리 제한
- 같은 부모 간선의 방향 분리
- 실제 category group envelope의 외곽 분리와 42px 최소 간격
- 검색, 선택, tooltip, 파일 열기, 저장·동기화·외부 서비스 동작

제거할 동작:

- PR #59의 orphan 중앙 재배치 방식은 사용하지 않으며, 실제 envelope 기반 compact packing은 전역 무겹침 검증과 함께 재구성한다.
- 대규모 sibling을 위한 deterministic multi-ring 배치와 최종 전역 충돌 검증

## 2. 계층 구조

- 화면: `pkm.html`, `styles/pkm.css`, `src/presentation/pkm/`
- 처리: `src/application/pkm/graph-projector.js`, `graph-worker.js`, metadata/cache/sync
- 핵심 규칙: `src/domain/pkm/graph-layout-policy.js`, graph node/highlight/search/vault policy
- 저장·외부 서비스: PKM IndexedDB, Firestore chunk, Firebase Auth, Drive Worker, Backup Worker
- 의존성 연결·앱 시작: `src/bootstrap/pkm-main.js`

이번 변경은 화면, 저장소, 인증, 외부 서비스, package dependency를 수정하지 않는다.

## 3. 42px 외곽 간격 정책

실제 노드 width/height를 사용한 AABB 기준으로 두 노드는 다음 중 하나를 만족해야 한다.

- x축 중심 간격이 두 폭의 절반 합 + 42px 이상
- y축 중심 간격이 두 높이의 절반 합 + 42px 이상

도형 내부 겹침은 허용하지 않는다. 42px은 하드 최소값이며, 96px 선호 간격을 일반 충돌 기준으로 사용하지 않는다. 배치 후보가 부족할 때는 네트워크의 방향성과 변칙성을 유지하면서 후보 반경을 확장한다.

## 4. 처리 방식

1. force-directed network 좌표를 생성한다.
2. category와 계층 부모를 먼저 배치한다.
3. golden-angle 후보와 stable hash jitter를 사용한다.
4. 모든 후보에 실제 AABB 충돌, 부모 외곽 간격, 부모 근접성, 계층 거리, 간선 방향 조건을 적용한다.
5. 후보 실패 시 scale을 단계적으로 확대한다.
6. 최종 좌표는 유한 값이며 노드 내부 겹침과 42px 미만 외곽 간격이 없어야 한다.

## 5. Phase와 Gate

### Phase 0: 기준 확인

- PR #55와 #59 상태, 현재 main ref, 변경 파일을 확인한다.
- Gate: #59 변경 범위가 graph policy, worker, worker test, 계획 문서로 제한됨.

### Phase 1: 계획 문서

- 이 문서를 먼저 `drill`에 커밋한다.
- Gate: secret, token, 운영 식별자, 사용자 데이터가 없다.

### Phase 2: 기능 복원과 정책 적용

- #55 기준의 4개 파일을 복원한다.
- compact packing을 제거하고 42px 외곽 간격을 적용한다.
- Gate: 변경 파일이 그래프 정책·Worker·관련 테스트·문서 범위를 넘지 않는다.

### Phase 3: 자동 검증

- `npm test`
- `npm run build`
- `git diff --check`
- secret pattern 검사
- 42px AABB 간격, 무겹침, 변칙 좌표, 부모 관계, 대규모 입력 테스트
- Gate: 실패한 조건이 없고 기존 저장·동기화 테스트가 유지된다.

### Phase 4: PR과 배포

- PR CI와 Pages test/build/deploy 결과를 확인한다.
- main 병합 후 공개 HTML과 graph Worker asset HTTP 응답을 확인한다.
- 화면 screenshot은 생성하지 않으며, 실제 화면은 사용자가 직접 확인한다.

### Phase 5: 정리

- main 병합 확인 후 `drill`을 삭제한다.
- Gate: 원격 브랜치가 `main`만 남는다.

## 6. 실패 시 재수정 Loop

- 노드가 겹치면 node geometry, AABB 검사, spatial bucket 범위를 확인한다.
- 42px 미만이면 candidate gap과 fallback ring 반경을 확인한다.
- 그래프가 격자처럼 보이면 compact packing이 남아 있는지와 force seed 보존 여부를 확인한다.
- 부모 관계가 흐려지면 parent index, hierarchy constraint, angular slot을 확인한다.
- 성능이 저하되면 대규모 입력의 반복 횟수와 bucket 탐색만 최소 조정한다.
- 각 수정 뒤 실패 테스트를 먼저 재현하고 전체 test/build Gate를 반복한다.

## 7. 보안·문서 규칙

문서와 fixture에는 API key, OAuth secret/token, Firebase·Cloudflare 운영 식별자, 사용자 UID/email, 실제 메모 내용을 기록하지 않는다.


## 8. 완료 결과

- PR #61: `rollback: restore PR55 network graph with 42px spacing`
- 기존 main 기준 커밋: `a4c1eeb`
- PR #63 head: CI 검증 및 main 병합 완료
- Branch CI run 433, 434: 이전 변경 성공
- Branch CI run 454: 재수정 성공
- Test and Deploy GitHub Pages run 286, 287: 이전 변경 성공
- Test and Deploy GitHub Pages run 295: 재수정 test/build 성공
- main Pages 배포: 병합 후 workflow 확인 대기
- 공개 `https://hwahyo-o.github.io/link_memo/`와 `pkm.html`: HTTP 200
- 공개 PKM JavaScript/CSS 및 외부 Cytoscape·CodeMirror asset: HTTP 200
- secret pattern 검사: 발견 없음
- screenshot: 생성하지 않음. 화면은 사용자가 직접 확인
- 원격 브랜치: 완료 정리 전까지 `main`과 문서 갱신용 `drill` 유지


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
- main Pages 배포 확인은 병합 후 workflow와 공개 asset 응답으로 별도 기록한다.
