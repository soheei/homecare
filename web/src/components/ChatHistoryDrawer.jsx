import { useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import { formatRelativeTime } from '../lib/eventDisplay';

/**
 * 채팅 기록 서랍 (Claude 모바일 앱처럼 왼쪽에서 열림)
 * 로그인한 계정의 대화만 보이고, 열기/새 채팅/삭제를 여기서 한다.
 */
export default function ChatHistoryDrawer({ open, onClose }) {
  const { user } = useAuth();
  const {
    conversations, loadConversations, conversationId, sending, openingId,
    newConversation, openConversation, deleteConversation
  } = useChat();
  const [deletingId, setDeletingId] = useState(null);

  // 처음 열 때 한 번만 목록을 불러옴 (이미 불러왔으면 아무것도 안 함)
  useEffect(() => {
    if (open) loadConversations();
  }, [open, loadConversations]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleNew = () => {
    if (newConversation()) onClose();
  };

  const handleOpen = async (id) => {
    try {
      if (await openConversation(id)) onClose();
    } catch (err) {
      alert(err.message || '대화를 불러오지 못했어요.');
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('이 대화를 삭제할까요?\n삭제하면 되돌릴 수 없어요.')) return;
    setDeletingId(id);
    try {
      await deleteConversation(id);
    } catch (err) {
      alert(err.message || '대화를 삭제하지 못했어요.');
    } finally {
      setDeletingId(null);
    }
  };

  const list = conversations.data;

  return (
    <div
      className={`fixed inset-0 z-40 flex justify-center ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div className="relative h-full w-full max-w-[430px] overflow-hidden">
        <div
          onClick={onClose}
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
        />

        <aside
          role="dialog"
          aria-label="채팅 기록"
          className={`absolute inset-y-0 left-0 flex w-[84%] flex-col bg-white transition-transform duration-200 ease-out ${
            // 닫혀 있을 때 그림자가 화면 왼쪽 가장자리에 띠처럼 비치지 않도록 열렸을 때만 그림자
            open ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between px-5 pb-3 pt-5">
            <span className="text-lg font-bold tracking-tight text-ink">HOME-TALK</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-ink-light transition-colors hover:bg-black/[0.04]"
            >
              ✕
            </button>
          </div>

          <div className="px-4">
            <button
              type="button"
              onClick={handleNew}
              disabled={sending}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-semibold text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-40"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-base text-white">＋</span>
              새 채팅
            </button>
          </div>

          <div className="mx-5 mb-1 mt-4 text-xs font-semibold text-ink-light">최근</div>

          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {conversations.status === 'loading' && list.length === 0 && (
              <div className="px-3 py-4 text-sm text-ink-light">불러오는 중...</div>
            )}
            {conversations.status === 'error' && (
              <div className="px-3 py-4 text-sm text-danger">{conversations.error}</div>
            )}
            {conversations.status === 'done' && list.length === 0 && (
              <div className="px-3 py-4 text-sm leading-relaxed text-ink-light">
                아직 대화 기록이 없어요.<br />첫 질문을 보내면 여기에 저장돼요.
              </div>
            )}

            {list.map((c) => {
              const active = c.id === conversationId;
              const loading = openingId === c.id;
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpen(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(c.id); }}
                  aria-current={active ? 'true' : undefined}
                  className={`group mb-0.5 flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 transition-colors ${
                    active ? 'bg-brand-50' : 'hover:bg-black/[0.03]'
                  } ${sending && !active ? 'pointer-events-none opacity-40' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[15px] ${active ? 'font-semibold text-brand-600' : 'text-ink'}`}>
                      {c.title || '제목 없는 대화'}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-light">
                      {loading ? '불러오는 중...' : formatRelativeTime(c.updated_at || c.created_at)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, c.id)}
                    disabled={deletingId === c.id || (active && sending)}
                    aria-label="대화 삭제"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-light transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 border-t border-black/5 px-5 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
              {user?.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="min-w-0 truncate text-sm text-ink">{user?.email}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
