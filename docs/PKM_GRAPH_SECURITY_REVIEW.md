# PKM 그래프 재구성 보안 차이 검토

> 대상: `main@c0c5e54` 대비 `drill` 구현 변경
> 일시: 2026-08-02 KST
> 결과: 보고 가능한 보안 회귀 없음

이 문서는 사용자 데이터나 운영 식별자를 포함하지 않으며, 코드 경로와 검증 결과만 기록합니다.

## 1. 위협 모델

변경된 공격면은 (1) 사용자 메모의 제목·키워드·요약을 그래프/tooltip에 표시하는 DOM 경로, (2) 노드에서 Markdown 파일을 여는 내부 경로, (3) 구형 자동 생성 파일의 tombstone 분류입니다. 보호 자산은 사용자 Markdown, 그래프 인덱스, 현재 viewport 상태와 동기화 snapshot입니다.

## 2. Finding discovery

- DOM XSS: 제목·키워드·요약은 모두 `textContent`로 삽입하며 HTML 문자열 sink를 사용하지 않습니다.
- 임의 URL/파일 열기: `openPath`는 현재 그래프 인덱스에 존재하고 `.md`로 끝나는 내부 Vault 경로에만 부여됩니다. 범주 노드에는 경로를 추측하지 않습니다.
- 삭제 오분류: 그래프 비표시와 영구 삭제를 분리했습니다. 영구 삭제 후보는 인덱스 밖 파일 중 `mutationId === "link-memo-import"`, `Link Memo/**/*.md`를 모두 만족하는 이전 importer 산출물뿐입니다. 사용자가 편집하면 Vault가 mutationId를 새 값으로 바꾸므로 보존 대상으로 이동합니다.
- 비밀정보 노출: 변경 파일에서 key/secret/private-key/password 형태를 검사했으며 문서의 금지 원칙 설명 외 실제 값은 없었습니다.
- 서비스 경계: Firebase/Drive/Cloudflare 인증·전송 코드는 변경하지 않았습니다.

기술적으로 타당한 보안 finding 후보가 없어 validation과 attack-path 확장은 생략했습니다.

## 3. 잔여 위험과 운영 확인

- 실제 사용자 snapshot에서 안전 삭제 후보 수가 예상보다 크면 배포 후 첫 동기화 전에 화면의 “구형 자동 파일 정리 N개” 값을 확인해야 합니다.
- 서버 권한 규칙은 이번 diff 범위 밖이며 기존 repository 계층을 그대로 사용합니다.
- tooltip은 버튼이지만 사용자 문자열을 실행하지 않고, 내부 `openPath`만 애플리케이션 callback으로 전달합니다.

## 4. 결론

현재 diff에서 보고 가능한 보안 회귀는 발견되지 않았습니다. 자동 테스트 101개와 production build가 통과했으며, 보안 관련 핵심 계약은 순수 함수 테스트와 정적 sink 검사로 확인했습니다.

