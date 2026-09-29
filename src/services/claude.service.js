/**
 * Claude Service - Anthropic Claude API 연동
 *
 * [버그 수정]
 * 1. 멀티턴 대화: DB에서 히스토리 로드 & 저장
 * 2. MCP 도구 연결: tools 파라미터 전달 + tool_use 루프 처리
 *
 * 도구 목록/실행은 HTTP MCP 서버(/mcp)를 MCP 클라이언트(mcp.service.js)로 호출한다.
 */

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const logger = require('../utils/logger');
const mcpService = require('./mcp.service');
const conversationService = require('./conversation.service');
const { kstDateString, formatKst } = require('../utils/date.utils');

// Anthropic 클라이언트 초기화
const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey || 'placeholder-key'
});

// 시스템 프롬프트
const SYSTEM_PROMPT = `당신은 HomeCare AI 어시스턴트입니다. 사용자의 집 안 상황을 모니터링하고 질문에 답변하는 역할을 합니다.

주요 기능:
1. 방문자 기록 조회 및 안내
2. 이상 행동 감지 알림
3. 하루 요약 리포트 제공
4. 집 안 상황에 대한 질의응답

응답 규칙:
- 친근하고 자연스러운 한국어로 대화합니다
- 시간 정보는 "오전 10시 30분" 형식으로 표현합니다
- 위험 상황은 명확하게 알립니다
- 불확실한 정보는 추측하지 않습니다
- 도구를 사용해 실제 데이터를 조회한 후 답변합니다
- 모든 시각은 한국 시간입니다. 도구 결과의 timeKst를 그대로 쓰고, UTC timestamp를 직접 읽어 시각을 말하지 않습니다
- 건수와 이벤트는 도구 결과에 있는 것만 말하고, 결과에 있는 이벤트는 빠짐없이 정리합니다

도구 선택:
- "이번 주", "최근 며칠", "요즘" 등 기간 요약 → get_weekly_summary (기간 내 모든 이벤트 목록 포함)
- 방문자/초인종/택배 → get_visitor_log (날짜를 지정하지 않으면 최근 7일)
- 위험 상황 → get_danger_events
- 오늘 또는 특정 날짜 → get_daily_summary / get_events_by_date (날짜는 아래 현재 날짜 기준으로 계산)
- "현재 화면 보여줘", "지금 카메라 보여줘", "카메라 확인해줘" 등 지금 모습 → request_capture (실제 촬영, deviceId 생략 가능). 사진은 앱이 답변에 자동으로 붙이므로 이미지 링크/URL은 쓰지 않고 짧게 안내합니다. 실패하면 결과의 error 문장을 그대로 전합니다
- "그 소리 들려줘", "영상 보여줘" 등 지난 이벤트의 녹음·녹화 → 이벤트 조회 결과의 id로 get_event_media (hasAudio/hasVideo/hasImage가 true인 이벤트만). 플레이어는 앱이 답변에 자동으로 붙이므로 링크/URL은 쓰지 않고 어떤 이벤트인지 짧게 안내합니다. 이벤트 id는 답변에 쓰지 않습니다

답변 형식 (앱이 아래 형식을 카드/경고 UI로 바꿔 보여줍니다):
- 장치 상태는 표로: | 장치명 | 유형 | 위치 | 상태 |
- 이벤트 목록은 표로: | 시간 | 이벤트 | 위험도 |
- 건수 통계는 표로: | 항목 | 횟수 |
- 주의가 필요한 내용은 "⚠️ 제목: 내용" 형식의 줄로 시작합니다
- 그 외 설명은 짧은 문단과 "-" 목록으로 쓰고, HTML은 쓰지 않습니다`;

/**
 * 요청마다 현재 한국 날짜/시각을 붙인 시스템 프롬프트
 * (날짜를 모르면 "오늘/어제/이번 주"를 해석할 기준이 없어 엉뚱한 날짜로 조회함)
 */
const buildSystemPrompt = () => {
  const now = new Date();
  const today = kstDateString(now);
  return `${SYSTEM_PROMPT}

현재 시각: ${formatKst(now)} (한국 시간, 오늘 날짜 ${today})`;
};

// ============================================================
// [버그 1 수정] 대화 히스토리 DB 관리 → conversation.service.js
// ============================================================

// Claude에 전달할 최근 메시지 수
const HISTORY_LIMIT = 50;

