import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { C } from '../theme';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password);
        if (error) throw error;
      } else {
        const { data, error } = await signUp(email, password);
        if (error) throw error;
        if (!data.session) {
          setInfo('가입 확인 이메일을 보냈습니다. 메일함을 확인해주세요.');
        }
      }
    } catch (err) {
      setError(err.message || '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 430, margin: '0 auto', minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 24, fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: C.text, marginBottom: 8 }}>HOME-TALK</div>
        <div style={{ fontSize: 14, color: C.textLight }}>부모님 집 상태를 언제 어디서나</div>
      </div>
      <form onSubmit={handleSubmit} style={{ background: C.card, borderRadius: 16, padding: 24, boxShadow: '0 2px 12px rgba(42,95,127,0.08)' }}>
        <div style={{ display: 'flex', marginBottom: 20, borderRadius: 10, background: C.bg, padding: 4 }}>
          <button type="button" onClick={() => setMode('signin')} style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', background: mode === 'signin' ? C.card : 'transparent', color: mode === 'signin' ? C.primary : C.textLight }}>로그인</button>
          <button type="button" onClick={() => setMode('signup')} style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', background: mode === 'signup' ? C.card : 'transparent', color: mode === 'signup' ? C.primary : C.textLight }}>회원가입</button>
        </div>
        <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>이메일</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ width: '100%', padding: '12px 14px', marginTop: 6, marginBottom: 16, borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, outline: 'none' }} />
        <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>비밀번호</label>
        <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', padding: '12px 14px', marginTop: 6, marginBottom: 20, borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 14, outline: 'none' }} />
        {error && <div style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {info && <div style={{ color: C.success, fontSize: 13, marginBottom: 12 }}>{info}</div>}
        <button type="submit" disabled={loading}
          style={{ width: '100%', padding: 14, border: 'none', borderRadius: 12, background: C.primary, color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? '처리 중...' : mode === 'signin' ? '로그인' : '가입하기'}
        </button>
      </form>
    </div>
  );
}
