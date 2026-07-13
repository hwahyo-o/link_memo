# 계층형 아키텍처

이 프로젝트는 화면, 처리, 저장 책임을 분리합니다. 의존성은 바깥 계층에서 안쪽 계층으로만 향합니다.

```
presentation -> application -> domain
presentation -> infrastructure (bootstrap에서 주입)
application -> domain
infrastructure -> 외부 서비스(Firebase, IndexedDB)
```

## 계층

- `src/presentation/`: DOM 렌더링, 입력 이벤트, 모달, 탭 길게 누르기 같은 사용자 화면 동작
- `src/application/`: 화면 요청을 메모 검증 및 이미지 저장 작업으로 조합하는 유스케이스
- `src/domain/`: URL 정규화, 메모 입력 조건, 미리보기 판별처럼 저장·화면에 독립적인 규칙
- `src/infrastructure/`: Firebase Auth/Firestore 및 IndexedDB의 구체적인 구현
- `src/bootstrap/`: 실제 구현체를 조합해 앱을 시작하는 진입점

## 저장 경계

- Firestore: 카테고리, 링크 메모, 사용자 설정
- IndexedDB: 이미지 Blob. 현재 브라우저에만 저장되므로 기기 간 이미지 동기화는 별도 클라우드 이미지 저장소가 필요합니다.

기존 `src/features`, `src/ui`, `src/storage` 파일은 외부 참조가 깨지지 않도록 새 계층의 호환용 재내보내기만 유지합니다.
