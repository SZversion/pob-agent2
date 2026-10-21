import { useRef, useState } from "react";

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
const pobConnected = false;

function resizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight);
  const maxHeight = lineHeight * 5;
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState(PREVIEW_MESSAGES);
  const [inputValue, setInputValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function sendMessage(): void {
    const text = inputValue.trim();
    if (!text) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "1.4em";
      textareaRef.current.style.overflowY = "hidden";
    }
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
        <button
          aria-label="설정 열기"
          className="settings-button"
          onClick={() => setView("settings")}
          type="button"
        >
          <span aria-hidden="true">⚙</span> 설정
        </button>
      </header>

      <section aria-label="채팅 기록" className="conversation">
        {messages.map((message, index) => (
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
          onChange={(event) => {
            setInputValue(event.currentTarget.value);
            resizeTextarea(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder="무엇이 궁금한가요?"
          ref={textareaRef}
          rows={1}
          value={inputValue}
        />
        <button
          aria-label="전송"
          className="send-button"
          disabled={!inputValue.trim()}
          onClick={sendMessage}
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
        <button
          aria-label="PoB 연결 대상: 샘플 빌드"
          className="build-selector"
          disabled
          type="button"
        >
          <span>샘플 빌드</span>
          <span aria-hidden="true" className="chevron">
            ⌄
          </span>
        </button>
        <div
          aria-label={`PoB 연결 상태: ${pobConnected ? "연결됨" : "연결 안 됨"}`}
          className={`connection-status${pobConnected ? "" : " disconnected"}`}
        >
          <span aria-hidden="true" className="status-dot" />
          <span>PoB 연결</span>
        </div>
      </footer>
    </main>
  );
}
