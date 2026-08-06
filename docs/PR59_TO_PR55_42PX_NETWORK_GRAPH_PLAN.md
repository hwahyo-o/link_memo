# PR #59 to #55 rollback and 42px network graph handoff

> 기준 시각: 2026-08-06 KST
> 작업 브랜치: `drill`
> 상태: 구현·검증·main 병합·Pages 배포·브랜치 정리 완료

## 1. 목표와 범위

현재 `main`의 PR #59 compact category packing을 PR #55의 변칙 네트워크 그래프 배치 기준으로 되돌린다. 복원 뒤 노드 외곽 AABB 간 최소 여백을 42px로 적용한다.

보존할 동작:

- force-directed network graph의 변칙 좌표와 deterministic seed
- connected-component seed, golden-angle 후보 탐색, spatial bucket 충돌 탐색
- category/subcategory/item 부모 관계, 부모 근접성, 부모 거리 제한
- 같은 부모 간선의 방향 분리
- category 중심 간격 420px 및 category region의 의미적 분리
- 검색, 선택, tooltip, 파일 열기, 저장·동기화·외부 서비스 동작

제거할 동작:

- PR #59의 실제 descendant envelope 기반 category group compact packing
- PR #59의 compact packing 이후 orphan 중앙 재배치 최적화

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
- main 병합 커밋: `212b11a`
- Branch CI run 433, 434: 성공
- Test and Deploy GitHub Pages run 286, 287: 성공
- main Pages run 288: test/build/deploy 성공
- 공개 `https://hwahyo-o.github.io/link_memo/`와 `pkm.html`: HTTP 200
- 공개 PKM JavaScript/CSS 및 외부 Cytoscape·CodeMirror asset: HTTP 200
- secret pattern 검사: 발견 없음
- screenshot: 생성하지 않음. 화면은 사용자가 직접 확인
- 원격 브랜치: `main`만 유지
