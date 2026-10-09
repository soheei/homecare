import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENT_ICON, formatRelativeTime } from '../lib/eventDisplay';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useAppData } from '../context/AppDataContext';
import { MarkdownBlocks } from '../components/chat/AiMessage';
import CameraCaptureModal from '../components/CameraCaptureModal';
import Icon from '../components/Icon';
import ScreenHeader, { HeaderButton } from '../components/ScreenHeader';

const CAMERA_OFF_MESSAGE = '카메라가 꺼져 있어 현재 화면을 가져올 수 없습니다.';

// Pi가 1대라 같은 카메라·마이크의 감지 대상을 모드로 바꾼다 (value는 서버 devices.mode 값과 같은 문자열)
const ZONES = [
  { value: 'living', label: '거실', icon: 'sofa' },
  { value: 'entrance', label: '현관', icon: 'door' }
];

// 기기는 한 세트뿐이라 선택된 공간에만 실제 상태를 보여주고, 선택 안 된 공간은 '대기'로 표시한다
const STANDBY = { text: '대기', dot: 'bg-ink-light/50', color: 'text-ink-light' };
const deviceState = (d, onText = '켜짐') => {
  if (!d) return { text: '미등록', dot: 'bg-warning', color: 'text-ink-light' };
  if (d.status === 'online') return { text: onText, dot: 'bg-success', color: 'text-ink' };
  return { text: '꺼짐', dot: 'bg-ink-light/50', color: 'text-ink-light' };
};

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '늦은 밤이네요';
  if (h < 12) return '좋은 아침이에요';
  if (h < 18) return '좋은 오후예요';
  return '편안한 저녁 되세요';
}

