# PoB 프로세스 감시자

> 상태: 제품 동작과 구현 방향 합의. 감시자는 아직 구현되지 않았다.

이 문서는 PoB 실행을 감지해 별도 Agent 앱을 시작하고 후보 PID를 전달하는 감시자만 정의한다. PoB의 상태 파일 송신은 [PoB 측 송신](pob-side.md), Agent의 상태 파일 수신과 연결 선택은 [Agent 측 브리지](pob-bridge.md), PoB 설치본 변경은 [브리지 설치](pob-bridge-install.md)를 따른다.

## 실행과 대상

- 감시자는 Agent와 다른 프로세스다. 설치 실행 파일 `PoBAgent.exe` 하나를 일반 Agent 모드와 `--watcher` 감시 모드로 각각 실행한다. 감시 모드는 창을 열지 않는다.
- 설치 프로그램은 `PoBAgent.exe --watcher`를 Windows 로그인 항목으로 등록한다. 로그인 자동 실행이 기본값이며 Agent 설정의 수동 실행 선택은 같은 항목을 끈다.
- 사용자가 Agent를 직접 실행하면 감시자가 없을 때 감시 모드를 시작한다. 수동으로 시작된 감시자는 Agent 창이 닫힌 뒤에도 계속 실행한다.
- 감시자는 Windows 사용자 세션에서 하나만 실행한다. WMI 이벤트를 받는 Windows 네이티브 Node 모듈의 세션별 이름 있는 잠금으로 중복 실행을 막는다. Agent의 Electron 단일 인스턴스 잠금은 별개다.
- 감시 대상은 Community Edition의 실행 파일 이름 `Path of Building.exe`다. 설치 폴더를 아직 모르는 상태에서도 찾아야 하므로 PoB 상태 파일에 의존하지 않는다. 이름만 같은 다른 프로세스를 PoB로 오인할 수 있으며 다른 PoB 변형은 현재 범위에 포함하지 않는다.

## 프로세스 감지와 전달

- 프로젝트 소유 Windows 네이티브 Node 모듈(`.node`)이 WMI의 `Win32_ProcessStartTrace`와 `Win32_ProcessStopTrace`를 구독한다. 감시자 시작 시 이미 실행 중인 PoB를 조회하고, 이벤트 구독이 끊겼다가 복구되면 다시 조회한다.
- 시작 시 조회에서 이미 실행 중인 PoB가 여러 개면 한 번의 Agent 실행에 각 PID를 `--pob-pid=<PID>` 인자로 반복해 전체 최초 목록을 전달한다. 이후 새 PoB를 발견하면 해당 PID 하나를 같은 인자로 전달한다. 브리지가 아직 설치되지 않은 PoB도 Agent를 열 수 있어야 한다.
- Agent가 이미 실행 중이면 새 Agent 실행은 Electron 단일 인스턴스 이벤트로 받은 PID 목록을 기존 Agent에 넘기고 종료한다. 계속 실행되는 Agent는 하나다.
- 전달한 PID는 연결 후보일 뿐이다. Agent는 전체 최초 목록을 받은 뒤 감시자가 확인한 PID와 상태 파일이 일치하는 PoB가 하나면 자동 연결하고 여러 개면 사용자 선택을 받는다. Agent가 대상을 선택한 뒤 나중에 발견한 PoB는 그 연결을 바꾸지 않는다.
- 감시자는 빌드 경로를 읽거나 전달하지 않는다. 빌드 경로는 PoB 상태 파일을 Agent가 직접 읽는다.

## Agent 종료 후 재실행

- PoB가 하나라도 실행 중일 때 Agent가 종료되면 원인과 관계없이 자동 재실행을 억제한다. 사용자가 Agent를 직접 실행하는 것은 허용한다.
- 억제는 감시자가 재시작되어도 유지한다. 모든 PoB가 종료되면 억제를 해제하고, 이후 새 PoB가 실행될 때 다시 Agent를 자동 실행할 수 있다.
- 선택된 PoB가 종료될 때 Agent를 종료하고 다른 PoB로 자동 승계하지 않는 동작은 [Agent 측 브리지](pob-bridge.md)가 담당한다.

## 완료 기준

- 로그인 자동 실행과 Agent 직접 실행 모두 감시자를 중복 없이 시작하며, 수동 설정은 로그인 항목을 끈다.
- 감시자보다 먼저 실행된 PoB의 PID 전체를 한 번에, 감시 중 새로 실행된 PoB의 PID를 발견 시 Agent에 전달한다. PoB에 송신 코드가 없어도 Agent를 열 수 있다.
- Agent가 이미 실행 중이면 중복 Agent를 남기지 않고 기존 Agent에 후보 PID 목록을 전달한다.
- PoB 시작·종료 이벤트 연결을 복구한 뒤 실행 중인 PoB 목록과 상태를 다시 맞춘다.
- Agent 종료 후 PoB가 남아 있으면 감시자 재시작 뒤에도 자동 재실행하지 않는다. 모든 PoB가 종료된 뒤에는 다시 자동 실행할 수 있다.

감시자 실행 파일의 배포와 네이티브 모듈 포함 방법은 [Agent 패키징 및 배포](agent-packaging.md)에서 관리한다. WMI 이벤트의 PID와 프로세스 이름은 [시작 이벤트](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/krnlprov/win32-processstarttrace) 및 [종료 이벤트](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/krnlprov/win32-processstoptrace)에 정의되어 있다.