/**
 * 도구 결과에서 답변에 붙일 미디어 줄 추출 (Markdown 이미지 문법 — 앱의 chatBlocks.js가 카드로 그림)
 * - request_capture → 촬영된 캡처 이미지
 * - get_event_media → 이벤트 소리/영상 플레이어. 서명 URL은 1시간 뒤 만료되므로 이벤트 경로만 저장하고
 *   앱이 열 때마다 GET /api/events/:id로 새 URL을 받는다
 * (모델이 URL을 옮겨 적다 틀리지 않도록 서버가 직접 답변에 붙인다)
 */
const extractAttachment = (toolName, result) => {
  if (result.isError) return null;
  let parsed;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return null;
  }
  if (!parsed?.success) return null;

  if (toolName === 'request_capture' && typeof parsed.imageUrl === 'string') {
    return `![현재 카메라 화면](${parsed.imageUrl})`;
  }
  if (toolName === 'get_event_media' && typeof parsed.eventId === 'string' && /^[\w-]+$/.test(parsed.eventId)) {
    const label = parsed.hasVideo ? '감지된 영상' : parsed.hasAudio ? '감지된 소리' : '감지된 사진';
    return `![${label}](/api/events/${parsed.eventId})`;
  }
  return null;
};

/**
 * DB에서 대화 히스토리 로드 (호출 전에 isOwnConversation으로 소유자 확인)
 * @returns {Array} Claude messages 형식 [{ role, content }]
 */
const loadMessages = async (conversationId) => {
  try {
    const rows = await conversationService.getMessages(conversationId, HISTORY_LIMIT);
    return rows.map(msg => ({ role: msg.role, content: msg.content }));
  } catch (error) {
    logger.warn('[Claude] Failed to load message history:', error.message);
    return [];
  }
};

// ============================================================
// 메인 채팅 함수 (버그 1 + 2 통합 수정)
// ============================================================

/**
 * 사용자와 대화
 */
const chat = async ({ message, conversationId, userId }) => {
  try {
    logger.debug(`[Claude] Processing message: ${message.substring(0, 100)}`);

    // 1. 대화 ID 확보 (없거나 본인 대화가 아니면 새로 생성)
    let convId = conversationId;
    if (convId && !(await conversationService.isOwnConversation(convId, userId))) {
      logger.warn(`[Claude] Conversation ${convId} is not owned by ${userId}, starting a new one`);
      convId = null;
    }
    if (!convId) {
      // 첫 질문이 대화 목록의 제목이 됨
      convId = await conversationService.createConversation(userId, message);
    }

    // 2. [버그 1 수정] 기존 대화 히스토리 DB에서 로드
    const history = await loadMessages(convId);
    logger.debug(`[Claude] Loaded ${history.length} previous messages`);

    // 3. 현재 유저 메시지를 히스토리에 추가
    const messages = [...history, { role: 'user', content: message }];

    // 현재 한국 날짜/시각 포함 (요청마다 새로 계산)
    const systemPrompt = buildSystemPrompt();

    // 이번 답변에서 촬영된 카메라 이미지·이벤트 미디어 줄 (답변 맨 위에 붙임)
    const attachments = [];

    // 4~5. MCP 서버에 접속해 도구 목록을 받고, Claude의 tool_use 요청을 MCP tools/call로 실행
    const response = await mcpService.withSession(async (mcp) => {
      // 4. [버그 2 수정] Claude API 호출 - MCP 서버에서 받은 tools 전달
      const tools = await mcp.listTools();

      let res = await anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        system: systemPrompt,
        tools,
        messages
      });

      logger.debug(`[Claude] stop_reason: ${res.stop_reason}`);

      // 5. [버그 2 수정] tool_use 루프 - Claude가 도구 사용을 완료할 때까지 반복
      let loopCount = 0;
      const MAX_TOOL_LOOPS = 5; // 무한루프 방지

      while (res.stop_reason === 'tool_use' && loopCount < MAX_TOOL_LOOPS) {
        loopCount++;

        // tool_use 블록 추출 (동시에 여러 개 요청할 수 있음)
        const toolUseBlocks = res.content.filter(b => b.type === 'tool_use');

        // assistant 메시지(tool_use 포함)를 히스토리에 추가
        messages.push({ role: 'assistant', content: res.content });

        // 각 도구를 MCP 서버로 병렬 호출 후 tool_result 수집
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (toolBlock) => {
            const result = await mcp.callTool(toolBlock.name, toolBlock.input);
            const attachment = extractAttachment(toolBlock.name, result);
            if (attachment) attachments.push(attachment);
            return {
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: result.content,
              is_error: result.isError
            };
          })
        );

        // tool_result를 user 역할로 히스토리에 추가
        messages.push({ role: 'user', content: toolResults });

        // Claude에 도구 결과를 전달하고 다시 응답 요청
        res = await anthropic.messages.create({
          model: config.anthropic.model,
          max_tokens: config.anthropic.maxTokens,
          system: systemPrompt,
          tools,
          messages
        });

        logger.debug(`[Claude] Tool loop ${loopCount}, stop_reason: ${res.stop_reason}`);
      }

      return res;
    });

    // 6. 최종 텍스트 응답 추출
    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // 촬영 이미지·이벤트 미디어는 Markdown 이미지 줄로 앞에 붙임 → 앱(chatBlocks.js)이 카드로 그리고, 대화 기록에도 남음
    const content = [...new Set(attachments), text]
      .filter(Boolean)
      .join('\n\n');

    // 7. [버그 1 수정] 유저 메시지 & 어시스턴트 응답 DB에 저장
    await conversationService.saveMessage(convId, 'user', message);
    await conversationService.saveMessage(convId, 'assistant', content);

    return {
      content,
      conversationId: convId,
      usage: response.usage
    };

  } catch (error) {
    logger.error('[Claude] Chat error:', error);
    throw error;
  }
};

