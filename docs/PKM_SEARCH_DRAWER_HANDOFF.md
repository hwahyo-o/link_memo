# PKM 검색 초기화와 비PC 파일 드로어 인수인계

## 목적

이 문서는 PKM 그래프의 검색 초기화 버튼 중복과 비PC 파일 패널 잘림을 수정한 계약을 설명합니다. 실제 API 키, OAuth Client ID, Firebase·Cloudflare 식별자, Worker URL, 토큰, 사용자 UID 또는 이메일은 기록하지 않습니다.

## 사용자 동작

### 검색

- 검색 필드는 HTML 표준 `input[type="search"]`를 유지합니다.
- 별도의 `#clearSearch` 버튼은 만들지 않습니다.
- 브라우저 기본 초기화 버튼은 검색값이 있을 때만 표시되며, 누르면 브라우저가 발생시키는 `input` 이벤트를 통해 기존 검색 debounce와 그래프 강조 갱신이 실행됩니다.
- `Escape`는 검색어와 그래프 강조를 초기화하는 기존 키보드 동작을 유지합니다.

### 파일 드로어

- Core 규칙 `NON_PC_MEDIA_QUERY`와 동일한 viewport 1024px 이하에서 파일 패널을 드로어로 사용합니다.
- 기본 상태는 완전히 닫힘이며 헤더의 파일 버튼으로만 엽니다.
- 오버레이 클릭, 파일 선택, `Escape`, 또는 1024px 초과 전환 시 닫힙니다.
- 1025px 이상에서는 기존 3-pane 레이아웃과 pane resizer를 유지합니다.

## 계층별 책임

| 계층 | 파일 | 책임 |
|---|---|---|
| 화면 | `pkm.html`, `styles/pkm.css` | 기본 search control, 드로어 버튼·오버레이, 반응형 배치 |
| 처리 | `src/presentation/pkm/app-controller.js` | 드로어 열림 상태와 닫기 이벤트 연결 |
| 핵심 규칙 | `src/domain/sync/device-policy.js` | 기존 1024px 이하 비PC 기준 제공, 변경 없음 |
| 저장·외부 서비스 | IndexedDB, Firestore, Cloudflare, Drive 어댑터 | 이 화면 상태를 저장하거나 전송하지 않음 |
| 의존성 연결 | 기존 viewport profile 구독 | breakpoint 변경 시 저장 버튼과 드로어 상태 동기화 |
| 앱 시작 | `src/bootstrap/pkm-main.js` | 기존 의존성 조립 유지, 변경 없음 |

## 회귀 방지

`tests/pkm-responsive-ui.test.js`가 다음을 고정합니다.

- `graphSearch`가 search input인지
- 커스텀 `#clearSearch`와 관련 핸들러가 없는지
- 드로어 버튼·오버레이·열림 selector가 연결되는지
- 이전 38px 부분 노출과 hover/focus 열기 규칙이 제거됐는지
- 기존 비PC viewport 구독을 재사용하는지

## 검증

```bash
npm test
npm run build
```

배포 후 대표 폭 390px, 768px, 1024px, 1025px에서 검색 기본 X와 드로어 경계를 확인합니다. Playwright 자동 검증은 이 작업 범위에서 사용하지 않았으므로 실제 브라우저 상호작용 증거와 CI·번들 증거를 구분해서 기록합니다.

## 롤백

문제가 발생하면 이 변경 커밋을 되돌립니다. 저장 스키마와 외부 서비스는 변경하지 않으므로 데이터 마이그레이션이나 원격 저장소 정리는 필요하지 않습니다.
