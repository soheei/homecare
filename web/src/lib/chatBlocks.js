/**
 * AI 응답 문자열 → 화면 블록 배열 (React 없이 데이터만 만드는 순수 파서)
 *
 * Markdown을 먼저 HTML로 바꾸지 않고, 아래 우선순위로 블록을 나눈 뒤
 * 블록 type별로 React 컴포넌트가 그린다 (components/chat/AiMessage.jsx).
 *
 *   1순위 구조화 데이터: 응답 전체 또는 ```json 블록이 {type: 'device_status' | 'event_list' | 'stats' | 'alert'}
 *   2순위 특수 UI 패턴: 장치/이벤트/통계 표, "장치 / 유형 / 위치 / 상태" 줄, ⚠️ 경고
 *   3순위 Markdown:    제목, 목록, 코드, (분류 안 되는) 표
 *   4순위 일반 텍스트: 문단
 *
 * 블록 형태:
 *   { type: 'heading', level, text }
 *   { type: 'paragraph', text }                      // 인라인 Markdown은 렌더링 단계에서 처리
 *   { type: 'list', ordered, items: [text] }
 *   { type: 'code', lang, code }
 *   { type: 'device_status', title, devices: [{ name, kind, location, status }] }
 *   { type: 'event_list', title, events: [{ time, description, status }] }
 *   { type: 'stats', title, items: [{ label, value }] }
 *   { type: 'table', title, headers, rows }
 *   { type: 'alert', tone: 'warning' | 'danger', title, body: [text] }
 *   { type: 'image', alt, src }                      // 카메라 캡처 (서버가 붙인 "![alt](/api/devices/.../captures/...)" 줄)
 *   status ={ tone: 'good' | 'offline' | 'warning' | 'danger' | 'neutral', label }
 */

// ─────────────────────────────────────────────────────────────
// 상태 판정
// ─────────────────────────────────────────────────────────────

// 위에서부터 먼저 맞는 규칙 적용 ('연결되지 않음'이 '연결됨'보다, '비정상'이 '정상'보다 먼저)
const STATUS_RULES = [
  { tone: 'neutral', words: ['미감지', '미등록', '해당없음', '없음'] },
  { tone: 'offline', words: ['오프라인', 'offline', '꺼짐', '연결안됨', '연결되지않음', '미연결', '끊김', '비활성'] },
  { tone: 'danger', words: ['위험', 'danger', '높음', '긴급', '낙상', '비명'] },
  { tone: 'warning', words: ['주의', '경고', 'warning', '중간', '비정상', '이상', '감지됨'] },
  { tone: 'good', words: ['온라인', 'online', '켜짐', '정상', '연결됨', '작동중', '활성', '낮음', '안전'] }
];

const STATUS_DOTS = /[🔴🟢🟡🟠🔵⚪⚫✅❌]/gu;

/** Markdown 기호와 상태 점 이모지를 걷어낸 표시용 문자열 */
export function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$)/g, '$1$2')
    .trim();
}

// 구조화 데이터(JSON)의 영문 상태값 → 화면 표시용 한국어
const STATUS_LABEL_KO = { online: '온라인', offline: '오프라인', warning: '주의', danger: '위험', normal: '정상' };

export function parseStatus(raw) {
  const stripped = stripMarkdown(raw).replace(STATUS_DOTS, '').replace(/️/g, '').trim();
  const label = STATUS_LABEL_KO[stripped.toLowerCase()] || stripped;
  if (!label) return null;
  const key = label.replace(/\s/g, '').toLowerCase();
  const dots = String(raw);
  // 점 이모지가 명시돼 있으면 그 색을 우선
  if (/🔴|❌/u.test(dots) && !/위험|긴급/.test(label)) return { tone: 'offline', label };
  if (/🟢|✅/u.test(dots)) return { tone: 'good', label };
  if (/🟡|🟠/u.test(dots)) return { tone: 'warning', label };
  for (const rule of STATUS_RULES) {
    if (rule.words.some((w) => key.includes(w))) return { tone: rule.tone, label };
  }
  return { tone: 'neutral', label };
}

