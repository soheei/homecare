import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import ChatHistoryDrawer from '../components/ChatHistoryDrawer';
import AiMessage from '../components/chat/AiMessage';

const QUICK_ACTIONS = [
  { icon: '📊', label: '오늘 요약' },
  { icon: '📅', label: '이번주 요약' },
  { icon: '🚪', label: '방문자 확인' },
  { icon: '🚨', label: '위험 알림' },
  { icon: '📷', label: '카메라 상태' }
];

export default function ChatScreen() {
  // 메시지/전송 상태는 ChatContext에 있어서 화면을 나갔다 와도 유지됨
  const { messages, sending, send: sendMessage, newConversation } = useChat();
  const [input, setInput] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const scrollRef = useRef(null);
  const prevFirstMessage = useRef(null);

  // 화면에 그리기 전에(useLayoutEffect) 스크롤 위치를 맞춘다
  // - 채팅 화면 진입 / 대화 전환(새 채팅·이전 대화 열기): 애니메이션 없이 바로 맨 아래
  //   (html의 scroll-behavior: smooth를 덮어쓰도록 behavior: 'instant')
  // - 대화 중 새 메시지 추가: 기존처럼 부드럽게 스크롤
  useLayoutEffect(() => {
    const first = messages[0];
    // 새 메시지는 끝에만 붙으므로 첫 메시지가 같으면 같은 대화에 추가된 것
    const isEntryOrSwitch = prevFirstMessage.current !== first;
    prevFirstMessage.current = first;

    if (isEntryOrSwitch) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    } else {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const send = (text) => {
    if (!text.trim() || sending) return;
    setInput('');
    sendMessage(text);
  };

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col">
      <div className="sticky top-0 z-[5] flex items-center gap-3 border-b border-black/5 bg-white/90 py-4 pl-3 pr-4 backdrop-blur-lg">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="채팅 기록"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-ink transition-colors hover:bg-black/[0.04]"
        >
          ☰
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-xl text-white">
          🤖
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[16px] font-semibold text-ink">HOME-TALK AI</h3>
          <div className="text-[13px] text-success">● 온라인</div>
        </div>
        <button
          type="button"
          onClick={newConversation}
          disabled={sending}
          aria-label="새 채팅"
          title="새 채팅"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg text-ink transition-colors hover:bg-black/[0.04] disabled:opacity-40"
        >
          ✎
        </button>
      </div>

      <ChatHistoryDrawer open={drawerOpen} onClose={closeDrawer} />

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-5 pb-36">
        {messages.map((m, i) => (
          m.role === 'ai' ? (
            // AI 응답은 블록 단위로 분리해 텍스트는 말풍선, 장치/이벤트/경고 등은 카드로 렌더링
            <AiMessage key={i} text={m.text} time={m.time} />
          ) : (
            <div key={i} className="flex max-w-full items-end gap-2 self-end">
              <div className="max-w-[240px] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-brand-600 px-4 py-3.5 text-[15px] leading-relaxed text-white shadow-md shadow-brand-900/20 [overflow-wrap:anywhere]">
                <div>{m.text}</div>
                <div className="mt-1.5 text-[11px] opacity-60">{m.time}</div>
              </div>
            </div>
          )
        ))}
        {sending && (
          <div className="flex items-center gap-2 self-start">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs text-white">
              🤖
            </div>
            <div className="flex gap-1 rounded-full border border-black/5 bg-white px-4 py-3 shadow-sm shadow-brand-900/[0.04]">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-light [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-light [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-light" />
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <div className="fixed bottom-[70px] left-1/2 z-10 w-full max-w-[430px] -translate-x-1/2 border-t border-black/5 bg-white/95 backdrop-blur-lg">
        <div className="flex gap-2 overflow-x-auto px-5 py-3">
          {QUICK_ACTIONS.map((q) => (
            <button
              key={q.label}
              onClick={() => send(q.label)}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-black/10 bg-white px-4 py-2.5 text-[13px] font-medium text-ink transition-all hover:border-brand-300 hover:bg-brand-50 active:scale-95"
            >
              <span>{q.icon}</span>
              <span>{q.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 border-t border-black/5 px-4 py-2.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(input); }}
            placeholder="메시지를 입력하세요..."
            className="flex-1 rounded-full border border-black/10 bg-[#f2f4f6] px-4 py-2.5 text-sm text-ink outline-none transition focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-400/10"
          />
          <button
            onClick={() => send(input)}
            aria-label="전송"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-none bg-brand-600 text-base text-white shadow-md shadow-brand-900/25 transition-transform active:scale-90"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
