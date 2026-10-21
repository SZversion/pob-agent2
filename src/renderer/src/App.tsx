import { useEffect, useState } from "react";

type View = "chat" | "settings";
type Message = { role: "user" | "assistant"; text: string };

// Static preview content only; this is not a connected build or a calculation result.
const PREVIEW_MESSAGES: Message[] = [
  { role: "user", text: "이번 빌드에서 피해를 높이는 핵심 요소가 뭐야?" },
  {
    role: "assistant",
    text: "저장된 빌드를 계산한 결과와 장비·스킬 구성을 근거로 설명할게요.",
  },
];
export default function App() {
  const [view, setView] = useState<View>("chat");
  const [bridgeState, setBridgeState] = useState<{
    targets: PobTarget[];
    selectedPid: number | null;
  }>({ targets: [], selectedPid: null });
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [connectionRequested, setConnectionRequested] = useState(false);

  useEffect(() => {
    void window.pobBridge.getState().then(setBridgeState);
    return window.pobBridge.onTargetsChanged((nextState) => {
      setBridgeState(nextState);
    });
  }, []);

  const { targets, selectedPid } = bridgeState;
  const selectedTarget = targets.find((target) => target.pid === selectedPid) ?? null;
  const duplicateNames = new Set(
    targets
      .filter((target) => target.buildName)
      .map((target) => target.buildName)
      .filter((name, index, names) => names.indexOf(name) !== index),
  );

  async function startConnection(): Promise<void> {
    setConnectionRequested(true);
    setSelectionError("");
    if (targets.length === 1) {
      await selectTarget(targets[0].pid);
      return;
    }
    if (targets.length > 1) {
      setSelectorOpen(true);
      return;
    }
    setSelectionError("연결 가능한 PoB 프로세스가 없습니다.");
  }

  async function selectTarget(pid: number): Promise<void> {
    const result = await window.pobBridge.selectTarget(pid);
    if ("error" in result) {
      setSelectionError(result.error);
      return;
    }
    setBridgeState((current) => ({
      ...current,
      selectedPid: result.target.pid,
    }));
    setSelectionError("");
    setSelectorOpen(false);
  }

  if (view === "settings") {
    return (
      <main className="app-shell settings-shell">
        <header className="topbar">
          <button
            aria-label="채팅으로 돌아가기"
            className="back-button"
            onClick={() => setView("chat")}
            type="button"
          >
            ←
          </button>
          <h1>설정</h1>
        </header>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span aria-hidden="true" className="brand-mark">
            ◎
          </span>
          <span>PoB Agent</span>
        </div>
      </header>

      <section aria-label="채팅 기록" className="conversation">
        {PREVIEW_MESSAGES.map((message, index) => (
          <div
            className={`message message-${message.role}`}
            key={`${message.role}-${index}`}
          >
            {message.text}
          </div>
        ))}
      </section>

      <section aria-label="질문 입력" className="composer">
        <textarea
          aria-label="질문 입력"
          disabled
          placeholder="무엇이 궁금한가요?"
          rows={1}
        />
        <button
          aria-label="전송"
          className="send-button"
          disabled
          type="button"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12 7-7 7 7" />
            <path d="M12 19V5" />
          </svg>
        </button>
      </section>

      <footer className="bottom-bar">
        <div className="setting-wrap">
          <button
            aria-label="설정 열기"
            className="settings-button"
            onClick={() => setView("settings")}
            type="button"
          >
            <span aria-hidden="true">⚙</span> 설정
          </button>
        </div>
        <div className="connection-wrap">
          {selectionError && <span className="selection-error" role="status">{selectionError}</span>}
          {selectedTarget ? (
            <div aria-label="PoB 연결 상태: 연결됨" className="connection-status">
              <span aria-hidden="true" className="status-dot" />
              <span>PoB 연결</span>
            </div>
          ) : (
            <button
              aria-expanded={selectorOpen}
              aria-haspopup={targets.length > 1 ? "listbox" : undefined}
              aria-label="PoB 연결하기"
              className="connection-status disconnected"
              onClick={() => void startConnection()}
              type="button"
            >
              <span aria-hidden="true" className="status-dot" />
              <span>{connectionRequested ? "PoB 연결하기" : "PoB 연결"}</span>
            </button>
          )}
          {targets.length > 1 && selectorOpen && !selectedTarget && (
            <div aria-label="연결할 PoB 선택" className="target-menu" role="listbox">
              {targets.map((target) => {
                const name = target.buildName ?? "PoB";
                const label = duplicateNames.has(target.buildName ?? "") ? `${name} · PID ${target.pid}` : name;
                return (
                  <button
                    aria-selected={target.pid === selectedPid}
                    className="target-option"
                    key={target.pid}
                    onClick={() => void selectTarget(target.pid)}
                    role="option"
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </footer>
    </main>
  );
}

type PobTarget = {
  pid: number;
  buildName: string | null;
};
