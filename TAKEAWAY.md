# TAKEAWAY

- 문서의 구현·완료 주장은 코드와 테스트 증거에 대조하고, 불일치가 있으면 사실과 계획을 분리해 표시한다.
- Keep user-confirmed behavior separate from proposals; do not carry implementation choices from a rejected draft into a new specification without reconfirmation.
- Publish PoB bridge state when the selected build changes, not when values inside the current build are edited.
- 계산 엔진을 외부 소스로 실행할 때는 런타임, 계산 코드, 패키지 포함 여부를 각각 명시한다.
- 브리지가 설치되지 않은 PoB도 발견해야 하므로 감시자의 프로세스 감지는 PoB 상태 파일에 의존하지 않게 한다.
- PoB 송신 파일의 미저장 경로는 `json.null`로 명시하고, Windows 파일 경로는 유니코드 API로 처리한다.
- 사용자가 별도로 요청하지 않으면 코드를 제외한 문서, PR 제목·본문, 커밋 메시지와 작업 보고는 모두 한글로 작성한다.
- 관리자 권한 감시자에서 일반 권한 Agent를 실행할 때는 실제 자식 권한과 프로세스 이벤트 수신을 각각 검증한다.
- 프로세스 시작 이벤트를 검증할 때는 실제 PoB를 여러 번 실행하고 이벤트 수신과 주기 조회 결과를 구분한다.
