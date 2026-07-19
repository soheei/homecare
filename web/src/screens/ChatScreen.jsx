import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { C } from '../theme';

const QUICK_ACTIONS = ['오늘 요약', '방문자 확인', '위험 알림', '카메라 상태'];

function formatTime(date) {
  const h = date.getHours();
  const period = h < 12 ? '오전' : '오후';
  const h12 = h % 12 || 12;
  return `${period} ${h12}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function ChatScreen() {
  const [messages, setMessages] = useState([
    { role: 'ai', text: '안녕하세요! HOME-TALK AI입니다.\n부모님 집에 대해 무엇이든 물어보세요.', time: formatTime(new Date()) }
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 56px)' }}>
      <div style={{ background: C.card, padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 5 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg,${C.primary},${C.primaryLight})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20 }}>🤖</div>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, margin: 0 }}>HOME-TALK AI</h3>
          <div style={{ fontSize: 13, color: C.success }}>● 온라인</div>
        </div>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            maxWidth: '80%', padding: '14px 16px', borderRadius: 18, fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap',
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            background: m.role === 'user' ? C.primary : C.card,
            color: m.role === 'user' ? '#fff' : C.text,
            boxShadow: m.role === 'user' ? 'none' : '0 2px 8px rgba(42,95,127,0.08)',
            borderBottomRightRadius: m.role === 'user' ? 6 : 18,
            borderBottomLeftRadius: m.role === 'ai' ? 6 : 18
          }}>
            <div>{m.text}</div>
            <div style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>{m.time}</div>
          </div>
        ))}
        {sending && <div style={{ color: C.textLight, fontSize: 13 }}>AI가 응답 중...</div>}
        <div ref={scrollRef} />
      </div>

      <div style={{ padding: '12px 20px', display: 'flex', gap: 8, overflowX: 'auto' }}>
        {QUICK_ACTIONS.map((q) => (
          <div key={q} onClick={() => send(q)}
            style={{ padding: '10px 16px', borderRadius: 20, background: C.card, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {q}
          </div>
        ))}
      </div>

      <div style={{ position: 'sticky', bottom: 70, background: C.card, borderTop: `1px solid ${C.border}`, padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(input); }}
          placeholder="메시지를 입력하세요..."
          style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 20, padding: '11px 16px', fontSize: 14, color: C.text, outline: 'none', background: C.bg }}
        />
        <button onClick={() => send(input)} aria-label="전송"
          style={{ width: 40, height: 40, borderRadius: '50%', background: C.primary, color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>
          ➤
        </button>
      </div>
    </div>
  );
}
