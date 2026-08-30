import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const QUICK_ACTIONS = [
  { icon: '📊', label: '오늘 요약' },
  { icon: '🚪', label: '방문자 확인' },
  { icon: '🚨', label: '위험 알림' },
  { icon: '📷', label: '카메라 상태' }
];

function formatTime(date) {
  const h = date.getHours();
  const period = h < 12 ? '오전' : '오후';
  const h12 = h % 12 || 12;
  return `${period} ${h12}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState([
    { role: 'ai', text: '안녕하세요! HOME-TALK AI입니다.\n집에 대해 무엇이든 물어보세요.', time: formatTime(new Date()) }
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setMessages((m) => [...m, { role: 'user', text: trimmed, time: formatTime(new Date()) }]);
    setInput('');
    setSending(true);
    try {
      const res = await api.chat.sendMessage(trimmed, conversationId);
      setConversationId(res.conversationId);
      setMessages((m) => [...m, { role: 'ai', text: res.message, time: formatTime(new Date()) }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'ai', text: `오류가 발생했습니다: ${err.message}`, time: formatTime(new Date()) }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col">
      <div className="sticky top-0 z-[5] flex items-center gap-3 border-b border-black/5 bg-white/90 px-5 py-4 backdrop-blur-lg">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-xl text-white">
          🤖
        </div>
        <div>
          <h3 className="m-0 text-[16px] font-semibold text-ink">HOME-TALK AI</h3>
          <div className="text-[13px] text-success">● 온라인</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 bg-gradient-to-b from-brand-50/40 to-transparent p-5 pb-36">
        {messages.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.role === 'user' ? 'flex-row-reverse self-end' : 'self-start'}`}>
            {m.role === 'ai' && (
              <div className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs text-white">
                🤖
              </div>
            )}
            <div
              className={`max-w-[240px] whitespace-pre-wrap rounded-[18px] px-4 py-3.5 text-[15px] leading-relaxed ${
                m.role === 'user'
                  ? 'rounded-br-md bg-brand-600 text-white shadow-md shadow-brand-900/20'
                  : 'rounded-bl-md border border-black/5 bg-white text-ink shadow-sm shadow-brand-900/[0.04]'
              }`}
            >
              <div>{m.text}</div>
              <div className="mt-1.5 text-[11px] opacity-60">{m.time}</div>
            </div>
          </div>
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
