# PKM 반응형 검색·타이포그래피 인수인계

## 목적

이 문서는 PKM 그래프의 검색 초기화, 비PC 파일 드로어, 검색 필드 축소 방지와 비PC 타이포그래피 계약을 설명합니다. API 키, OAuth Client ID, Firebase·Cloudflare 식별자, Worker URL, 토큰, 사용자 UID 또는 이메일은 기록하지 않습니다.

## 사용자 동작

### 검색

- 검색 필드는 표준 `input[type="search"]`를 유지하며 별도의 `#clearSearch` 버튼을 만들지 않습니다.
- 브라우저 기본 초기화 버튼은 검색값이 있을 때만 표시되고 기존 `input` 이벤트, debounce와 그래프 강조 갱신을 그대로 사용합니다.
- `Escape` 검색 초기화 동작도 유지합니다.
- 검색 필드에는 고정 `height`를 사용하지 않습니다.
- PC 최소 블록 크기는 42px입니다.
- 1024px 이하에서는 `clamp(42px, calc(72.55px - 2.983vw), 63px)`로 화면 폭이 작아질수록 최소 블록 크기가 증가합니다.
- 기존 `flex: 1`은 너비 배치에 유지하고, 휴대폰 세로 flex에서의 축소는 `min-block-size`가 방지합니다.

### 비PC 텍스트

- 기존 비PC 기준인 1024px 이하에서만 적용합니다.
- 보조 설명·범례는 20px, 일반 텍스트는 22px, 주요 상태·버튼은 24px입니다.
- `PKM 그래프` 제목과 아이콘 기호는 기존 크기를 유지합니다.
- Cytoscape 일반 노드는 20px, 직접 일치 노드는 22px이며 PC에서는 기존 9px과 10px으로 돌아갑니다.
- 검색 모드 버튼은 두 줄까지 자연스럽게 줄바꿈하고 최소 블록 크기 56px을 확보합니다.
- 그래프 범례는 검색 필드와 검색 모드의 공통 크기 변수를 이용해 검색 영역 아래에 배치됩니다.

### 파일 드로어

- Core 규칙 `NON_PC_MEDIA_QUERY`와 동일한 1024px 이하에서 파일 패널을 드로어로 사용합니다.
- 오버레이 클릭, 파일 선택, `Escape`, 또는 PC 전환 시 닫힙니다.
- 1025px 이상에서는 기존 3-pane 레이아웃과 pane resizer를 유지합니다.

## 계층별 책임

| 계층 | 파일 | 책임 |
|---|---|---|
| 화면 | `pkm.html`, `styles/pkm.css` | 기본 search control, 반응형 최소 크기·텍스트·범례·드로어 배치 |
| 화면 처리 | `src/presentation/pkm/graph-view.js` | PC·비PC 그래프 노드 글자 크기 적용 |
| 처리 | `src/presentation/pkm/app-controller.js` | 기존 viewport 변경을 그래프 표시 계층에 전달 |
| 핵심 규칙 | `src/domain/sync/device-policy.js` | 기존 1024px 이하 비PC 기준 제공, 변경 없음 |
| 저장·외부 서비스 | IndexedDB, Firestore, Cloudflare, Drive 어댑터 | 화면 크기를 저장하거나 전송하지 않음 |
| 의존성 연결 | 기존 viewport profile 구독 | 저장 버튼·드로어·그래프 타이포그래피 동기화 |
| 앱 시작 | `src/bootstrap/pkm-main.js` | 기존 의존성 조립 유지, 변경 없음 |

## 회귀 방지

`tests/pkm-responsive-ui.test.js`가 다음을 고정합니다.

- 브라우저 기본 search 초기화만 사용하는지
- 검색 필드에 고정 높이가 없고 최소 크기가 42~63px인지
- 비PC 텍스트가 20·22·24px 단계인지
- 제목과 아이콘 크기 규칙이 유지되는지
- 그래프 일반·직접 일치 노드가 비PC에서 20px·22px인지
- 드로어와 기존 viewport 구독이 유지되는지

## 검증

```bash
npm test
npm run build
```

배포 후 320px, 390px, 768px, 1024px, 1025px에서 검색 필드 축소·검색 모드 줄바꿈·범례 겹침·드로어를 확인합니다. 요청에 따라 Playwright는 사용하지 않으므로 CI·빌드·배포 자산 증거와 실제 휴대폰 상호작용 증거를 구분합니다.

## 롤백

문제가 발생하면 이 변경 커밋을 되돌립니다. 저장 스키마와 외부 서비스는 변경하지 않으므로 데이터 마이그레이션은 필요하지 않습니다.
