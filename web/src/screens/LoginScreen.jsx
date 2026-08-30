import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  'w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-400/10';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

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
    <div className="mx-auto flex min-h-screen max-w-[430px] flex-col justify-center bg-gradient-to-b from-brand-50 to-[#f7f8fa] px-6 font-sans">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl shadow-lg shadow-brand-900/20">
          🏡
        </div>
        <div className="text-2xl font-bold tracking-tight text-ink">HOME-TALK</div>
        <div className="mt-1.5 text-sm text-ink-light">로그인 또는 회원가입 후 이용해주세요.</div>
      </div>

      <form onSubmit={handleSubmit} className="animate-fade-in rounded-2xl border border-black/5 bg-white p-6 shadow-xl shadow-brand-900/[0.05]">
        <div className="mb-6 flex rounded-xl bg-[#f2f4f6] p-1">
          <button
            type="button"
            onClick={() => setMode('signin')}
            className={`flex-1 rounded-lg border-none py-2.5 text-sm font-semibold transition-all ${
              mode === 'signin' ? 'bg-white text-brand-500 shadow-sm' : 'bg-transparent text-ink-light'
            }`}
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`flex-1 rounded-lg border-none py-2.5 text-sm font-semibold transition-all ${
              mode === 'signup' ? 'bg-white text-brand-500 shadow-sm' : 'bg-transparent text-ink-light'
            }`}
          >
            회원가입
          </button>
        </div>

        <label className="mb-1.5 block text-[13px] font-semibold text-ink">이메일</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${inputClass} mb-4`}
        />

        <label className="mb-1.5 block text-[13px] font-semibold text-ink">비밀번호</label>
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />

        {mode === 'signin' && (
          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={() => setShowForgotPassword(true)}
              className="border-none bg-transparent p-0 text-[13px] font-semibold text-brand-500"
            >
              비밀번호를 잊으셨나요?
            </button>
          </div>
        )}

        {error && <div className="mt-4 text-[13px] text-danger">{error}</div>}
        {info && <div className="mt-4 text-[13px] text-success">{info}</div>}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-xl border-none bg-brand-600 py-3.5 text-[15px] font-bold text-white shadow-lg shadow-brand-900/25 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
        >
          {loading ? '처리 중...' : mode === 'signin' ? '로그인' : '가입하기'}
        </button>
      </form>

      {showForgotPassword && <ForgotPasswordModal onClose={() => setShowForgotPassword(false)} />}
    </div>
  );
}

function ForgotPasswordModal({ onClose }) {
  const { resetPasswordForEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!EMAIL_RE.test(email)) {
      setError('올바른 이메일 형식을 입력해주세요.');
      return;
    }

    setSubmitting(true);
    await resetPasswordForEmail(email).catch(() => {});
    setSubmitting(false);
    // 계정 존재 여부가 노출되지 않도록 성공/실패와 관계없이 동일한 안내를 표시
    setSent(true);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm">
      <div className="w-full max-w-[360px] animate-fade-in rounded-2xl bg-white p-6 shadow-2xl">
        {sent ? (
          <>
            <div className="mb-2 text-[17px] font-bold text-ink">📧 메일을 확인해주세요</div>
            <div className="mb-5 text-sm text-ink-light">
              입력하신 이메일로 재설정 링크를 보냈습니다. 메일함을 확인해주세요.
            </div>
            <button
              onClick={onClose}
              className="w-full rounded-xl border-none bg-brand-600 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98]"
            >
              확인
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="mb-1.5 text-[17px] font-bold text-ink">비밀번호 재설정</div>
            <div className="mb-4 text-[13px] text-ink-light">
              가입하신 이메일을 입력하시면 재설정 링크를 보내드려요.
            </div>

            <label className="mb-1.5 block text-[13px] font-semibold text-ink">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
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
                {submitting ? '전송 중...' : '재설정 메일 보내기'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
