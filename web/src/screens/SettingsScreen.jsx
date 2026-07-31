import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { C, BG } from '../theme';

function Toggle({ on, onClick }) {
  return (
    <div onClick={onClick} style={{ width: 48, height: 28, borderRadius: 14, background: on ? C.success : '#CBD5E1', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background .2s' }}>
      <div style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .2s' }} />
    </div>
  );
}

const NOTIFICATION_ITEMS = [
  { key: 'danger', icon: '🚨', bg: BG.danger, title: '위험 알림', desc: '낙상, 화재, 유리 파손 등 즉시 알림', defaultOn: true },
  { key: 'visitor', icon: '🚪', bg: BG.info, title: '방문자 알림', desc: '사람 감지 시 Push 알림', defaultOn: true },
  { key: 'motion', icon: '🚶', bg: BG.success, title: '움직임 알림', desc: '활동 감지 시 알림', defaultOn: false },
  { key: 'sound', icon: '🔔', bg: BG.warning, title: '소리 알림', desc: '초인종, 아기 울음 등 소리 감지', defaultOn: true },
  { key: 'briefing', icon: '📊', bg: BG.purple, title: '일일 브리핑', desc: '매일 오후 9시 AI 요약 알림', defaultOn: true }
];

const FAMILY_MEMBERS = [
  { name: '나', role: '관리자 • 모든 권한', avatarBg: `linear-gradient(135deg,${C.primary},${C.primaryLight})`, initial: '나', online: true }
];

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [toggles, setToggles] = useState(
    Object.fromEntries(NOTIFICATION_ITEMS.map((i) => [i.key, i.defaultOn]))
  );
  const [deviceCount, setDeviceCount] = useState(null);

  useEffect(() => {
    api.devices.list().then((d) => setDeviceCount(d.length)).catch(() => setDeviceCount(null));
  }, []);

  const initial = user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div>
      <div style={{ background: `linear-gradient(135deg,${C.primary},${C.primaryLight})`, padding: '24px 20px 28px', color: '#fff' }}>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>설정</div>
        <div style={{ fontSize: 14, opacity: 0.85 }}>HOME-TALK 앱 환경설정</div>
      </div>

      <div style={{ background: C.card, borderRadius: 16, padding: 20, margin: '-16px 20px 16px', boxShadow: '0 4px 16px rgba(42,95,127,0.08)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: `linear-gradient(135deg,${C.primary},${C.primaryLight})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24, fontWeight: 700 }}>{initial}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{user?.email || '사용자'}</div>
          <div style={{ fontSize: 13, color: C.textLight, marginTop: 2 }}>{user?.email}</div>
          <div style={{ padding: '4px 10px', borderRadius: 12, background: '#D4F4E7', color: C.success, fontSize: 11, fontWeight: 700, marginTop: 4, display: 'inline-block' }}>✅ 로그인됨</div>
        </div>
      </div>

      <SettingsSection title="🔔 알림 설정">
        {NOTIFICATION_ITEMS.map((item) => (
          <SettingsItem key={item.key} icon={item.icon} bg={item.bg} title={item.title} desc={item.desc}
            right={<Toggle on={toggles[item.key]} onClick={() => setToggles((t) => ({ ...t, [item.key]: !t[item.key] }))} />} />
        ))}
      </SettingsSection>

      <SettingsSection title="👤 계정">
        <SettingsItem icon="🔒" bg={BG.success} title="보안 설정" desc="비밀번호 변경" arrow />
        <SettingsItem icon="📱" bg={BG.warning} title="연결된 디바이스" desc={deviceCount === null ? '조회 중...' : `${deviceCount}대 연결됨`} arrow />
      </SettingsSection>

      <SettingsSection title="👨‍👩‍👧‍👦 가족 공유">
        <div style={{ background: C.card, borderRadius: 16, boxShadow: '0 2px 8px rgba(42,95,127,0.08)', overflow: 'hidden' }}>
          {FAMILY_MEMBERS.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: i < FAMILY_MEMBERS.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: m.avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 700 }}>{m.initial}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{m.name}</div>
                <div style={{ fontSize: 12, color: C.textLight }}>{m.role}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: m.online ? C.success : C.textLight }}>{m.online ? '온라인' : '오프라인'}</div>
            </div>
          ))}
        </div>
        <button
          onClick={() => alert('가족 초대 기능은 준비 중입니다.')}
          style={{ width: '100%', padding: 14, border: `2px dashed ${C.border}`, borderRadius: 12, background: 'none', color: C.primary, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 12 }}>
          + 가족 초대하기
        </button>
      </SettingsSection>

      <SettingsSection title="ℹ️ 앱 정보">
        <SettingsItem icon="📱" bg="#F0F6FA" title="앱 버전" desc="HOME-TALK v1.0.0 (Beta)" />
        <SettingsItem icon="🚪" bg={BG.danger} title="로그아웃" titleColor={C.danger} onClick={() => signOut()} />
      </SettingsSection>

      <div style={{ height: 20 }} />
    </div>
  );
}

function SettingsSection({ title, children }) {
  return (
    <div style={{ padding: '0 20px', marginBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.textLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, paddingLeft: 4 }}>{title}</div>
      <div style={{ background: C.card, borderRadius: 16, boxShadow: '0 2px 8px rgba(42,95,127,0.08)', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function SettingsItem({ icon, bg, title, desc, arrow, right, onClick, titleColor }) {
  return (
    <div onClick={onClick} style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: `1px solid ${C.border}`, cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: titleColor || C.text }}>{title}</div>
        {desc && <div style={{ fontSize: 12, color: C.textLight, marginTop: 2 }}>{desc}</div>}
      </div>
      {arrow && <div style={{ color: C.textLight, fontSize: 14 }}>›</div>}
      {right}
    </div>
  );
}
