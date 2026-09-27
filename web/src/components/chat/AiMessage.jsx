import { useMemo } from 'react';
import { parseChatBlocks } from '../../lib/chatBlocks';
import { TextBlock } from './MarkdownText';
import { AlertCard, DeviceStatusCard, EventList, ResponsiveTable, StatCard } from './ChatCards';
import CaptureImage from '../CaptureImage';

/**
 * AI 응답 한 개 렌더링
 * 응답 → 블록 분리(lib/chatBlocks) → 텍스트 블록은 말풍선으로 묶고, 장치/이벤트/통계/경고/표는 독립 카드로
 */

const TEXT_TYPES = new Set(['heading', 'paragraph', 'list', 'code']);

const CARD_COMPONENTS = {
  device_status: DeviceStatusCard,
  event_list: EventList,
  stats: StatCard,
  alert: AlertCard,
  table: ResponsiveTable,
  image: CaptureImage // 카메라 캡처 사진 (말풍선 밖 독립 카드)
};

/** 연속된 텍스트 블록은 말풍선 하나로, 카드 블록은 각각 따로 */
function toSegments(blocks) {
  const segments = [];
  for (const block of blocks) {
    if (TEXT_TYPES.has(block.type)) {
      const last = segments[segments.length - 1];
      if (last?.kind === 'bubble') last.blocks.push(block);
      else segments.push({ kind: 'bubble', blocks: [block] });
    } else if (CARD_COMPONENTS[block.type]) {
      segments.push({ kind: 'card', block });
    }
  }
  return segments;
}

function Bubble({ blocks, isLast, time }) {
  return (
    <div
      data-block="bubble"
      className={`min-w-0 max-w-full rounded-[18px] border border-black/5 bg-white px-4 py-3.5 text-[15px] leading-relaxed text-ink shadow-sm shadow-brand-900/[0.04] [overflow-wrap:anywhere] ${
        isLast ? 'rounded-bl-md' : ''
      }`}
    >
      <div className="space-y-2.5">
        {blocks.map((b, i) => <TextBlock key={i} block={b} />)}
      </div>
      {time && <div className="mt-1.5 text-[11px] opacity-60">{time}</div>}
    </div>
  );
}

/**
 * 말풍선/아바타 없이 블록만 차례로 렌더링 (홈 화면 브리핑 카드처럼 이미 카드 안에 들어가는 곳용)
 * @param {boolean} dropTitle - 맨 앞의 큰 제목(# ...)을 생략 (카드 제목과 중복될 때)
 */
export function MarkdownBlocks({ text, dropTitle = false }) {
  const blocks = useMemo(() => {
    const parsed = parseChatBlocks(text);
    return dropTitle && parsed[0]?.type === 'heading' && parsed[0].level === 1 ? parsed.slice(1) : parsed;
  }, [text, dropTitle]);

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">
      {blocks.map((block, i) => {
        if (TEXT_TYPES.has(block.type)) return <TextBlock key={i} block={block} />;
        const Card = CARD_COMPONENTS[block.type];
        return Card ? <Card key={i} {...block} /> : null;
      })}
    </div>
  );
}

export default function AiMessage({ text, time }) {
  const segments = useMemo(() => toSegments(parseChatBlocks(text)), [text]);

  // 기존과 같은 단순 텍스트 답변이면 시간을 말풍선 안에 (기존 모양 유지)
  const singleBubble = segments.length === 1 && segments[0].kind === 'bubble';

  return (
    <div data-role="ai-message" className="flex w-full min-w-0 items-end gap-2">
      <div className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs text-white">
        🤖
      </div>
      <div className="flex min-w-0 max-w-[calc(100%-2.25rem)] flex-1 flex-col items-start gap-2">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          if (seg.kind === 'bubble') {
            return <Bubble key={i} blocks={seg.blocks} isLast={isLast} time={singleBubble ? time : null} />;
          }
          const Card = CARD_COMPONENTS[seg.block.type];
          return (
            <div key={i} className="w-full min-w-0">
              <Card {...seg.block} />
            </div>
          );
        })}
        {!singleBubble && <div className="px-1 text-[11px] text-ink-light/80">{time}</div>}
      </div>
    </div>
  );
}
