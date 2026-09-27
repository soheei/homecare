import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * 채팅 상태 (현재 대화의 메시지 + conversationId) + 대화 목록
 * - ChatScreen이 unmount/remount 되어도 유지 (Provider가 로그인 세션 동안 살아 있음)
 * - 현재 대화는 새로고침 대비로 sessionStorage에 사용자별로 저장 (탭을 닫거나 로그아웃하면 사라짐)
 * - 대화 목록/이전 대화는 서버(conversations/messages, 로그인 사용자 것만)에서 불러옴
 * - 전송도 여기서 처리해서, 답변을 기다리는 중에 다른 탭으로 가도 답변이 유실되지 않음
 */
const ChatContext = createContext(null);

const STORAGE_PREFIX = 'homecare.chat.';
const TITLE_MAX_LENGTH = 40; // 백엔드 conversation.service.js의 제목 길이와 동일

function formatTime(date) {
  const h = date.getHours();
  const period = h < 12 ? '오전' : '오후';
  const h12 = h % 12 || 12;
  return `${period} ${h12}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function makeTitle(message) {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > TITLE_MAX_LENGTH ? `${oneLine.slice(0, TITLE_MAX_LENGTH)}…` : oneLine;
}

function initialChat() {
  return {
    messages: [
      { role: 'ai', text: '안녕하세요! HOME-TALK AI입니다.\n집에 대해 무엇이든 물어보세요.', time: formatTime(new Date()) }
    ],
    conversationId: null
  };
}

/** 서버 메시지(role: user/assistant) → 화면 메시지(role: user/ai) */
function toViewMessage(m) {
  return {
    role: m.role === 'assistant' ? 'ai' : 'user',
    text: m.content,
    time: formatTime(new Date(m.created_at))
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
  const [openingId, setOpeningId] = useState(null); // 불러오는 중인 이전 대화 id
  const [conversations, setConversations] = useState({ status: 'idle', data: [], error: '' }); // idle | loading | done | error

  // 비동기 함수들이 항상 최신 값을 보도록 ref로도 들고 있음
  const conversationIdRef = useRef(chat.conversationId);
  const sendingRef = useRef(false);
  const listRequested = useRef(false);
  const openRequest = useRef(0);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(chat));
    } catch {
      // 저장 실패해도 메모리 상태로는 계속 동작
    }
  }, [storageKey, chat]);

  const setCurrent = (next) => {
    conversationIdRef.current = next.conversationId;
    setChat(next);
  };

  /** 대화 목록은 처음 한 번만 불러오고, 이후엔 전송/삭제 때 목록을 직접 갱신 */
  const loadConversations = useCallback(async () => {
    if (listRequested.current) return;
    listRequested.current = true;
    setConversations((prev) => ({ ...prev, status: 'loading', error: '' }));
    try {
      const data = await api.chat.getHistory({ limit: 50 });
      setConversations({ status: 'done', data: data.conversations || [], error: '' });
    } catch (err) {
      listRequested.current = false; // 실패하면 다음에 다시 시도
      setConversations((prev) => ({ ...prev, status: 'error', error: err.message }));
    }
  }, []);

  /** 전송 성공 시 목록 맨 위로 올리기 (새 대화면 첫 질문을 제목으로 추가) */
  const touchConversation = (id, firstMessage) => {
    if (!listRequested.current) return; // 아직 목록을 안 불러왔으면 나중에 서버에서 최신으로 받음
    setConversations((prev) => {
      const existing = prev.data.find((c) => c.id === id);
      const updated = existing
        ? { ...existing, updated_at: new Date().toISOString() }
        : { id, title: makeTitle(firstMessage), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      return { ...prev, data: [updated, ...prev.data.filter((c) => c.id !== id)] };
    });
  };

  const send = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setChat((prev) => ({ ...prev, messages: [...prev.messages, { role: 'user', text: trimmed, time: formatTime(new Date()) }] }));
    try {
      const res = await api.chat.sendMessage(trimmed, conversationIdRef.current);
      conversationIdRef.current = res.conversationId;
      setChat((prev) => ({
        conversationId: res.conversationId,
        messages: [...prev.messages, { role: 'ai', text: res.message, time: formatTime(new Date()) }]
      }));
      touchConversation(res.conversationId, trimmed);
    } catch (err) {
      setChat((prev) => ({
        ...prev,
        messages: [...prev.messages, { role: 'ai', text: `오류가 발생했습니다: ${err.message}`, time: formatTime(new Date()) }]
      }));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, []);

  /** 새 채팅 (답변 대기 중에는 전환하지 않음 — 답변이 다른 대화에 붙는 것 방지) */
  const newConversation = useCallback(() => {
    if (sendingRef.current) return false;
    openRequest.current++; // 진행 중인 이전 대화 불러오기 무시
    setOpeningId(null);
    setCurrent(initialChat());
    return true;
  }, []);

  /** 이전 대화 열기 */
  const openConversation = useCallback(async (id) => {
    if (sendingRef.current) return false;
    if (id === conversationIdRef.current) return true;
    const requestId = ++openRequest.current;
    setOpeningId(id);
    try {
      const data = await api.chat.getHistory({ conversationId: id });
      if (requestId !== openRequest.current) return false; // 그 사이 다른 대화를 골랐으면 무시
      const messages = (data.messages || []).map(toViewMessage);
      setCurrent({ conversationId: id, messages: messages.length ? messages : initialChat().messages });
      return true;
    } finally {
      if (requestId === openRequest.current) setOpeningId(null);
    }
  }, []);

  /** 대화 삭제 (지금 보고 있는 대화면 새 채팅으로) */
  const deleteConversation = useCallback(async (id) => {
    if (id === conversationIdRef.current && sendingRef.current) return false;
    await api.chat.deleteConversation(id);
    setConversations((prev) => ({ ...prev, data: prev.data.filter((c) => c.id !== id) }));
    if (id === conversationIdRef.current) {
      openRequest.current++;
      setCurrent(initialChat());
    }
    return true;
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages: chat.messages,
        conversationId: chat.conversationId,
        sending,
        openingId,
        send,
        conversations,
        loadConversations,
        newConversation,
        openConversation,
        deleteConversation
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
