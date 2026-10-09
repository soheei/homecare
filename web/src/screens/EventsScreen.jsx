import { useCallback, useEffect, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { EVENT_ICON, RISK_FROM_LEVEL, formatRelativeTime, hasPlayableMedia } from '../lib/eventDisplay';
import EventMediaModal from '../components/EventMediaModal';
import Icon from '../components/Icon';
import ScreenHeader, { HeaderButton } from '../components/ScreenHeader';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'high', label: '높음', dot: 'bg-danger' },
  { key: 'mid', label: '중간', dot: 'bg-warning' },
  { key: 'low', label: '낮음', dot: 'bg-success' }
];

const RISK_TO_LEVEL = { high: 'danger', mid: 'warning', low: 'normal' };

function CheckCircle({ checked }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-black/20 bg-white'
      }`}
    >
      {checked && <Icon name="check" size={13} strokeWidth={3.5} />}
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
      <ScreenHeader
        title="이벤트"
        subtitle="감지된 활동을 한눈에 확인하세요"
        right={
          <>
            {selectMode ? (
              <HeaderButton text="취소" onClick={exitSelectMode} disabled={bulkDeleting} />
            ) : (
              <HeaderButton icon="trash" label="이벤트 삭제" onClick={() => setSelectMode(true)} disabled={events.length === 0} />
            )}
            <HeaderButton icon="refresh" label="이벤트 새로고침" onClick={handleRefresh} disabled={refreshing || bulkDeleting} spin={refreshing} />
          </>
        }
      />

      <div className="sticky top-0 z-[5] bg-[#f7f8fa]/90 backdrop-blur-lg">
        <div className="flex gap-2 overflow-x-auto px-5 py-3.5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => changeFilter(f.key)}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-[13px] font-semibold transition-all active:scale-95 ${
                  active ? 'border-brand-600 bg-brand-600 text-white' : 'border-black/[0.07] bg-white text-ink hover:bg-brand-50'
                }`}
              >
                {f.dot && <span className={`h-2 w-2 rounded-full ${f.dot}`} />}
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
          <div className="rounded-[20px] border border-dashed border-black/10 bg-white/60 py-8 text-center text-sm text-ink-light">
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
              className={`mb-3 flex gap-3.5 rounded-[20px] border-[1.5px] bg-white p-3.5 shadow-lg shadow-brand-900/[0.06] transition-colors ${
                selectMode || playable ? 'cursor-pointer active:scale-[0.99]' : ''
              } ${checked ? 'border-brand-500 bg-brand-50' : e.danger_level === 'danger' ? 'border-danger/40' : 'border-black/[0.07]'}`}
            >
              {selectMode && (
                <div className="flex items-center">
                  <CheckCircle checked={checked} />
                </div>
              )}
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: disp.bg, color: disp.fg }}>
                <Icon name={disp.icon} size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start">
                  <span className="min-w-0 text-sm font-bold text-ink [overflow-wrap:anywhere]">{e.description}</span>
                  <span
                    className="ml-2 inline-block shrink-0 whitespace-nowrap rounded-[10px] px-2.5 py-[3px] text-[11px] font-bold"
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
                      <span className="flex items-center gap-1 rounded-md bg-brand-100 px-2 py-[3px] text-[11px] font-semibold text-brand-600"><Icon name="play" size={11} />영상</span>
                    )}
                    {!e.video_url && e.audio_url && (
                      <span className="flex items-center gap-1 rounded-md bg-brand-100 px-2 py-[3px] text-[11px] font-semibold text-brand-600"><Icon name="volume" size={11} />소리</span>
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
                  className="flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-full text-ink-light transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                >
                  <Icon name="close" size={15} />
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
            className="flex-1 rounded-2xl border border-danger/30 bg-white py-3 text-[14px] font-bold text-danger transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            전체 삭제
          </button>
          <button
            type="button"
            onClick={() => handleBulkDelete([...selected])}
            disabled={bulkDeleting || selected.size === 0}
            className="flex-1 rounded-2xl bg-danger py-3 text-[14px] font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {bulkDeleting ? '삭제 중...' : `선택 삭제${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      )}

      <EventMediaModal event={mediaEvent} onClose={closeMedia} onRefresh={handleRefresh} />

    </div>
  );
}
