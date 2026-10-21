# Agent 패키징 및 배포

> 상태: 패키징 방향 합의, 배포 상세 초안. 코드 서명과 사용자가 준비할 PoB 소스·LuaJIT의 경로 설정 및 라이선스 고지는 미정입니다.

## 1. 문서 목적과 범위

Windows x64용 PoB Agent 앱, 별도 PoB 감시자 프로세스, Python MCP 프로세스를 개발·패키징·배포하는 방향을 정의합니다. 창과 채팅 동작은 [Agent 창 기능](agent-window.md), PoB 연결 세부는 [PoB bridge](pob-bridge.md), MCP 도구와 계산 경계는 [MCP 실행 및 계산기 호출 방식](../MCP.md)을 따릅니다.

## 2. 합의된 대상

- 지원 운영체제: Windows만 지원합니다.
- 지원 아키텍처: x64만 지원합니다.
- UI 및 앱 셸: Electron, React, TypeScript, Vite.
- PoB 감시자: Agent와 별도 프로세스로 실행합니다. Windows 로그인 자동 실행이 기본이며 Agent 설정에서 수동 실행으로 바꿀 수 있습니다. 감시자의 실행 파일 구성과 로그인 시작 등록 방식은 미정입니다.
- Python MCP 서버: Agent와 분리된 자식 프로세스이며, Electron 메인 프로세스와 stdio로 통신합니다.
- LuaJIT 실행 파일과 PoB 계산 소스는 Agent 패키지에 포함하지 않습니다. 사용자가 별도로 준비한 LuaJIT과 PoB 소스 체크아웃을 사용합니다.
- Python과 LuaJIT 사이의 JSON Lines 통신을 처리하는 프로젝트 소유 Lua 어댑터는 Agent 패키지에 포함합니다.
- 최종 사용자는 별도 Python 또는 `uv` 설치 없이 Agent 설치 프로그램을 사용할 수 있어야 합니다.

## 3. 개발 실행과 배포 구성

### 개발 환경

- Vite로 Electron 앱과 React 렌더러를 개발·빌드합니다.
- PoB 감시자는 Agent와 별도 프로세스로 실행합니다. 개발 시 감시자 시작·재시작 방식은 미정입니다.
- Python MCP 서버는 `uv`로 실행합니다.
- Electron 메인 프로세스가 개발 서버를 시작할 때 MCP 서버 프로세스도 시작하고, stdio를 통해 MCP 요청·응답을 전달합니다.

### 배포 환경

1. Windows x64 빌드 환경에서 PyInstaller `onedir`로 Python MCP 서버와 Python 런타임·의존성을 한 디렉터리에 묶습니다.
2. Electron 앱은 `electron-builder`로 패키징합니다. Python MCP 디렉터리를 앱의 `resources/mcp`에 포함하며, 실행 파일과 라이브러리는 실행 가능한 일반 파일로 `app.asar` 바깥에 둡니다.
3. `electron-builder`의 NSIS maker로 Windows 설치용 `.exe`를 생성합니다. 설치 파일 하나에 Electron 앱과 MCP 실행 폴더를 함께 넣습니다.
4. 설치된 Agent의 Electron 메인 프로세스는 `process.resourcesPath` 아래의 MCP 실행 파일을 시작합니다. MCP는 앱 창에 포함되거나 Electron과 같은 프로세스로 합쳐지지 않습니다.

PoB 감시자는 별도 프로세스여야 하며 PoB 실행을 감지할 수 있어야 합니다. 감시자를 설치물에 포함하는 방식과 Windows 로그인 자동 실행을 등록·변경하는 방법은 미정입니다.

예상되는 설치 구조는 다음과 같습니다.

```text
PoBAgent/
├─ PoBAgent.exe
└─ resources/
   ├─ app.asar
   └─ mcp/
      ├─ mcp-server.exe
      └─ _internal/
```

PyInstaller의 기본 `onedir` 결과는 실행 파일과 지원 파일들로 구성됩니다. 이를 Electron 리소스로 포함하므로 사용자가 Python 쪽 폴더를 따로 설치하거나 실행할 필요는 없습니다.

## 4. MCP 프로세스 실행 규칙

- Electron 메인 프로세스가 MCP를 직접 자식 프로세스로 시작합니다. 실행 파일 경로와 인자를 분리해 전달하고 셸을 거치지 않습니다.
- stdin과 stdout은 MCP stdio 전송에 연결하고 stderr는 진단 로그로 취급합니다. MCP 프로토콜 외의 로그를 stdout에 쓰지 않습니다.
- Windows 콘솔 창은 사용자에게 표시하지 않되 stdio가 유지되도록 프로세스를 시작합니다. PyInstaller의 `--noconsole` 모드는 표준 입력·출력을 제공하지 않으므로 MCP 서버 빌드에 사용하지 않습니다.
- 앱 준비 상태는 MCP 프로세스 시작만으로 완료하지 않습니다. MCP handshake와 모델 연결이 모두 준비된 뒤 채팅 입력을 활성화합니다. 준비 재시도 횟수와 제한 시간은 [Agent 창 기능](agent-window.md)에 정의합니다.
- 앱 종료 시 Electron 메인 프로세스가 MCP 프로세스도 정리합니다.

## 5. 배포 전 확인 기준

- Python 또는 `uv`가 설치되지 않은 깨끗한 Windows x64 환경에서 설치 프로그램을 실행할 수 있습니다.
- Agent 실행과 함께 MCP가 자동 시작되고 stdio handshake가 완료됩니다. 준비가 실패하면 채팅 창의 합의된 재시도 상태로 이어집니다.
- 설치 후 감시자는 기본 설정인 Windows 로그인 자동 실행으로 시작하고, 설정을 수동 실행으로 바꾸면 로그인 시 자동 시작하지 않습니다.
- 앱 종료 후 MCP 자식 프로세스가 남지 않습니다.
- 사용자가 별도로 준비한 LuaJIT 실행 파일과 PoB 소스 경로를 MCP가 사용할 수 있습니다.
- PyInstaller 산출물에 MCP가 사용하는 Python 의존성과 필요한 데이터 파일이 포함됩니다.
- MCP stdout은 MCP 프로토콜에만 사용되고 진단 로그는 stderr로 분리됩니다.
- MCP는 LuaJIT 자식 프로세스의 준비 완료 전에는 시작 handshake를 완료하지 않습니다. 시작 제한은 10초입니다.
- Python과 LuaJIT은 표준 입출력 JSON Lines로 통신하고, 요청당 10초 제한과 프로세스·통신 실패에 대한 총 3회 시도 규칙을 따릅니다. 자세한 계산 경계는 [MCP 문서](../MCP.md)를 따릅니다.

## 6. 미결정 사항

- 코드 서명 인증서와 Windows 서명 절차. 외부 배포 전에 결정합니다.
- 감시자 프로세스를 설치물에 포함하는 방법, Windows 로그인 자동 실행 등록·변경·제거 방법.
- 사용자가 준비할 LuaJIT 실행 파일과 PoB 소스의 경로 설정·탐색, 버전 호환성 및 라이선스 고지
- 외부 모델 연결 및 인증 세부. 추후 별도 문서에서 정의합니다.
