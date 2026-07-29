# PKM Markdown 편집기 유지보수 안내

이 문서는 PKM 그래프 화면의 반응형 검색 영역, 파일 드로어 글꼴, Markdown 표시 및 목록 편집 규칙을 설명한다. API 키, 사용자 ID, 저장소 식별자 등 배포 비밀은 기록하지 않는다.

## 계층별 책임

### 화면 계층

- `pkm.html`: 검색·드로어·편집기 호스트를 배치하고 고정 버전 CodeMirror 리소스를 로드한다.
- `styles/pkm.css`: PC와 비PC에 공통인 선택자별 글꼴, 비PC 검색 필드 최소 높이, Markdown 시각 규칙을 담당한다.
- `src/presentation/pkm/markdown-editor.js`: CodeMirror를 앱에서 사용하는 작은 편집기 포트로 감싼다. 커서, 한글 조합 입력, 선택 영역, Enter 및 Tab 입력을 여기서 처리한다.
- `src/presentation/pkm/workspace.js`: 편집기의 구현을 알지 않고 `getValue`, `setValue`, `onChange`, `replaceSelection`, `focus`, `refresh`만 사용한다.

### 처리 계층

- `src/presentation/pkm/app-controller.js`: 편집기 어댑터를 생성해 워크스페이스에 주입한다.
- 기존 250ms 로컬 저장 지연, 편집 완료 저장, 이미지 Markdown 삽입 흐름은 유지한다.

### 핵심 규칙 계층

- `src/domain/pkm/markdown-display-rules.js`: DOM과 저장소에 의존하지 않는 순수 함수만 둔다.
- 제목, 강조, 하이라이트, 중첩 구간, 목록 표식, 다음 목록 표식, 들여쓰기 변환을 판정한다.
- URL의 `/`는 하이라이트 구분자로 처리하지 않는다.

### 저장 및 외부 서비스 계층

- Markdown 원문과 표식은 변환하지 않고 기존 vault에 그대로 저장한다.
- Firebase, IndexedDB, Drive 이미지 업로드, 유휴 동기화 규칙은 변경하지 않는다.
- CodeMirror는 `5.65.16`으로 고정해 CDN의 예기치 않은 버전 변경을 막는다.

### 의존성 연결 및 앱 시작 계층

- `src/bootstrap/pkm-main.js`의 앱 시작 흐름은 변경하지 않는다.
- `createPkmApp`이 인증 후 워크스페이스를 처음 만들 때 편집기 어댑터도 한 번만 생성한다.
- 앱 종료 시 편집기와 그래프 리소스를 함께 해제한다.

## 글꼴 및 표시 규칙

- 검색 필드, 검색 조건 탭, 그래프 범례: 18px Regular
- 드로어 제목·개수: 18px Regular, 제목과 새 메모 버튼: 18px Bold
- 파일 검색과 그룹 제목: 18px Regular
- 모든 `.file-row`: 20px Regular, 선택 상태도 같은 굵기
- 스키마 요약: 18px Bold
- 편집기 탭과 도구 모음: 16px Regular
- Markdown 본문: 18px Regular
- `#`: 26px Bold, `##`: 24px Regular, `###`: 22px Regular
- `**강조**`: 20px Bold
- `/하이라이트/`: 20px Regular, 배경 `#F8D374`
- 강조와 하이라이트가 겹치거나 교차하는 구간: 20px Bold, 배경 `#F8D374`

제목 안의 강조 또는 하이라이트는 제목 크기를 유지하고 굵기와 배경만 적용한다.

## 목록 규칙

- `-`, `*`, `+` 뒤에 공백을 두면 불릿 항목으로 인식한다.
- 체크, 별, 화살표 등 딩뱃·기호 뒤에 공백을 두면 불릿 항목으로 인식한다.
- `1. ` 형식은 번호 목록으로 인식한다.
- 혼합 목록은 4칸 들여쓰기마다 `1.` → `가.` → `1)` → `◦` 순서로 바뀐다.
- Enter는 같은 단계의 다음 표식을 만들고 빈 항목에서는 목록을 끝낸다.
- Tab과 Shift+Tab은 목록 단계를 올리거나 내린다.

## 반응형 검색 필드

- PC 기본 최소 높이는 42px이다.
- 비PC에서는 고정 높이를 사용하지 않고 `min-block-size`만 사용한다.
- 1024px에서 42px, 320px 이하에서 52px가 되며 그 사이는 화면 폭과 반비례해 연속적으로 계산한다.
- 따라서 세로 flex 축이 줄어도 검색 필드는 지정된 최소 높이 아래로 축소되지 않는다.

## 검증과 변경 절차

1. `tests/markdown-display-rules.test.js`에 새 문법의 입력과 기대 구간을 먼저 추가한다.
2. `npm test`와 `npm run build`를 통과시킨다.
3. 모바일 실제 기기에서는 한글 조합 입력, 커서 이동, Enter, Tab, 저장 후 재열기를 확인한다.
4. 저장·동기화 코드를 수정해야 할 경우 편집기 포트를 유지하고 infrastructure 계층을 별도로 검토한다.

Playwright 자동화는 이 변경의 검증 범위에서 제외한다.