function isKnownStatus(raw) {
  const s = parseStatus(raw);
  if (!s) return false;
  const key = s.label.replace(/\s/g, '').toLowerCase();
  return STATUS_RULES.some((r) => r.words.some((w) => key.includes(w))) || /[🔴🟢🟡🟠✅❌]/u.test(String(raw));
}

// ─────────────────────────────────────────────────────────────
// 표
// ─────────────────────────────────────────────────────────────

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function normalizeHeader(h) {
  return stripMarkdown(h).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function findColumn(headers, keys, exclude = []) {
  return headers.findIndex((h, i) => !exclude.includes(i) && keys.some((k) => h.includes(k)));
}

const NUMERIC_VALUE = /^[\d,.]+\s*(건|회|개|명|대|%|번|분|시간|일|초)?$/;

function cell(row, i) {
  return i >= 0 ? (row[i] ?? '').trim() : '';
}

/** 표 헤더를 보고 장치/이벤트/통계/일반 표로 분류 */
export function classifyTable(headerCells, rows, title = null) {
  const headers = headerCells.map(normalizeHeader);

  const nameIdx = findColumn(headers, ['장치명', '장치', '기기', '디바이스', 'device', '이름', 'name']);
  const statusIdx = findColumn(headers, ['상태', 'status', '연결'], [nameIdx]);
  if (nameIdx >= 0 && statusIdx >= 0) {
    const used = [nameIdx, statusIdx];
    const kindIdx = findColumn(headers, ['유형', '종류', '타입', 'type'], used);
    const locIdx = findColumn(headers, ['위치', '장소', 'location'], [...used, kindIdx]);
    return {
      type: 'device_status',
      title,
      devices: rows.map((r) => ({
        name: stripMarkdown(cell(r, nameIdx)),
        kind: stripMarkdown(cell(r, kindIdx)),
        location: stripMarkdown(cell(r, locIdx)),
        status: parseStatus(cell(r, statusIdx))
      }))
    };
  }

  const timeIdx = findColumn(headers, ['시간', '시각', '일시', '날짜', 'time', 'date']);
  const descIdx = findColumn(headers, ['이벤트', '내용', '설명', '감지', 'event', 'description'], [timeIdx]);
  if (timeIdx >= 0 && descIdx >= 0) {
    const levelIdx = findColumn(headers, ['위험도', '상태', '등급', '수준', '위험', 'level'], [timeIdx, descIdx]);
    return {
      type: 'event_list',
      title,
      events: rows.map((r) => ({
        time: stripMarkdown(cell(r, timeIdx)),
        description: stripMarkdown(cell(r, descIdx)),
        status: levelIdx >= 0 ? parseStatus(cell(r, levelIdx)) : null
      }))
    };
  }

  if (headerCells.length === 2 && rows.length > 0 && rows.every((r) => NUMERIC_VALUE.test(stripMarkdown(cell(r, 1))))) {
    return {
      type: 'stats',
      title,
      items: rows.map((r) => ({ label: stripMarkdown(cell(r, 0)), value: stripMarkdown(cell(r, 1)) }))
    };
  }

  return {
    type: 'table',
    title,
    headers: headerCells.map(stripMarkdown),
    rows: rows.map((r) => headerCells.map((_, i) => cell(r, i)))
  };
}

// ─────────────────────────────────────────────────────────────
// 줄 패턴
// ─────────────────────────────────────────────────────────────

const FENCE = /^\s*```\s*([\w-]*)\s*$/;
const HEADING = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/;
// "**제목**" / "📊 **제목**" / "**제목**:" 처럼 굵은 글씨만 있는 줄
const BOLD_LINE = /^\s*((?:\p{Extended_Pictographic}️?\s*)*)\*\*([^*]+)\*\*\s*:?\s*$/u;
const BULLET = /^\s*[-*•]\s+(.+)$/;
const ORDERED = /^\s*\d+[.)]\s+(.+)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>\s?/;
// 한 줄 전체가 이미지. 인증이 필요한 우리 서버의 카메라 캡처 경로만 허용 (임의 외부 이미지 로딩 방지)
const CAPTURE_IMAGE = /^\s*!\[([^\]\n]*)\]\((\/api\/devices\/[\w-]+\/captures\/[\w-]+)\)\s*$/;
const ALERT_START = /^\s*(?:\*\*)?\s*(⚠️|⚠|🚨|❗|‼️)|^\s*(?:\*\*)?(주의|경고|위험|긴급)(?:\*\*)?\s*[:：]/u;

/** 문장이 아닌 짧은 한 줄 ("등록된 장치 상태") — 카드 제목으로 쓸 수 있는지 */
function isShortTitle(text) {
  const t = stripMarkdown(text);
  return !t.includes('\n') && t.length <= 30 && !/[.!?。]$|[다요죠]$/.test(t);
}

function isTableStart(lines, i) {
  return lines[i].trim().startsWith('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]);
}

/** "Camera Module V3 / 카메라 / 거실 / 오프라인" → 장치 한 줄 (상태어가 있어야 인정) */
function parseDeviceLine(line) {
  const s = line.replace(/^\s*[-*•]\s+/, '').trim();
  if (!s.includes('/')) return null;
  const parts = s.split('/').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 4 || parts.some((p) => !p || p.length > 40)) return null;
  const statusIdx = parts.findIndex((p, i) => i > 0 && isKnownStatus(p));
  if (statusIdx < 0 || isKnownStatus(parts[0])) return null;
  const rest = parts.filter((_, i) => i !== 0 && i !== statusIdx).map(stripMarkdown);
  return { name: stripMarkdown(parts[0]), kind: rest[0] || '', location: rest[1] || '', status: parseStatus(parts[statusIdx]) };
}

function parseAlert(lines) {
  const first = lines[0].replace(QUOTE, '');
  const tone = /🚨|위험|긴급/.test(first) ? 'danger' : 'warning';
  const plain = stripMarkdown(first).replace(/^(⚠️|⚠|🚨|❗|‼️)\s*/u, '').trim();
  const m = plain.match(/^([^:：]{1,16})[:：]\s*(.*)$/);
  const body = lines.slice(1).map((l) => l.replace(QUOTE, '').trim()).filter(Boolean);
  if (m) {
    return { type: 'alert', tone, title: m[1].trim(), body: m[2] ? [m[2], ...body] : body };
  }
  return { type: 'alert', tone, title: plain, body };
}

// ─────────────────────────────────────────────────────────────
// 1순위: 구조화 데이터(JSON)
// ─────────────────────────────────────────────────────────────

function fromStructured(obj) {
  if (Array.isArray(obj)) {
    const blocks = obj.map(fromStructured);
    return blocks.every(Boolean) ? blocks.flat() : null;
  }
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.blocks)) return fromStructured(obj.blocks);

  switch (obj.type) {
    case 'device_status':
      if (!Array.isArray(obj.devices)) return null;
      return [{
        type: 'device_status',
        title: obj.title || null,
        devices: obj.devices.map((d) => ({
          name: String(d.name ?? ''),
          kind: String(d.kind ?? d.type ?? ''),
          location: String(d.location ?? ''),
          status: parseStatus(d.status)
        }))
      }];
    case 'event_list':
      if (!Array.isArray(obj.events)) return null;
      return [{
        type: 'event_list',
        title: obj.title || null,
        events: obj.events.map((e) => ({
          time: String(e.time ?? e.timestamp ?? ''),
          description: String(e.description ?? e.event ?? ''),
          status: e.status || e.level ? parseStatus(e.status ?? e.level) : null
        }))
      }];
    case 'stats':
      if (!Array.isArray(obj.items)) return null;
      return [{ type: 'stats', title: obj.title || null, items: obj.items.map((s) => ({ label: String(s.label ?? ''), value: String(s.value ?? '') })) }];
    case 'alert':
      return [{ type: 'alert', tone: obj.level === 'danger' ? 'danger' : 'warning', title: String(obj.title ?? ''), body: obj.message ? [String(obj.message)] : [] }];
    case 'text':
      return parseMarkdownBlocks(String(obj.content ?? ''));
    default:
      return null;
  }
}

function tryStructured(text) {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return null;
  try {
    return fromStructured(JSON.parse(t));
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 2~4순위: 줄 단위 블록 분리
// ─────────────────────────────────────────────────────────────

function parseMarkdownBlocks(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join('\n') });
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 코드 블록 (```json 이면 구조화 데이터 먼저 시도)
    const fence = line.match(FENCE);
    if (fence) {
      flushPara();
      const body = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // 닫는 ```
      const code = body.join('\n');
      const structured = /^(json|homecare)?$/i.test(fence[1]) ? tryStructured(code) : null;
      blocks.push(...(structured || [{ type: 'code', lang: fence[1] || '', code }]));
      continue;
    }

    if (!line.trim() || RULE.test(line)) { flushPara(); i++; continue; }

    const image = line.match(CAPTURE_IMAGE);
    if (image) {
      flushPara();
      blocks.push({ type: 'image', alt: image[1] || '현재 카메라 화면', src: image[2] });
      i++;
      continue;
    }

    // 표 → 장치/이벤트/통계/일반 표
    if (isTableStart(lines, i)) {
      flushPara();
      const header = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      blocks.push(classifyTable(header, rows));
      continue;
    }

    // 경고: 이어지는 줄은 빈 줄/다른 블록 전까지 본문
    if (ALERT_START.test(line.replace(QUOTE, ''))) {
      flushPara();
      const alertLines = [line];
      i++;
      while (
        i < lines.length && lines[i].trim() && !isTableStart(lines, i) && !FENCE.test(lines[i]) &&
        !ALERT_START.test(lines[i].replace(QUOTE, '')) && !HEADING.test(lines[i]) && !BOLD_LINE.test(lines[i])
      ) {
        alertLines.push(lines[i++]);
      }
      blocks.push(parseAlert(alertLines));
      continue;
    }

    // "장치 / 유형 / 위치 / 상태" 줄 묶음 → 장치 카드
    const device = parseDeviceLine(line);
    if (device) {
      flushPara();
      const devices = [device];
      i++;
      let next;
      while (i < lines.length && (next = parseDeviceLine(lines[i]))) { devices.push(next); i++; }
      blocks.push({ type: 'device_status', title: null, devices });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushPara();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    const boldLine = line.match(BOLD_LINE);
    if (boldLine) {
      flushPara();
      blocks.push({ type: 'heading', level: 3, text: `${boldLine[1]}${boldLine[2]}`.trim() });
      i++;
      continue;
    }

    // 목록
    const bullet = line.match(BULLET);
    const ordered = !bullet && line.match(ORDERED);
    if (bullet || ordered) {
      flushPara();
      const pattern = bullet ? BULLET : ORDERED;
      const items = [];
      while (i < lines.length && pattern.test(lines[i]) && !parseDeviceLine(lines[i])) {
        items.push(lines[i].match(pattern)[1]);
        i++;
      }
      blocks.push({ type: 'list', ordered: Boolean(ordered), items });
      continue;
    }

    para.push(line.replace(QUOTE, ''));
    i++;
  }
  flushPara();

  // "**등록된 장치 상태**" 같은 제목(또는 짧은 한 줄) 바로 뒤에 카드/표가 오면 그 카드의 제목으로 합침
  const merged = [];
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const next = blocks[k + 1];
    const titleLike = b.type === 'heading' || (b.type === 'paragraph' && isShortTitle(b.text));
    if (titleLike && next && ['device_status', 'event_list', 'stats', 'table'].includes(next.type) && !next.title) {
      next.title = stripMarkdown(b.text);
      continue;
    }
    merged.push(b);
  }
  return merged;
}

/** AI 응답 → 블록 배열 */
export function parseChatBlocks(text) {
  const source = String(text ?? '');
  return tryStructured(source) || parseMarkdownBlocks(source);
}
