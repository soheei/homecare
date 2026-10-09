import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { enablePush, disablePushIfUnused, getExistingSubscription, isPushSupported } from '../lib/push';
import Icon from '../components/Icon';
import ScreenHeader from '../components/ScreenHeader';

const inputClass =
  'w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-400/10';

function Toggle({ on, onClick, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-success' : 'bg-black/10'}`}
    >
      <span
        className={`absolute left-[3px] top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : ''}`}
      />
    </button>
  );
}

const NOTIFICATION_ITEMS = [
  { key: 'danger', icon: 'alert', bg: 'bg-danger/12 text-danger', title: '위험 알림', desc: '낙상, 화재, 유리 파손 등 즉시 알림', defaultOn: true },
  { key: 'visitor', icon: 'door', bg: 'bg-brand-100 text-brand-500', title: '방문자 알림', desc: '사람 감지 시 Push 알림', defaultOn: true },
  { key: 'motion', icon: 'activity', bg: 'bg-brand-100 text-brand-500', title: '움직임 알림', desc: '활동 감지 시 알림', defaultOn: false },
  { key: 'sound', icon: 'bell', bg: 'bg-warning/14 text-warning', title: '소리 알림', desc: '초인종, 아기 울음 등 소리 감지', defaultOn: true },
  { key: 'briefing', icon: 'chart', bg: 'bg-brand-100 text-brand-500', title: '일일 브리핑', desc: '매일 오후 9시 AI 요약 알림', defaultOn: true }
];

const FAMILY_MEMBERS = [
  { name: '나', role: '관리자 • 모든 권한', initial: '나', online: true }
];

