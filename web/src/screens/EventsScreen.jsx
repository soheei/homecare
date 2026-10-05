import { useCallback, useEffect, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { EVENT_ICON, RISK_FROM_LEVEL, formatRelativeTime, hasPlayableMedia } from '../lib/eventDisplay';
import EventMediaModal from '../components/EventMediaModal';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'high', label: '🔴 높음' },
  { key: 'mid', label: '🟡 중간' },
  { key: 'low', label: '🟢 낮음' }
];

const RISK_TO_LEVEL = { high: 'danger', mid: 'warning', low: 'normal' };

const HEADER_BUTTON = 'flex h-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white/70 transition-transform active:scale-90';

function CheckCircle({ checked }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-black/20 bg-white'
      }`}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </span>
  );
}

export default function EventsScreen() {
  // 이벤트 목록은 AppDataContext에 캐시되어 탭을 오가도 다시 불러오지 않음
  const { eventList, loadEventList, deleteEvent, deleteEvents } = useAppData();
  const [filter, setFilter] = useState('all');
  const [deletingId, setDeletingId] = useState(null);
  // 휴지통 버튼 → 선택 모드: 카드를 눌러 고른 뒤 선택 삭제 또는 전체 삭제
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // 영상/소리 재생 팝업에 띄울 이벤트
  const [mediaEvent, setMediaEvent] = useState(null);
  const closeMedia = useCallback(() => setMediaEvent(null), []);

  // 이미 불러온 상태면 loadEventList()는 아무것도 하지 않음
  useEffect(() => {
    loadEventList();
  }, [loadEventList]);

  const events = eventList.data ?? [];
  const loading = !eventList.data && (eventList.status === 'idle' || eventList.status === 'loading');
  const refreshing = !!eventList.data && eventList.status === 'loading';
  const error = eventList.error;

  const handleRefresh = () => loadEventList(true);

  const filtered = filter === 'all'
    ? events
    : events.filter((e) => e.danger_level === RISK_TO_LEVEL[filter]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  // 보이지 않는 이벤트가 선택된 채로 지워지지 않도록 필터를 바꾸면 선택을 비움
  const changeFilter = (key) => {
    setFilter(key);
    setSelected(new Set());
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((e) => e.id)));
  };

  const handleDelete = async (id) => {
    if (!window.confirm('이 이벤트를 삭제하시겠습니까?')) return;
    setDeletingId(id);
    try {
      await deleteEvent(id);
    } catch (err) {
      alert(err.message || '이벤트 삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  /** ids를 주면 선택 삭제, 생략하면 전체 삭제 */
  const handleBulkDelete = async (ids) => {
    const message = ids
      ? `선택한 이벤트 ${ids.length}개를 삭제하시겠습니까?`
      : '모든 이벤트를 삭제하시겠습니까?';
    if (!window.confirm(`${message}\n삭제한 이벤트는 되돌릴 수 없습니다.`)) return;
    setBulkDeleting(true);
    try {
      await deleteEvents(ids);
      exitSelectMode();
    } catch (err) {
      alert(err.message || '이벤트 삭제에 실패했습니다.');
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div>
      <div className="grain-surface flex items-start justify-between bg-brand-600 px-5 pb-6 pt-6 text-white">
        <div>
          <div className="text-2xl font-bold tracking-tight">이벤트</div>
          <div className="mt-1 text-sm opacity-80">감지된 활동을 한눈에 확인하세요</div>
        </div>
        <div className="mt-1 flex shrink-0 gap-2">
          {selectMode ? (
            <button
              type="button"
              onClick={exitSelectMode}
              disabled={bulkDeleting}
              className={`${HEADER_BUTTON} px-4 text-[13px] font-semibold text-white disabled:opacity-60`}
            >
              취소
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              disabled={events.length === 0}
              aria-label="이벤트 삭제"
              className={`${HEADER_BUTTON} w-9 disabled:opacity-40`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || bulkDeleting}
            aria-label="이벤트 새로고침"
            className={`${HEADER_BUTTON} w-9 disabled:opacity-60`}
          >
            <svg
              className={refreshing ? 'animate-spin' : ''}
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="sticky top-0 z-[5] border-b border-black/5 bg-white/90 backdrop-blur-lg">
        <div className="flex gap-2 overflow-x-auto px-5 py-3.5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => changeFilter(f.key)}
                className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-all active:scale-95 ${
                  active ? 'bg-brand-600 text-white shadow-md shadow-brand-900/25' : 'bg-[#f2f4f6] text-ink hover:bg-[#e9ecef]'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {selectMode && (
          <div className="flex items-center justify-between px-5 pb-3">
            <button
              type="button"
              onClick={toggleSelectAll}
              disabled={filtered.length === 0}
              className="flex items-center gap-2 text-[13px] font-semibold text-ink disabled:opacity-40"
            >
              <CheckCircle checked={allFilteredSelected} />
              전체 선택
            </button>
            <span className="text-[13px] text-ink-light">{selected.size}개 선택됨</span>
          </div>
        )}
      </div>

      <div className="px-5 pt-5">
        {loading && <div className="text-sm text-ink-light">불러오는 중...</div>}
        {error && <div className="text-sm text-danger">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 py-8 text-center text-sm text-ink-light">
            해당 조건의 이벤트가 없습니다.
          </div>
        )}
        {filtered.map((e) => {
          const disp = EVENT_ICON[e.type] || EVENT_ICON.other;
          const risk = RISK_FROM_LEVEL[e.danger_level] || RISK_FROM_LEVEL.normal;
          const checked = selected.has(e.id);
          const playable = !selectMode && hasPlayableMedia(e);
          const onCardClick = selectMode
            ? () => toggleSelect(e.id)
            : playable ? () => setMediaEvent(e) : undefined;
          return (
            <div
              key={e.id}
              onClick={onCardClick}
              onKeyDown={playable ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setMediaEvent(e); } } : undefined}
              role={selectMode ? 'checkbox' : playable ? 'button' : undefined}
              tabIndex={playable ? 0 : undefined}
              aria-checked={selectMode ? checked : undefined}
              aria-label={playable ? `${e.description} 재생` : undefined}
              className={`mb-3 flex gap-3.5 rounded-2xl border bg-white p-4 shadow-sm shadow-brand-900/[0.04] transition-transform ${
                selectMode || playable ? 'cursor-pointer active:scale-[0.99]' : ''
              } ${selectMode ? '' : 'hover:-translate-y-0.5'} ${checked ? 'border-brand-400 bg-brand-50' : 'border-black/5'}`}
              style={{ borderLeft: `4px solid ${risk.border}` }}
            >
              {selectMode && (
                <div className="flex items-center">
                  <CheckCircle checked={checked} />
                </div>
              )}
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: disp.bg }}>
                {disp.icon}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center">
                  <span className="text-[15px] font-semibold text-ink">{e.description}</span>
                  <span
                    className="ml-2 inline-block rounded-[10px] px-2.5 py-[3px] text-[11px] font-bold"
                    style={{ background: risk.badgeBg, color: risk.badgeColor }}
                  >
                    {risk.label}
                  </span>
                </div>
                <div className="mt-1.5 text-xs text-ink-light">
                  {new Date(e.timestamp).toLocaleString('ko-KR')} • {formatRelativeTime(e.timestamp)}
                </div>
                {hasPlayableMedia(e) && (
                  <div className="mt-2 flex gap-1.5">
                    {e.video_url && (
                      <span className="rounded-md bg-brand-50 px-2 py-[3px] text-[11px] font-semibold text-brand-600">▶ 영상</span>
                    )}
                    {!e.video_url && e.audio_url && (
                      <span className="rounded-md bg-brand-50 px-2 py-[3px] text-[11px] font-semibold text-brand-600">🔊 소리</span>
                    )}
                  </div>
                )}
              </div>
              {!selectMode && (
                <button
                  type="button"
                  onClick={(ev) => { ev.stopPropagation(); handleDelete(e.id); }}
                  onKeyDown={(ev) => ev.stopPropagation()}
                  disabled={deletingId === e.id}
                  aria-label="이벤트 삭제"
                  className="h-7 w-7 shrink-0 self-start rounded-full text-lg leading-none text-ink-light transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      {/* 선택 모드 하단 작업 바에 마지막 카드가 가려지지 않도록 */}
      <div className={selectMode ? 'h-24' : 'h-5'} />

      {selectMode && (
        <div className="fixed bottom-[82px] left-1/2 z-20 flex w-full max-w-[430px] -translate-x-1/2 gap-2 border-t border-black/5 bg-white/95 px-5 py-3 backdrop-blur-lg">
          <button
            type="button"
            onClick={() => handleBulkDelete()}
            disabled={bulkDeleting || events.length === 0}
            className="flex-1 rounded-xl border border-danger/30 bg-white py-3 text-[14px] font-bold text-danger transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            전체 삭제
          </button>
          <button
            type="button"
            onClick={() => handleBulkDelete([...selected])}
            disabled={bulkDeleting || selected.size === 0}
            className="flex-1 rounded-xl bg-danger py-3 text-[14px] font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {bulkDeleting ? '삭제 중...' : `선택 삭제${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      )}

      <EventMediaModal event={mediaEvent} onClose={closeMedia} onRefresh={handleRefresh} />

    </div>
  );
}