export default function HomeScreen() {
  const { user } = useAuth();
  // 데이터/브리핑은 AppDataContext에 캐시되어 탭을 오가도 다시 불러오지 않음
  const { home, loadHome, refreshAll, setDeviceStatus, setDeviceMode, briefing: briefingState, generateBriefing } = useAppData();
  // 현재 카메라 화면: idle | loading | done | off | error — 결과는 "현재 집 상태" 모달로 표시
  const [capture, setCapture] = useState({ status: 'idle', data: null, error: '' });
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const closeCameraModal = useCallback(() => setCameraModalOpen(false), []);
  const capturingRef = useRef(false); // 연속 클릭 시 중복 요청 방지 (state 반영 전 두 번째 클릭까지 막음)
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState('');
  const modeBusyRef = useRef(false);

  // 이미 불러온 상태면 loadHome()은 아무것도 하지 않음
  useEffect(() => {
    loadHome();
  }, [loadHome]);

  const events = home.data?.events ?? [];
  const devices = home.data?.devices ?? [];
  const dangerCount = home.data?.dangerCount ?? 0;
  const todayCount = home.data?.todayCount ?? 0;
  const loading = !home.data && (home.status === 'idle' || home.status === 'loading');
  const error = home.error || home.data?.error || '';

  const briefing = briefingState.data;
  const briefingStatus = briefingState.status; // restoring | empty | loading | done | error
  const briefingError = briefingState.error;

  const cameraDevice = devices.find((d) => d.type === 'camera');
  const micDevice = devices.find((d) => d.type === 'microphone');

  const currentMode = cameraDevice?.mode === 'entrance' ? 'entrance' : 'living';
  const securityArmed = cameraDevice?.security_armed === true;
  const currentZone = ZONES.find((z) => z.value === currentMode);

  /** 거실/현관 모드, 경비 켜기·끄기 — 화면에 먼저 반영하고 서버 저장이 실패하면 되돌린다 (Pi는 최대 20초 뒤 반영) */
  const changeMode = async (patch) => {
    if (modeBusyRef.current || !cameraDevice) return;
    const before = { mode: currentMode, securityArmed };
    modeBusyRef.current = true;
    setModeBusy(true);
    setModeError('');
    setDeviceMode(patch);
    try {
      await api.devices.setMode(patch);
    } catch (err) {
      console.warn('[Home] set mode failed:', err);
      setDeviceMode(before);
      setModeError(err.status === 404 ? '모드를 바꿀 카메라/마이크가 등록돼 있지 않아요.' : '모드를 바꾸지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      modeBusyRef.current = false;
      setModeBusy(false);
    }
  };

  const initial = user?.email?.[0]?.toUpperCase() || '?';

  /** 카메라 카드 클릭 → 라즈베리파이 카메라로 지금 1장 촬영 (상태 판단은 서버가 최신 하트비트로 함) */
  const captureNow = async () => {
    if (capturingRef.current) return;
    if (!cameraDevice) {
      setCapture({ status: 'error', data: null, error: '등록된 카메라가 없어요.' });
      return;
    }
    capturingRef.current = true;
    setCapture((prev) => ({ ...prev, status: 'loading', error: '' }));
    try {
      const data = await api.devices.requestCapture(cameraDevice.id);
      setCapture({ status: 'done', data, error: '' });
      setDeviceStatus(cameraDevice.id, 'online');
    } catch (err) {
      console.warn('[Home] capture failed:', err);
      if (err.status === 409) {
        setCapture({ status: 'off', data: null, error: err.message || CAMERA_OFF_MESSAGE });
        setDeviceStatus(cameraDevice.id, 'offline');
      } else {
        // 서버가 준 사용자용 문구(연결 안 됨/시간 초과/장치 없음 등), 네트워크 오류면 기본 문구
        const friendly = err.status ? err.message : '현재 카메라 화면을 가져오지 못했어요. 카메라 연결 상태를 확인해주세요.';
        setCapture({ status: 'error', data: null, error: friendly });
      }
    } finally {
      capturingRef.current = false;
    }
  };

  const capturing = capture.status === 'loading';

  /** 카메라 카드 → 모달을 먼저 열고(로딩 표시) 촬영 시작. 촬영 중에 다시 열면 진행 중인 결과를 그대로 보여줌 */
  const openCameraModal = () => {
    setCameraModalOpen(true);
    captureNow();
  };

  // 카메라·마이크는 위 공간 카드로 옮겼고, 여기엔 오늘 요약 두 칸만 남긴다
  const cards = [
    { label: '오늘 이벤트', value: `${todayCount}건`, valueColor: 'text-ink' },
    { label: '위험 알림', value: `${dangerCount}건`, valueColor: dangerCount > 0 ? 'text-danger' : 'text-ink', hint: '낙상·화재경보·파손 기준' }
  ];

  return (
    <div>
      <ScreenHeader
        title={greeting()}
        subtitle={`${user?.email ? `${user.email}님, ` : ''}집 상태를 확인하세요`}
        left={<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-white/15 text-lg font-bold">{initial}</div>}
        right={<HeaderButton icon="refresh" label="새로고침" onClick={refreshAll} disabled={home.status === 'loading'} spin={home.status === 'loading'} />}
      />

      <div className="relative z-10 px-5 pt-4">
        <div className="mb-3 flex items-center gap-2.5 px-1 text-[13px] text-ink-light" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${cameraDevice?.status === 'online' ? 'animate-pulse bg-success' : 'bg-ink-light/50'}`} />
          현재 모드
          <strong className="text-[15px] font-extrabold tracking-tight text-ink">{currentZone.label} 모드</strong>
        </div>

        {/* 공간 카드: 카드 전체가 라디오 버튼. 안쪽 '현재 화면 보기' 버튼과 겹치지 않게 div role=radio로 만들고 안쪽 클릭 전파를 막는다 */}
        <div role="radiogroup" aria-label="감지 모드" className="flex flex-col gap-3.5">
          {ZONES.map((z) => {
            const active = currentMode === z.value;
            const select = () => {
              if (!active) changeMode({ mode: z.value });
            };
            const cam = active ? deviceState(cameraDevice) : STANDBY;
            const mic = active ? deviceState(micDevice, '수신 중') : STANDBY;
            const tile = `flex min-w-0 flex-col gap-1.5 rounded-[14px] px-3 py-2.5 ${active ? 'bg-white' : 'bg-[#f6f7f8]'}`;
            return (
              <div
                key={z.value}
                role="radio"
                aria-checked={active}
                aria-disabled={!cameraDevice || modeBusy}
                tabIndex={0}
                onClick={select}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    select();
                  }
                }}
                className={`flex cursor-pointer flex-col gap-3 rounded-[20px] border-[1.5px] p-3.5 shadow-lg shadow-brand-900/[0.06] transition-colors ${
                  active ? 'border-brand-500 bg-brand-50' : 'border-black/[0.07] bg-white'
                } ${!cameraDevice || modeBusy ? 'opacity-70' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-500">
                    <Icon name={z.icon} size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[17px] font-extrabold tracking-tight text-ink">{z.label}</div>
                    <div className="text-xs text-ink-light">선택하면 {z.label} 모드로 전환</div>
                  </div>
                  {active && <span className="shrink-0 rounded-full bg-brand-600 px-2 py-[3px] text-[11px] font-bold text-white">모니터링 중</span>}
                  <span
                    aria-hidden="true"
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${
                      active ? 'border-brand-500 bg-brand-500 text-white' : 'border-black/10'
                    }`}
                  >
                    {active && <Icon name="check" size={12} strokeWidth={3} />}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className={tile}>
                    <div className="flex items-center gap-1.5 text-xs text-ink-light"><Icon name="camera" size={14} />카메라</div>
                    <div className={`flex items-center gap-1.5 text-base font-extrabold tracking-tight ${cam.color}`}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${cam.dot}`} />
                      {cam.text}
                    </div>
                    {active && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCameraModal();
                        }}
                        disabled={capturing}
                        aria-label="카메라 현재 화면 보기"
                        className="cursor-pointer self-start text-xs font-bold text-brand-500 disabled:cursor-wait disabled:opacity-60"
                      >
                        {capturing ? '촬영 중…' : '현재 화면 보기 ›'}
                      </button>
                    )}
                  </div>
                  <div className={tile}>
                    <div className="flex items-center gap-1.5 text-xs text-ink-light"><Icon name="mic" size={14} />마이크</div>
                    <div className={`flex items-center gap-1.5 text-base font-extrabold tracking-tight ${mic.color}`}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${mic.dot}`} />
                      {mic.text}
                    </div>
                    {/* 시안의 소리 막대 장식: 실제 음량이 아니라 "수신 중" 표시용 고정 모양 */}
                    {active && micDevice?.status === 'online' && (
                      <div className="flex h-3.5 items-end gap-0.5" aria-hidden="true">
                        {[5, 10, 14, 8, 12, 6].map((h, i) => (
                          <i key={i} className="block w-[3px] rounded-sm bg-success" style={{ height: h }} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {modeError && <div className="mt-2 px-1 text-[11px] leading-snug text-danger">{modeError}</div>}

        {/* 경비: 켜면 침입 의심·문 열림 이벤트를 푸시로 보낸다 (서버 SECURITY_CATEGORIES) */}
        <div
          className={`mt-3.5 flex items-center gap-3 rounded-[20px] border-[1.5px] bg-white p-3.5 shadow-lg shadow-brand-900/[0.06] transition-colors ${
            securityArmed ? 'border-danger' : 'border-black/[0.07]'
          }`}
        >
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${securityArmed ? 'bg-danger/15 text-danger' : 'bg-[#f6f7f8] text-ink-light'}`}>
            <Icon name="shield" size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold text-ink">
              경비 <span className={`text-xs font-bold ${securityArmed ? 'text-danger' : 'text-ink-light'}`}>{securityArmed ? '켜짐' : '꺼짐'}</span>
            </div>
            <div className="text-xs leading-snug text-ink-light">
              {securityArmed ? '침입 의심이나 문 열림이 감지되면 알려드려요' : '켜면 침입 의심이나 문 열림을 알려드려요'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={securityArmed}
            aria-label="경비 켜기/끄기"
            onClick={() => changeMode({ securityArmed: !securityArmed })}
            disabled={!cameraDevice || modeBusy}
            className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors disabled:opacity-60 ${securityArmed ? 'bg-danger' : 'bg-black/10'}`}
          >
            <span
              className={`absolute left-[3px] top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform ${securityArmed ? 'translate-x-[22px]' : ''}`}
            />
          </button>
        </div>

        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-[18px] bg-white p-3.5 shadow-lg shadow-brand-900/[0.06]">
              <div className="text-xs text-ink-light">{c.label}</div>
              <div className={`mt-1 tabular-nums text-[22px] font-extrabold ${c.valueColor}`}>{c.value}</div>
              {c.hint && <div className="mt-0.5 text-[11px] text-ink-light">{c.hint}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* 캡처 결과는 홈 콘텐츠가 아니라 화면 위 모달로 (평소엔 렌더링 안 함) */}
      <CameraCaptureModal open={cameraModalOpen} capture={capture} onClose={closeCameraModal} onRetry={captureNow} />

      <div className="px-5 pt-5">
        <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm shadow-brand-900/[0.04]">
          <div className="flex items-start gap-3 px-[18px] pt-[18px]">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-400/10 text-brand-500"><Icon name="clipboard" size={21} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-bold text-ink">오늘의 브리핑</span>
                <span className="rounded-[6px] bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-brand-500">AI</span>
              </div>
              {briefingStatus === 'done' && briefing && (
                <div className="mt-0.5 text-xs text-ink-light">
                  {/* 저장된 브리핑이 오늘 것이 아니면 날짜도 표시 */}
                  {new Date(briefing.timestamp).toDateString() !== new Date().toDateString() &&
                    `${new Date(briefing.timestamp).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} `}
                  {new Date(briefing.timestamp).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })} 생성 · 이벤트 {briefing.eventCount}건 기반
                </div>
              )}
            </div>
            {briefingStatus === 'done' && (
              <button
                type="button"
                onClick={generateBriefing}
                aria-label="브리핑 다시 만들기"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/10 text-ink-light transition-colors hover:bg-black/[0.03]"
              >
                <Icon name="refresh" size={15} strokeWidth={2} />
              </button>
            )}
          </div>

          {briefingStatus === 'restoring' && (
            <div className="flex items-center gap-2 px-[18px] pb-5 pt-3">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-100 border-t-brand-400" />
              <span className="text-[13px] text-ink-light">마지막 브리핑을 불러오는 중…</span>
            </div>
          )}

          {briefingStatus === 'empty' && (
            <div className="px-[18px] pb-[22px] pt-2 text-center">
              <p className="mx-0 mb-4 mt-1 text-[13px] leading-relaxed text-ink-light">
                아직 오늘의 브리핑이 없어요.<br />버튼을 누르면 AI가 오늘 하루를 요약해드려요.
              </p>
              <button
                type="button"
                onClick={generateBriefing}
                className="rounded-xl border-none bg-brand-600 px-[18px] py-2.5 text-[13px] font-bold text-white transition-transform active:scale-[0.98]"
              >
                지금 브리핑 만들기
              </button>
            </div>
          )}

          {briefingStatus === 'loading' && (
            <div className="px-[18px] pb-5 pt-1.5">
              <div className="mb-3.5 flex items-center gap-2">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-100 border-t-brand-400" />
                <span className="text-[13px] text-ink-light">오늘 하루를 정리하고 있어요…</span>
              </div>
              <div className="mb-2 h-2.5 w-full rounded-full bg-brand-50" />
              <div className="mb-2 h-2.5 w-[92%] rounded-full bg-brand-50" />
              <div className="h-2.5 w-[65%] rounded-full bg-brand-50" />
            </div>
          )}

          {briefingStatus === 'done' && briefing && (
            <div className="px-[18px] pb-5 pt-3.5">
              {/* 브리핑은 Markdown → 채팅과 같은 제목/목록/카드 UI로 (맨 앞 # 제목은 카드 제목과 겹쳐서 생략) */}
              <MarkdownBlocks text={briefing.summary} dropTitle />
            </div>
          )}

          {briefingStatus === 'error' && (
            <div className="px-[18px] pb-5 pt-1.5">
              <div className="mb-3 flex items-center gap-2">
                <Icon name="alert" size={18} className="text-danger" />
                <span className="text-[13px] font-semibold text-danger">브리핑을 만들지 못했어요</span>
              </div>
              <p className="mb-3.5 text-[13px] leading-relaxed text-ink-light">{briefingError}</p>
              <button
                type="button"
                onClick={generateBriefing}
                className="rounded-xl border border-danger/35 bg-danger/12 px-4 py-2.5 text-[13px] font-bold text-danger"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mx-5 mb-3 mt-8 flex items-center justify-between">
        <div className="text-lg font-bold tracking-tight text-ink">최근 이벤트</div>
        <div className="text-xs font-semibold text-ink-light">최근 3건</div>
      </div>
      <div className="px-5">
        {loading && <div className="text-sm text-ink-light">불러오는 중...</div>}
        {error && <div className="text-sm text-danger">{error}</div>}
        {!loading && !error && events.length === 0 && (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 py-8 text-center text-sm text-ink-light">
            최근 이벤트가 없습니다.
          </div>
        )}
        {events.map((e) => {
          const disp = EVENT_ICON[e.type] || EVENT_ICON.other;
          return (
            <div
              key={e.id}
              className="mb-3 flex items-center gap-3.5 rounded-[20px] border-[1.5px] border-black/[0.07] bg-white p-3.5 shadow-lg shadow-brand-900/[0.06]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: disp.bg, color: disp.fg }}>
                <Icon name={disp.icon} size={22} />
              </div>
              <div>
                <div className="mb-1 text-[15px] font-semibold text-ink">{e.description}</div>
                <div className="text-xs text-ink-light">{formatRelativeTime(e.timestamp)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
