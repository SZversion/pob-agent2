# TAKEAWAY

- 문서의 구현·완료 주장은 코드와 테스트 증거에 대조하고, 불일치가 있으면 사실과 계획을 분리해 표시한다.
- Keep user-confirmed behavior separate from proposals; do not carry implementation choices from a rejected draft into a new specification without reconfirmation.
- Publish PoB bridge state when the selected build changes, not when values inside the current build are edited.
- 계산 엔진을 외부 소스로 실행할 때는 런타임, 계산 코드, 패키지 포함 여부를 각각 명시한다.
- 브리지가 설치되지 않은 PoB도 발견해야 하므로 감시자의 프로세스 감지는 PoB 상태 파일에 의존하지 않게 한다.