// 실제 브라우저 푸시 발송 대상인 알림 종류(백엔드가 이벤트 발생 시 이 값들만 발송함)
const PUSH_BACKED_KEYS = ['danger', 'visitor', 'motion', 'sound'];

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [toggles, setToggles] = useState(
    Object.fromEntries(NOTIFICATION_ITEMS.map((i) => [i.key, i.defaultOn]))
  );
  const [savingKey, setSavingKey] = useState(null);
  const [notice, setNotice] = useState('');
  const [deviceCount, setDeviceCount] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  useEffect(() => {
    api.devices.list().then((d) => setDeviceCount(d.length)).catch(() => setDeviceCount(null));
  }, []);

  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // 이 기기에서 푸시를 받을 수 있는 상태인지: null=확인 전/불필요, 'needed'=구독 필요, 'denied'=브라우저에서 차단됨
  const [pushIssue, setPushIssue] = useState(null);
  const [enablingPush, setEnablingPush] = useState(false);

  useEffect(() => {
    api.notifications.getPreferences()
      .then((prefs) => setToggles((t) => ({ ...t, ...prefs })))
      .catch(() => {})
      .finally(() => setPrefsLoaded(true));
  }, []);

  // 알림 설정은 계정에 저장되지만 푸시 구독은 브라우저(기기)마다 따로라서,
  // 설정이 켜져 있는데 이 기기에 구독이 없으면 안내한다.
  const anyPushOn = PUSH_BACKED_KEYS.some((k) => toggles[k]);
  useEffect(() => {
    if (!prefsLoaded) return;
    if (!anyPushOn || !isPushSupported()) {
      setPushIssue(null);
      return;
    }
    if (Notification.permission === 'denied') {
      setPushIssue('denied');
      return;
    }
    let cancelled = false;
    getExistingSubscription()
      .then((sub) => { if (!cancelled) setPushIssue(sub && Notification.permission === 'granted' ? null : 'needed'); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [prefsLoaded, anyPushOn]);

  // 권한 팝업은 반드시 사용자 클릭 안에서 띄운다
  const handleEnableHere = async () => {
    setEnablingPush(true);
    setNotice('');
    try {
      await enablePush();
      setPushIssue(null);
    } catch (err) {
      setNotice(err.message || '이 기기에서 알림을 켜지 못했습니다.');
      if (Notification.permission === 'denied') setPushIssue('denied');
    } finally {
      setEnablingPush(false);
    }
  };

  const handleToggle = async (key) => {
    if (savingKey) return;
    const nextValue = !toggles[key];
    const nextToggles = { ...toggles, [key]: nextValue };

    setSavingKey(key);
    setNotice('');

    try {
      if (PUSH_BACKED_KEYS.includes(key)) {
        if (nextValue) {
          if (!isPushSupported()) {
            throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
          }
          await enablePush();
        } else {
          const stillNeeded = PUSH_BACKED_KEYS.some((k) => k !== key && nextToggles[k]);
          await disablePushIfUnused(stillNeeded);
        }
      }

      await api.notifications.updatePreferences(nextToggles);
      setToggles(nextToggles);
    } catch (err) {
      setNotice(err.message || '알림 설정을 변경하지 못했습니다.');
    } finally {
      setSavingKey(null);
    }
  };

  const initial = user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div>
      <ScreenHeader title="설정" subtitle="HOME-TALK 앱 환경설정" />

      <div className="mx-5 mb-5 mt-4 flex items-center gap-4 rounded-[20px] border-[1.5px] border-black/[0.07] bg-white p-4 shadow-lg shadow-brand-900/[0.06]">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-extrabold tracking-tight text-ink">내 계정</div>
          <div className="mt-0.5 text-[13px] text-ink-light [overflow-wrap:anywhere]">{user?.email}</div>
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-success/14 px-2.5 py-1 text-[11px] font-bold text-success">
            <Icon name="check" size={11} strokeWidth={3} />
            로그인됨
          </div>
        </div>
      </div>

      <SettingsSection icon="bell" title="알림 설정">
        {NOTIFICATION_ITEMS.map((item) => (
          <SettingsItem
            key={item.key}
            icon={item.icon}
            bg={item.bg}
            title={item.title}
            desc={item.desc}
            right={
              <Toggle
                on={toggles[item.key]}
                onClick={() => handleToggle(item.key)}
                disabled={savingKey === item.key}
                label={`${item.title} 켜기/끄기`}
              />
            }
          />
        ))}
        {pushIssue === 'needed' && (
          <div className="flex items-center gap-3 border-t border-black/5 px-[18px] py-3">
            <div className="flex-1 text-[13px] text-ink-light">알림은 켜져 있지만 이 기기에서는 아직 받을 수 없어요.</div>
            <button
              type="button"
              onClick={handleEnableHere}
              disabled={enablingPush}
              className="shrink-0 rounded-full bg-brand-600 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {enablingPush ? '켜는 중...' : '이 기기에서 알림 켜기'}
            </button>
          </div>
        )}
        {pushIssue === 'denied' && (
          <div className="border-t border-black/5 px-[18px] py-3 text-[13px] text-danger">
            이 브라우저에서 알림이 차단되어 있어요. 브라우저(또는 휴대폰) 사이트 설정에서 알림을 허용해 주세요.
          </div>
        )}
        {notice && <div className="border-t border-black/5 px-[18px] py-3 text-[13px] text-danger">{notice}</div>}
      </SettingsSection>

      <SettingsSection icon="users" title="계정">
        <SettingsItem icon="lock" bg="bg-brand-100 text-brand-500" title="보안 설정" desc="비밀번호 변경" arrow onClick={() => setShowPasswordModal(true)} />
        <SettingsItem icon="phone" bg="bg-brand-100 text-brand-500" title="연결된 디바이스" desc={deviceCount === null ? '조회 중...' : `${deviceCount}대 연결됨`} arrow />
      </SettingsSection>

      <SettingsSection icon="users" title="가족 공유" plain>
        <div className="overflow-hidden rounded-[20px] border-[1.5px] border-black/[0.07] bg-white shadow-lg shadow-brand-900/[0.06]">
          {FAMILY_MEMBERS.map((m, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-[18px] py-3.5 ${i < FAMILY_MEMBERS.length - 1 ? 'border-b border-black/5' : ''}`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-600 text-sm font-bold text-white">
                {m.initial}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-ink">{m.name}</div>
                <div className="text-xs text-ink-light">{m.role}</div>
              </div>
              <div className={`text-xs font-semibold ${m.online ? 'text-success' : 'text-ink-light'}`}>
                {m.online ? '온라인' : '오프라인'}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => alert('가족 초대 기능은 준비 중입니다.')}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-[20px] border-2 border-dashed border-black/10 bg-transparent py-3.5 text-sm font-semibold text-brand-500"
        >
          <Icon name="plus" size={16} strokeWidth={2.2} />
          가족 초대하기
        </button>
      </SettingsSection>

      <SettingsSection icon="info" title="앱 정보">
        <SettingsItem icon="info" bg="bg-brand-100 text-brand-500" title="앱 버전" desc="HOME-TALK v1.0.0 (Beta)" />
        <SettingsItem icon="logout" bg="bg-danger/12 text-danger" title="로그아웃" titleColor="text-danger" onClick={() => signOut()} />
      </SettingsSection>

      <div className="h-5" />

      {showPasswordModal && <PasswordModal onClose={() => setShowPasswordModal(false)} />}
    </div>
  );
}

function SettingsSection({ icon, title, children, plain = false }) {
  return (
    <div className="mb-5 px-5">
      <div className="mb-2.5 flex items-center gap-1.5 pl-1 text-[13px] font-bold tracking-wide text-ink-light">
        <Icon name={icon} size={15} />
        {title}
      </div>
      {plain ? (
        children
      ) : (
        <div className="overflow-hidden rounded-[20px] border-[1.5px] border-black/[0.07] bg-white shadow-lg shadow-brand-900/[0.06]">{children}</div>
      )}
    </div>
  );
}

function SettingsItem({ icon, bg, title, desc, arrow, right, onClick, titleColor }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3.5 border-b border-black/5 px-[18px] py-3.5 last:border-b-0 ${onClick ? 'cursor-pointer transition-colors hover:bg-black/[0.015] active:bg-black/[0.03]' : ''}`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${bg}`}>
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-[15px] font-bold ${titleColor || 'text-ink'}`}>{title}</div>
        {desc && <div className="mt-0.5 text-xs text-ink-light">{desc}</div>}
      </div>
      {arrow && <Icon name="chevron" size={16} className="text-ink-light" />}
      {right}
    </div>
  );
}

function PasswordModal({ onClose }) {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== confirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await updatePassword(password);
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess(true);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm">
      <div className="w-full max-w-[360px] animate-fade-in rounded-2xl bg-white p-6 shadow-2xl">
        {success ? (
          <>
            <div className="mb-2 flex items-center gap-2 text-[17px] font-bold text-ink"><Icon name="check" size={18} strokeWidth={2.5} className="text-success" />변경 완료</div>
            <div className="mb-5 text-sm text-ink-light">비밀번호가 성공적으로 변경되었습니다.</div>
            <button onClick={onClose} className="w-full rounded-xl border-none bg-brand-600 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98]">
              확인
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="mb-4 flex items-center gap-2 text-[17px] font-bold text-ink"><Icon name="lock" size={18} className="text-brand-500" />비밀번호 변경</div>

            <label className="mb-1.5 block text-[13px] font-semibold text-ink-light">새 비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6자 이상 입력"
              className={`${inputClass} mb-3.5`}
            />

            <label className="mb-1.5 block text-[13px] font-semibold text-ink-light">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="다시 입력"
              className={`${inputClass} mb-3.5`}
            />

            {error && <div className="mb-3.5 text-[13px] text-danger">{error}</div>}

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-black/10 bg-transparent py-3.5 text-sm font-semibold text-ink"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-xl border-none bg-brand-600 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
              >
                {submitting ? '변경 중...' : '변경하기'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
