import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const inputClass =
  'w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-400/10';

export default function ResetPasswordScreen() {
  const navigate = useNavigate();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);

  useEffect(() => {
    let settled = false;
    const markReady = () => {
      settled = true;
      setRecoveryReady(true);
    };

    // Supabase가 초기화 시점에 URL의 복구 토큰을 이미 처리해 세션을 만들어 둔
    // 경우, 이 컴포넌트가 마운트되기 전에 PASSWORD_RECOVERY 이벤트가 발생해
    // 아래 리스너가 놓칠 수 있다. 그래서 현재 세션을 직접 한 번 확인한다.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) markReady();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        markReady();
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) setLinkInvalid(true);
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

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
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError('비밀번호 변경에 실패했습니다. 링크가 만료되었을 수 있으니 다시 시도해주세요.');
      return;
    }
    setSuccess(true);
    setTimeout(() => navigate('/', { replace: true }), 2000);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[430px] flex-col justify-center bg-gradient-to-b from-brand-50 to-[#f7f8fa] px-6 font-sans">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl shadow-lg shadow-brand-900/20">
          🔑
        </div>
        <div className="text-2xl font-bold tracking-tight text-ink">HOME-TALK</div>
        <div className="mt-1.5 text-sm text-ink-light">새 비밀번호 설정</div>
      </div>

      <div className="animate-fade-in rounded-2xl border border-black/5 bg-white p-6 shadow-xl shadow-brand-900/[0.05]">
        {success ? (
          <div className="text-center">
            <div className="mb-2 text-[17px] font-bold text-ink">✅ 변경 완료</div>
            <div className="text-sm text-ink-light">비밀번호가 변경되었습니다. 로그인 화면으로 이동합니다.</div>
          </div>
        ) : linkInvalid ? (
          <div className="text-center">
            <div className="mb-2 text-[17px] font-bold text-ink">⚠️ 링크가 유효하지 않습니다</div>
            <div className="text-sm text-ink-light">재설정 링크가 만료되었거나 이미 사용되었습니다. 로그인 화면에서 재설정 메일을 다시 요청해주세요.</div>
          </div>
        ) : !recoveryReady ? (
          <div className="text-center text-sm text-ink-light">링크를 확인하는 중입니다...</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="mb-1.5 block text-[13px] font-semibold text-ink">새 비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6자 이상 입력"
              className={`${inputClass} mb-4`}
            />

            <label className="mb-1.5 block text-[13px] font-semibold text-ink">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="다시 입력"
              className={inputClass}
            />

            {error && <div className="mt-4 text-[13px] text-danger">{error}</div>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 w-full rounded-xl border-none bg-brand-600 py-3.5 text-[15px] font-bold text-white shadow-lg shadow-brand-900/25 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100"
            >
              {submitting ? '변경 중...' : '비밀번호 변경'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
