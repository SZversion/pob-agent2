# 브리지 기반 PoB 대상 선택기 구현 계획

> 상태: 대체된 과거 계획입니다. 이 계획을 실행하지 말고, 현재 요구사항은 [PoB 브리지](../../features/pob-bridge.md)와 [PoB 측 브리지 변경](../../features/pob-bridge-pob-side.md)을 따르세요.

> **에이전트 작업자 안내:** 구현 작업마다 `superpowers:executing-plans` 하위 스킬을 사용해야 합니다. 단계 추적에는 `- [ ]` 체크박스 형식을 사용합니다.

**목표:** 비활성화된 샘플 빌드 컨트롤을, 현재 연결되어 있고 인증된 PoB 브리지 세션만 대상으로 하는 선택기로 교체합니다.

**구조:** Electron main이 루프백 TCP 리스너, 검증된 PoB 세션, 선택된 대상, 로컬 빌드명 추출을 소유합니다. 격리된 preload API가 스냅샷 조회, 선택, 업데이트를 React에 노출합니다. 사용자 요청으로 시작하는 Settings 흐름만 PoB 연동 파일을 설치하거나 복구할 수 있습니다.

**기술 스택:** Electron 44, Node.js 내장 모듈, React 19, TypeScript 7, 선택한 PoB 배포본에 포함된 LuaSocket 및 Lua JSON 모듈.

**명세:** `docs/superpowers/specs/2026-10-20-pob-target-selector-design.md`

## 전체 제약

- 브리지 리스너는 `127.0.0.1`에만 바인딩하고, 줄바꿈으로 구분되는 JSON과 사용자별 무작위 세션 토큰을 사용합니다.
- 브리지 메시지에는 이벤트 유형, PID, 저장된 빌드 파일 경로만 포함합니다. 빌드 XML, 내용, 계산값, 빌드명은 전송하지 않습니다.
- 프로세스 생존 여부와 저장 경로의 읽기 가능 여부를 검증하고, 로컬 저장 파일을 읽어 표시명을 추출합니다.
- 프로세스 이름이나 창으로 연결을 추정하지 않고, PoB 메모리를 읽지 않으며, 저장하지 않은 빌드 상태를 포함하지 않습니다.
- 사용자가 Settings에서 연동을 명시적으로 시작하기 전에는 어떤 PoB 디렉터리도 수정하지 않습니다.
- 브리지에 새 의존성을 추가하지 않습니다. Node 내장 모듈과 지원되는 PoB 배포본에 포함된 라이브러리를 사용합니다.
- 렌더러 접근은 기존 격리 preload 경계 뒤에 유지합니다. Node나 Electron 객체를 노출하지 않습니다.
- 시작 시 전달, MCP/모델 준비 상태, 채팅 스트리밍, 큐 동작은 이 선택기 작업 범위에 포함하지 않습니다.

## 검토 중점

- 잘못되었거나 오래되었거나 재사용된 PID는 거부하고 연결된 것으로 표시하지 않습니다.
- 형식이 잘못되었거나 크기가 초과된 메시지, 인증되지 않은 메시지는 리스너를 중단시키거나 토큰을 노출하지 않고 연결을 닫거나 거부합니다.
- 저장 경로가 없거나 읽을 수 없거나 XML 파일이 아닌 경우, 프로토콜이 허용할 때에만 유효한 세션을 유지합니다. 화면에는 `PoB`를 표시하고 오래된 빌드명은 표시하지 않습니다.
- 빌드명이 중복되거나 대상을 바꾸는 중 빠르게 연결이 끊어지면 프로세스 시작 시각으로 구분하고, 검증에 성공할 때까지 이전 선택을 유지합니다.
- 지원하지 않는 PoB 버전이나 후크 서명 불일치가 있으면 Settings에서 미지원 상태를 알리고 설치 파일을 변경하지 않습니다.

## 파일과 책임

- `src/main/index.ts` 수정: 앱/창 수명 주기에 맞춰 브리지 서비스를 시작·중지하고 IPC 핸들러를 연결합니다.
- `src/main/pob-bridge.ts` 생성: 리스너, 메시지 검증, 세션 수명 주기, 로컬 경로/이름 검증, 대상 확인을 담당합니다.
- `src/preload/index.ts` 수정: `contextBridge`를 통해 범위를 좁힌 타입 지정 스냅샷/선택/구독 API를 노출합니다.
- `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` 수정: 기존 UI를 유지하며 대상이 0개/1개/여러 개인 상태와 선택 오류를 표시합니다.
- `src/main/pob-integration.ts` 생성: Settings에서 시작하는 PoB 디렉터리 검증, 백업/적용/복구를 검증된 후크 서명으로 보호합니다.
- Settings가 현재 합의된 연동 진입점인 경우에만 최소 연동 컨트롤을 위해 `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`를 수정합니다.

## 작업

### 작업 1: 브리지 세션 프로토콜과 main 프로세스 서비스 정의

**파일:** `src/main/pob-bridge.ts` 생성, `src/main/index.ts` 수정.

**인터페이스:**

- `PobTarget = { pid: number; processStartedAt: number; buildPath: string | null; buildName: string | null }`을 내보냅니다.
- `start(): Promise<void>`, `stop(): Promise<void>`, `getTargets(): PobTarget[]`, `selectTarget(pid: number): Promise<PobTarget>`을 제공하는 `PobBridgeService`를 내보냅니다.
- 인증된 `register`, `build-path-changed` JSONL 메시지만 받습니다. 메시지는 PID와 선택적 경로를 포함합니다. 각 연결을 OS 프로세스 시작 식별 정보와 연결하고, 소켓이 닫히거나 프로세스가 종료되면 세션을 제거합니다.
- IPv4 루프백에서 임시 포트를 사용해 수신하고, 포트와 암호학적으로 안전한 무작위 토큰을 `Electron app.getPath('userData')` 아래에 저장합니다.

