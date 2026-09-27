import { parseStatus } from '../../lib/chatBlocks';
import { StatusBadge } from './ChatCards';

/**
 * 말풍선 안의 텍스트 블록(제목·문단·목록·코드)과 인라인 Markdown 렌더링
 * HTML 문자열을 쓰지 않고 React 요소로만 만든다 (AI 응답에 HTML이 섞여도 실행되지 않음)
 */

// 앞에서부터 가장 먼저 나오는 패턴을 처리. 같은 위치면 위쪽 패턴 우선
const INLINE = new RegExp(
  [
    '(?<dot>[🔴🟢🟡🟠]\\uFE0F?\\s*(?:\\*\\*)?[가-힣A-Za-z]+(?:\\*\\*)?)', // 🔴 **오프라인** → 상태 Badge
    '\\*\\*(?<bold>[^*\\n]+?)\\*\\*',
    '__(?<bold2>[^_\\n]+?)__',
    '`(?<code>[^`\\n]+)`',
    '\\[(?<linkText>[^\\]\\n]+)\\]\\((?<linkUrl>https?:\\/\\/[^\\s)]+)\\)',
    '(?<url>https?:\\/\\/[^\\s<>()]+[^\\s<>().,!?])',
    '(?<![\\w*])\\*(?<italic>[^*\\s][^*\\n]*?)\\*(?![\\w*])'
  ].join('|'),
  'gu'
);

export function InlineText({ text }) {
  const out = [];
  let last = 0;
  let key = 0;
  for (const m of String(text).matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const g = m.groups;
    if (g.dot) {
      const status = parseStatus(g.dot);
      out.push(status ? <StatusBadge key={key++} status={status} size="sm" /> : g.dot);
    } else if (g.bold || g.bold2) {
      out.push(<strong key={key++} className="font-semibold"><InlineText text={g.bold || g.bold2} /></strong>);
    } else if (g.code) {
      out.push(
        <code key={key++} className="rounded-md bg-[#f2f4f6] px-1.5 py-0.5 font-mono text-[13px] [overflow-wrap:anywhere]">
          {g.code}
        </code>
      );
    } else if (g.linkUrl || g.url) {
      const href = g.linkUrl || g.url;
      out.push(
        <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="text-brand-500 underline underline-offset-2 [overflow-wrap:anywhere]">
          {g.linkText || href}
        </a>
      );
    } else if (g.italic) {
      out.push(<em key={key++}><InlineText text={g.italic} /></em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 줄바꿈을 <br>로 유지하면서 인라인 렌더링 */
function Lines({ text }) {
  const lines = String(text).split('\n');
  return lines.map((line, i) => (
    <span key={i}>
      <InlineText text={line} />
      {i < lines.length - 1 && <br />}
    </span>
  ));
}

export function TextBlock({ block }) {
  switch (block.type) {
    case 'heading':
      return (
        <p className={`m-0 font-bold text-ink ${block.level <= 2 ? 'text-[16px]' : 'text-[15px]'}`}>
          <InlineText text={block.text} />
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={`m-0 space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-ink-light`}>
          {block.items.map((item, i) => (
            <li key={i} className="pl-0.5"><InlineText text={item} /></li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return (
        <pre className="m-0 max-w-full overflow-x-auto rounded-xl bg-[#f2f4f6] px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink">
          <code>{block.code}</code>
        </pre>
      );
    default:
      return (
        <p className="m-0">
          <Lines text={block.text} />
        </p>
      );
  }
}
