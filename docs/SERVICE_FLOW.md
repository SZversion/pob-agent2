# 서비스 흐름 문서 안내

> 상태: 문서 색인. 상세 기능 요구사항과 설계는 기능별 문서를 기준으로 합니다.

- 전체 사용자 파이프라인: [기능 파이프라인](FEATURES.md)
- PoB의 PID·활성 저장 빌드 경로 기록: [PoB 측 상태 송신](features/pob-side.md)
- PoB 감지, Agent 실행과 후보 PID 전달: [PoB 프로세스 감시자](features/pob-watcher.md)
- Agent의 상태 파일 수신과 빌드 맥락 관리: [Agent 측 PoB 브리지](features/pob-bridge.md)
- PoB 설치본에 송신 코드를 적용하는 절차: [PoB 브리지 설치](features/pob-bridge-install.md)
- Python MCP 서버와 LuaJIT 계산 호출: [MCP 실행 및 계산기 호출 방식](MCP.md)

각 기능 문서는 기능별 In Scope, Out of Scope, PRD 요구사항, SDD 설계, 완료 기준 및 미결정 사항을 관리합니다. 이 색인 문서는 별도의 동작 규칙을 정의하지 않습니다.
