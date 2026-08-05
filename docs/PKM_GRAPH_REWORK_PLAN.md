# PKM 그래프 계층 배치 재작업 계획 및 인계 문서

> 기준 시각: 2026-08-05 KST
> 작업 브랜치: `drill`
> 상태: 계층 배치 정책과 Worker 구현 완료, 자동 검증 대기

## 1. 목적

기존의 변칙적인 네트워크 그래프 표현을 유지하면서 다음 배치 규칙을 보장한다.

- 버튼 노드는 자신이 속한 소분류 노드의 중심 영향 반경 안에 위치한다.
- 소분류 노드는 자신이 속한 대분류 노드의 중심 영향 반경 안에 위치한다.
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

### Worker

Worker 최종 패커는 다음 순서로 동작한다.

1. 명시적인 category/subcategory ID와 membership edge로 부모 관계를 구성한다.
2. 대분류 root를 먼저 배치한다.
3. 부모 중심 영향 반경을 계산한다.
4. 소분류와 버튼 노드를 부모 반경 안에서 golden-angle 후보로 배치한다.
5. 모든 후보에 부모 외곽 여백과 기존 노드 충돌을 함께 적용한다.
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

정책 파일, Worker 연결, 정책 테스트, 계층 Worker 테스트를 `drill` 브랜치에 반영했다.

아직 다음 항목은 자동 검증 결과 확인 전이다.

- 전체 테스트
- production build
- GitHub Actions
- 배포 화면 smoke test
- 최종 보안 스캔
- main 병합 및 배포

검증 완료 후 이 문서의 상태와 Gate 결과를 같은 브랜치에서 갱신한다.