// ============================================================
// 기존 유틸 함수들 (변경 없음)
// ============================================================

// 홈 화면 "오늘의 브리핑" 카드용 — 앱이 Markdown을 제목/목록/경고 카드로 그려서 보여줌
const BRIEFING_SYSTEM_PROMPT = `당신은 하루 동안의 집 안 상황을 요약하는 AI 어시스턴트입니다.
원격지 가족이 휴대폰 홈 화면에서 짧게 훑어볼 브리핑을 Markdown으로 씁니다.
- 첫 줄에 "# 제목"을 쓰지 않습니다 (앱 카드에 이미 "오늘의 브리핑" 제목이 있음)
- 맨 앞에 한두 문장으로 하루 전체를 요약합니다
- 섹션은 "## 이모지 제목" (예: ## 🚪 방문, ## 🏃 활동, ## 🔊 소리), 해당 이벤트가 없는 섹션은 생략합니다
- 이벤트는 "- **오후 2:55** 택배 기사 방문"처럼 시각을 굵게 쓰고 한 줄에 하나씩, 시간순으로 씁니다
- 시각은 주어진 한국 시간을 그대로 쓰고, 기록에 없는 내용은 추측하지 않습니다
- 위험·주의가 필요한 일이 있으면 "⚠️ 제목: 내용" 형식의 줄로 따로 알립니다
- 전체 15줄 이내, HTML은 쓰지 않습니다`;

/**
 * 하루 요약 리포트 생성
 */
const generateDailySummary = async (events, date) => {
  try {
    if (!events || events.length === 0) {
      return {
        content: `${date}에는 특별한 이벤트가 기록되지 않았습니다.`
      };
    }

    const eventSummary = events.map(e =>
      `- ${formatKst(e.timestamp)}: ${e.type} - ${e.description}` // UTC 그대로 주면 9시간 틀리게 요약함
    ).join('\n');

    const prompt = `다음은 ${date}의 집 안 이벤트 기록입니다:\n\n${eventSummary}\n\n위 기록을 바탕으로 하루 요약 리포트를 작성해주세요.`;

    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 1024,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return { content };

  } catch (error) {
    logger.error('[Claude] Summary generation error:', error);
    throw error;
  }
};

/**
 * 이미지 분석 (Vision)
 */
const analyzeImage = async (imageBase64, prompt = '이 이미지에서 무슨 상황이 벌어지고 있는지 설명해주세요.') => {
  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64
              }
            },
            { type: 'text', text: prompt }
          ]
        }
      ]
    });

    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return { content };

  } catch (error) {
    logger.error('[Claude] Image analysis error:', error);
    throw error;
  }
};

module.exports = {
  chat,
  generateDailySummary,
  analyzeImage
};
