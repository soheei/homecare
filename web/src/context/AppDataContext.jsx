import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
  // restoring: 서버에 저장된 마지막 브리핑을 불러오는 중
  const [briefing, setBriefing] = useState({ status: 'restoring', data: null, error: '' }); // restoring | empty | loading | done | error

  // 새로고침해도 마지막 브리핑이 보이도록 서버에서 복원 (브리핑은 만들 때 서버에 저장됨)
  useEffect(() => {
    let cancelled = false;
    api.chat.getLatestSummary()
      .then((data) => {
        if (cancelled) return;
        setBriefing((prev) => (prev.status !== 'restoring' ? prev : data?.summary
          ? { status: 'done', data, error: '' }
          : { status: 'empty', data: null, error: '' }));
      })
      .catch(() => {
        // 복원 실패 시엔 새로 만들 수 있게 빈 상태로
        if (!cancelled) setBriefing((prev) => (prev.status === 'restoring' ? { status: 'empty', data: null, error: '' } : prev));
      });
    return () => { cancelled = true; };
  }, []);

  // 이미 불러왔거나 불러오는 중인 리소스 표시 (StrictMode 이중 실행/빠른 탭 전환에도 중복 호출 방지)
  const requested = useRef({});

  const load = useCallback((key, fetcher, setResource, force = false) => {
    if (requested.current[key] && !force) return;
    requested.current[key] = true;
    // 갱신 중에도 기존 데이터는 계속 보여준다
    setResource((prev) => ({ ...prev, status: 'loading', error: '' }));
    return fetcher()
      .then((data) => setResource({ status: 'done', data, error: '' }))
      .catch((err) => {
        delete requested.current[key]; // 실패하면 다음 진입 때 다시 시도
        setResource((prev) => ({ ...prev, status: 'error', error: err.message }));
      });
  }, []);

  const loadHome = useCallback((force = false) => load('home', fetchHome, setHome, force), [load]);
  const loadEventList = useCallback((force = false) => load('eventList', fetchEventList, setEventList, force), [load]);

  /** 앱 전체 새로고침 (아래로 당겨서 / 새로고침 버튼) — 이미 불러온 홈·이벤트 데이터를 다시 받는다 */
  const refreshAll = useCallback(async () => {
    const tasks = [load('home', fetchHome, setHome, true)];
    if (requested.current.eventList) tasks.push(load('eventList', fetchEventList, setEventList, true));
    await Promise.all(tasks);
  }, [load]);

  const deleteEvent = useCallback(async (id) => {
    await api.events.delete(id);
    setEventList((prev) => (prev.data ? { ...prev, data: prev.data.filter((e) => e.id !== id) } : prev));
    setHome((prev) => (prev.data ? { ...prev, data: { ...prev.data, events: prev.data.events.filter((e) => e.id !== id) } } : prev));
    // 오늘 이벤트/위험 건수가 바뀌었을 수 있으니 다음 홈 진입 때 다시 불러온다
    delete requested.current.home;
  }, []);

  /** ids를 주면 선택한 이벤트만, 생략하면 전체 삭제 */
  const deleteEvents = useCallback(async (ids) => {
    await api.events.deleteMany(ids);
    const keep = ids ? (e) => !ids.includes(e.id) : () => false;
    setEventList((prev) => (prev.data ? { ...prev, data: prev.data.filter(keep) } : prev));
    setHome((prev) => (prev.data ? { ...prev, data: { ...prev.data, events: prev.data.events.filter(keep) } } : prev));
    delete requested.current.home;
  }, []);

  /** 캡처 결과로 알게 된 기기 상태를 홈 카드에 반영 (홈 데이터는 세션 동안 한 번만 불러오므로) */
  const setDeviceStatus = useCallback((id, status) => {
    setHome((prev) => (prev.data
      ? { ...prev, data: { ...prev.data, devices: prev.data.devices.map((d) => (d.id === id ? { ...d, status } : d)) } }
      : prev));
  }, []);

  /** 감지 모드/경비 상태를 홈 카드에 반영 — 서버는 마이크·카메라를 함께 바꾸므로 둘 다 갱신 */
  const setDeviceMode = useCallback(({ mode, securityArmed }) => {
    const patch = {
      ...(mode !== undefined && { mode }),
      ...(securityArmed !== undefined && { security_armed: securityArmed })
    };
    setHome((prev) => (prev.data
      ? {
        ...prev,
        data: {
          ...prev.data,
          devices: prev.data.devices.map((d) => (d.type === 'camera' || d.type === 'microphone' ? { ...d, ...patch } : d))
        }
      }
      : prev));
  }, []);

  const generateBriefing = useCallback(async () => {
    setBriefing((prev) => ({ ...prev, status: 'loading', error: '' }));
    try {
      const data = await api.chat.getDailySummary(); // 서버가 생성과 동시에 저장
      setBriefing({ status: 'done', data, error: '' });
    } catch (err) {
      setBriefing({ status: 'error', data: null, error: err.message || '브리핑을 만들지 못했어요.' });
    }
  }, []);

  return (
    <AppDataContext.Provider value={{ home, loadHome, refreshAll, setDeviceStatus, setDeviceMode, eventList, loadEventList, deleteEvent, deleteEvents, briefing, generateBriefing }}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
