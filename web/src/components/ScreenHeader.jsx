import Icon from './Icon';

/**
 * 홈·채팅·이벤트·설정 화면 맨 위의 남색 헤더 카드. 네 화면이 같은 폭·높이·글자 크기를 쓰도록 여기서만 정의한다.
 * 글이 길면 잘리지 않고 줄바꿈된다(이메일 등). sticky면 스크롤해도 위에 붙어 있다.
 */
export default function ScreenHeader({ title, subtitle, left, right, sticky = false }) {
  return (
    <div className={`px-3.5 pt-4 ${sticky ? 'sticky top-0 z-[5] bg-[#f7f8fa] pb-3' : ''}`}>
      <div className="flex min-h-[84px] items-center gap-3 rounded-[20px] bg-linear-to-br from-brand-600 to-[#2c5a70] p-[18px] text-white">
        {left}
        <div className="min-w-0 flex-1">
          <div className="text-lg font-extrabold leading-tight tracking-tight [overflow-wrap:anywhere]">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs leading-snug opacity-80 [overflow-wrap:anywhere]">{subtitle}</div>}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
    </div>
  );
}

/** 헤더 안의 둥근 버튼. icon이면 아이콘 버튼, text면 글자 버튼 */
export function HeaderButton({ icon, text, label, onClick, disabled, spin = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`flex h-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-all hover:bg-white/25 active:scale-90 disabled:opacity-40 ${
        text ? 'px-4 text-[13px] font-semibold' : 'w-9'
      }`}
    >
      {icon && <Icon name={icon} size={18} strokeWidth={2} className={spin ? 'animate-spin' : ''} />}
      {text}
    </button>
  );
}