- [ ] 현재 Electron 수명 주기를 확인하고, 줄 길이 제한 파싱, 토큰 비교, PID 생존/시작 시각 확인, 읽을 수 있는 `.xml` 경로 검증, 소켓별 정리를 포함한 서비스를 구현합니다.
- [ ] PoB의 현재 로컬 동작에 따라 저장 파일의 파일명에서 표시되는 빌드명을 추출합니다. 브리지에서 빌드명을 받지 않습니다.
- [ ] 앱 준비 후 서비스를 시작하고 앱 종료 시 중지합니다. 리스너 시작에 실패해도 앱은 계속 실행되며 연결되지 않은 상태로 둡니다.
- [ ] `npm run typecheck`와 `npm run build`를 실행합니다.
- [ ] `src/main/pob-bridge.ts`와 `src/main/index.ts`만 커밋합니다.

### 작업 2: preload/IPC를 통한 대상 스냅샷 조회와 전환 노출

**파일:** `src/main/index.ts`, `src/preload/index.ts` 수정.

**인터페이스:**

- `window.pobBridge.getTargets(): Promise<PobTarget[]>`
- `window.pobBridge.selectTarget(pid: number): Promise<{ target: PobTarget } | { error: string }>`
- `window.pobBridge.onTargetsChanged(callback: (targets: PobTarget[]) => void): () => void`
- main은 선택 요청으로 받은 PID의 세션이 여전히 살아 있는지 확인한 뒤 선택된 PID를 공개합니다. 검증에 실패하면 현재 선택을 변경하지 않습니다.

- [ ] 구조화된 복사로 안전한 데이터만 반환하는 IPC 핸들러와 이벤트 구독을 추가합니다.
- [ ] 렌더러가 전달한 PID가 양의 정수인지 검증하고, 구독 해제 시 리스너를 제거합니다.
- [ ] `npm run typecheck`와 `npm run build`를 실행합니다.
- [ ] 파일에 다른 변경이 있으면 이 작업의 변경 부분만 골라 `src/main/index.ts`, `src/preload/index.ts`만 커밋합니다.

### 작업 3: 기존 채팅 하단 영역에 선택기 상태 구현

**파일:** `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` 수정.

**인터페이스:** 작업 2에서 제공하는 `window.pobBridge`만 사용합니다.

- [ ] 비활성화된 샘플 빌드 컨트롤을 대상으로 교체합니다. 대상이 없으면 화살표 없이 `PoB`, 하나면 저장된 빌드명(없으면 `PoB`), 여러 개면 선택된 빌드명과 드롭다운을 표시합니다.
- [ ] 메뉴에 모든 세션을 표시하고, 빌드명이 겹치면 프로세스 시작 시각을 라벨에 추가합니다.
- [ ] 대상을 선택하면 오류를 표시하고, main이 전환을 거부하면 현재 대상을 유지합니다. 업데이트 이벤트로 연결이 끊긴 세션은 메뉴에서 제거합니다.
- [ ] 현재 레이아웃, 기존 SVG 전송 아이콘, 관련 없는 작업 트리 변경을 그대로 유지합니다.
- [ ] `npm run typecheck`, `npm run build`를 실행하고, PoB 설치 디렉터리는 수정하지 않은 채 로컬 프로토콜 클라이언트로 대상 0개/1개/여러 개, 이름 중복, 연결 끊김, 전환 실패 상태를 수동으로 확인합니다.
- [ ] `App.tsx`, `styles.css` 중 이 작업에 해당하는 변경 부분만 커밋합니다.

### 작업 4: Settings에서 명시적으로 시작하는 연동 적용/복구 흐름 추가

**파일:** 필요에 따라 `src/main/pob-integration.ts` 생성, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` 수정.

**인터페이스:** 성공/오류를 구조화된 결과로 반환하는 `window.pobBridge.install(directory: string)`, `window.pobBridge.restore(directory: string)`를 추가합니다. 네이티브 디렉터리 선택과 임의의 렌더러 경로를 신뢰하지 않는 처리는 main 프로세스가 담당합니다.

- [ ] 사용자 선택 설치본에서 지원되는 PoB 버전과 정확한 후크 시그니처를 먼저 검증합니다. 미지원 또는 미확인 상태라면 파일을 쓰지 않고 설명이 있는 오류를 반환합니다.
- [ ] 사용자의 명시적 동작이 있을 때에만 복구 가능한 백업을 만들고 최소 Lua 후크를 적용합니다. 같은 Settings 영역에서 복구할 수 있게 합니다.
- [ ] 적용/복구에 실패해도 원본 파일을 보존하고, 영향을 받은 경로와 복구 상태를 알립니다.
- [ ] 개발 검증 중 `.pob` 또는 그 밖의 PoB 디렉터리에 연동을 적용하지 않습니다.
- [ ] `npm run typecheck`, `npm run build`를 실행하고 지원하지 않는 버전 및 Settings 동작 상태를 수동으로 확인합니다.
- [ ] 이 작업에 해당하는 파일/변경 부분만 커밋합니다.

## 검증 및 인계

- 관련 작업 후 `npm run typecheck`, `npm run build`, `git diff --check`를 실행합니다.
- UI를 변경하면 사용자의 상시 지침에 따라 데스크톱 앱을 재시작하고 실행 중인 창을 확인합니다.
- 지원되는 PoB 버전과 후크를 검증하고 사용자가 명시적으로 연동을 실행하기 전까지, 실제 PoB 등록과 백업 복구는 검증되지 않은 상태로 둡니다.
- 자동 테스트 모음은 사용자가 요청하지 않으면 추가하거나 실행하지 않습니다.
