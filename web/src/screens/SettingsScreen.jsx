import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

const inputClass =
  'w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-400/10';

function Toggle({ on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-7 w-12 shrink-0 rounded-full border-none transition-colors ${on ? 'bg-success' : 'bg-[#cbd5e1]'}`}
    >
      <div
        className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-all"
        style={{ left: on ? 23 : 3 }}
      />
    </button>
  );
}

const NOTIFICATION_ITEMS = [
  { key: 'danger', icon: '🚨', bg: 'bg-danger/12', title: '위험 알림', desc: '낙상, 화재, 유리 파손 등 즉시 알림', defaultOn: true },
  { key: 'visitor', icon: '🚪', bg: 'bg-brand-500/8', title: '방문자 알림', desc: '사람 감지 시 Push 알림', defaultOn: true },
  { key: 'motion', icon: '🚶', bg: 'bg-brand-100', title: '움직임 알림', desc: '활동 감지 시 알림', defaultOn: false },
  { key: 'sound', icon: '🔔', bg: 'bg-warning/14', title: '소리 알림', desc: '초인종, 아기 울음 등 소리 감지', defaultOn: true },
  { key: 'briefing', icon: '📊', bg: 'bg-brand-400/10', title: '일일 브리핑', desc: '매일 오후 9시 AI 요약 알림', defaultOn: true }
];

const FAMILY_MEMBERS = [
  { name: '나', role: '관리자 • 모든 권한', initial: '나', online: true }
];

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [toggles, setToggles] = useState(
    Object.fromEntries(NOTIFICATION_ITEMS.map((i) => [i.key, i.defaultOn]))
  );
  const [deviceCount, setDeviceCount] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  useEffect(() => {
    api.devices.list().then((d) => setDeviceCount(d.length)).catch(() => setDeviceCount(null));
  }, []);

  const initial = user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div>
      <div className="grain-surface relative overflow-hidden bg-brand-600 px-5 pb-6 pt-6 text-white">
        <div className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full bg-brand-300/20 blur-2xl" />
        <div className="relative mb-1 text-2xl font-bold tracking-tight">설정</div>
        <div className="relative text-sm opacity-80">HOME-TALK 앱 환경설정</div>
      </div>

      <div className="mx-5 mb-4 mt-5 flex items-center gap-4 rounded-2xl border border-black/5 bg-white p-5 shadow-lg shadow-brand-900/[0.06]">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white ring-4 ring-brand-100">
          {initial}
        </div>
        <div className="flex-1">
          <div className="text-[17px] font-bold text-ink">{user?.email || '사용자'}</div>
          <div className="mt-0.5 text-[13px] text-ink-light">{user?.email}</div>
          <div className="mt-1 inline-block rounded-xl bg-success/14 px-2.5 py-1 text-[11px] font-bold text-success">
            ✅ 로그인됨
          </div>
        </div>
      </div>

      <SettingsSection title="🔔 알림 설정">
        {NOTIFICATION_ITEMS.map((item) => (
          <SettingsItem
            key={item.key}
            icon={item.icon}
            bg={item.bg}
            title={item.title}
            desc={item.desc}
            right={<Toggle on={toggles[item.key]} onClick={() => setToggles((t) => ({ ...t, [item.key]: !t[item.key] }))} />}
          />
        ))}
      </SettingsSection>

      <SettingsSection title="👤 계정">
        <SettingsItem icon="🔒" bg="bg-brand-100" title="보안 설정" desc="비밀번호 변경" arrow onClick={() => setShowPasswordModal(true)} />
        <SettingsItem icon="📱" bg="bg-brand-400/10" title="연결된 디바이스" desc={deviceCount === null ? '조회 중...' : `${deviceCount}대 연결됨`} arrow />
      </SettingsSection>

      <SettingsSection title="👨‍👩‍👧‍👦 가족 공유">
        <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm shadow-brand-900/[0.04]">
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
          className="mt-3 w-full rounded-xl border-2 border-dashed border-black/10 bg-transparent py-3.5 text-sm font-semibold text-brand-500"
        >
          + 가족 초대하기
        </button>
      </SettingsSection>

      <SettingsSection title="ℹ️ 앱 정보">
        <SettingsItem icon="📱" bg="bg-brand-50" title="앱 버전" desc="HOME-TALK v1.0.0 (Beta)" />
        <SettingsItem icon="🚪" bg="bg-danger/12" title="로그아웃" titleColor="text-danger" onClick={() => signOut()} />
      </SettingsSection>

      <div className="h-5" />

      {showPasswordModal && <PasswordModal onClose={() => setShowPasswordModal(false)} />}
    </div>
  );
}

function SettingsSection({ title, children }) {
  return (
    <div className="mb-5 px-5">
      <div className="mb-2.5 pl-1 text-[13px] font-bold uppercase tracking-wide text-ink-light">{title}</div>
      <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm shadow-brand-900/[0.04]">{children}</div>
    </div>
  );
}

function SettingsItem({ icon, bg, title, desc, arrow, right, onClick, titleColor }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3.5 border-b border-black/5 px-[18px] py-4 last:border-b-0 ${onClick ? 'cursor-pointer transition-colors hover:bg-black/[0.015] active:bg-black/[0.03]' : ''}`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-lg ${bg}`}>{icon}</div>
      <div className="flex-1">
        <div className={`text-[15px] font-semibold ${titleColor || 'text-ink'}`}>{title}</div>
        {desc && <div className="mt-0.5 text-xs text-ink-light">{desc}</div>}
      </div>
      {arrow && <div className="text-sm text-ink-light">›</div>}
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
            <div className="mb-2 text-[17px] font-bold text-ink">✅ 변경 완료</div>
            <div className="mb-5 text-sm text-ink-light">비밀번호가 성공적으로 변경되었습니다.</div>
            <button onClick={onClose} className="w-full rounded-xl border-none bg-brand-600 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98]">
              확인
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="mb-4 text-[17px] font-bold text-ink">🔒 비밀번호 변경</div>

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
