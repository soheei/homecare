import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * 채팅 상태 (메시지 + conversationId)
 * - ChatScreen이 unmount/remount 되어도 유지 (Provider가 로그인 세션 동안 살아 있음)
 * - 새로고침 대비로 sessionStorage에 사용자별로 저장 (탭을 닫거나 로그아웃하면 사라짐)
 * - 전송도 여기서 처리해서, 답변을 기다리는 중에 다른 탭으로 가도 답변이 유실되지 않음
 */
const ChatContext = createContext(null);

const STORAGE_PREFIX = 'homecare.chat.';

function formatTime(date) {
  const h = date.getHours();
  const period = h < 12 ? '오전' : '오후';
  const h12 = h % 12 || 12;
  return `${period} ${h12}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function initialChat() {
  return {
    messages: [
      { role: 'ai', text: '안녕하세요! HOME-TALK AI입니다.\n집에 대해 무엇이든 물어보세요.', time: formatTime(new Date()) }
    ],
    conversationId: null
  };
}

function readStored(key) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key));
    if (parsed && Array.isArray(parsed.messages) && parsed.messages.length > 0) return parsed;
  } catch {
    // 저장소 접근 불가/손상 시 새 대화로 시작
  }
  return null;
}

/** 로그아웃 시 이 탭에 저장된 모든 사용자의 채팅 삭제 */
export function clearStoredChats() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // 저장소 접근 불가 시 무시
  }
}

export function ChatProvider({ userId, children }) {
  const storageKey = `${STORAGE_PREFIX}${userId}`;
  const [chat, setChat] = useState(() => readStored(storageKey) || initialChat());
  const [sending, setSending] = useState(false);

  // send()가 항상 최신 conversationId/전송 여부를 보도록 ref로도 들고 있음
  const conversationIdRef = useRef(chat.conversationId);
  const sendingRef = useRef(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(chat));
    } catch {
      // 저장 실패해도 메모리 상태로는 계속 동작
    }
  }, [storageKey, chat]);

  const addMessage = (message) =>
    setChat((prev) => ({ ...prev, messages: [...prev.messages, message] }));

  const send = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    addMessage({ role: 'user', text: trimmed, time: formatTime(new Date()) });
    try {
      const res = await api.chat.sendMessage(trimmed, conversationIdRef.current);
      conversationIdRef.current = res.conversationId;
      setChat((prev) => ({
        conversationId: res.conversationId,
        messages: [...prev.messages, { role: 'ai', text: res.message, time: formatTime(new Date()) }]
      }));
    } catch (err) {
      addMessage({ role: 'ai', text: `오류가 발생했습니다: ${err.message}`, time: formatTime(new Date()) });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, []);

  return (
    <ChatContext.Provider value={{ messages: chat.messages, sending, send }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
