import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { api } from '../lib/api';

/**
 * 홈/이벤트 화면 데이터 캐시
 * - 탭 전환으로 화면이 unmount/remount 되어도 데이터를 유지하고, 세션 동안 한 번만 불러온다
 * - 이벤트 삭제처럼 데이터가 바뀌는 경우에만 캐시를 갱신한다
 */
const AppDataContext = createContext(null);

const IDLE = { status: 'idle', data: null, error: '' }; // idle | loading | done | error

async function fetchHome() {
  const [eventsData, devicesData] = await Promise.all([
    api.events.list({ limit: 3 }),
    api.devices.list()
  ]);
  const data = {
    events: eventsData.events || [],
    devices: devicesData || [],
    dangerCount: 0,
    todayCount: 0,
    error: ''
  };
  // 요약 조회가 실패해도 최근 이벤트/기기는 보여준다 (기존 동작 유지)
  try {
    // 사용자 기기 기준 오늘 (toISOString()은 UTC라 한국 00~09시에 전날 날짜가 됨)
    const today = new Date().toLocaleDateString('sv-SE');
    const daily = await api.events.getDailySummary(today);
    data.dangerCount = daily?.dangerEvents?.length ?? 0;
    data.todayCount = daily?.totalEvents ?? 0;
  } catch (err) {
    data.error = err.message;
  }
  return data;
}

async function fetchEventList() {
  const data = await api.events.list({ limit: 50 });
  return data.events || [];
}

export function AppDataProvider({ children }) {
  const [home, setHome] = useState(IDLE);
  const [eventList, setEventList] = useState(IDLE);
  const [briefing, setBriefing] = useState({ status: 'empty', data: null, error: '' }); // empty | loading | done | error

  // 이미 불러왔거나 불러오는 중인 리소스 표시 (StrictMode 이중 실행/빠른 탭 전환에도 중복 호출 방지)
  const requested = useRef({});

  const load = useCallback((key, fetcher, setResource) => {
    if (requested.current[key]) return;
    requested.current[key] = true;
    // 갱신 중에도 기존 데이터는 계속 보여준다
    setResource((prev) => ({ ...prev, status: 'loading', error: '' }));
    fetcher()
      .then((data) => setResource({ status: 'done', data, error: '' }))
      .catch((err) => {
        delete requested.current[key]; // 실패하면 다음 진입 때 다시 시도
        setResource((prev) => ({ ...prev, status: 'error', error: err.message }));
      });
  }, []);

  const loadHome = useCallback(() => load('home', fetchHome, setHome), [load]);
  const loadEventList = useCallback(() => load('eventList', fetchEventList, setEventList), [load]);

  const deleteEvent = useCallback(async (id) => {
    await api.events.delete(id);
    setEventList((prev) => (prev.data ? { ...prev, data: prev.data.filter((e) => e.id !== id) } : prev));
    setHome((prev) => (prev.data ? { ...prev, data: { ...prev.data, events: prev.data.events.filter((e) => e.id !== id) } } : prev));
    // 오늘 이벤트/위험 건수가 바뀌었을 수 있으니 다음 홈 진입 때 다시 불러온다
    delete requested.current.home;
  }, []);

  const generateBriefing = useCallback(async () => {
    setBriefing((prev) => ({ ...prev, status: 'loading', error: '' }));
    try {
      const data = await api.chat.getDailySummary();
      setBriefing({ status: 'done', data, error: '' });
    } catch (err) {
      setBriefing({ status: 'error', data: null, error: err.message || '브리핑을 만들지 못했어요.' });
    }
  }, []);

  return (
    <AppDataContext.Provider value={{ home, loadHome, eventList, loadEventList, deleteEvent, briefing, generateBriefing }}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
