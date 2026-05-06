/**
 * Claude Service - Anthropic Claude API 연동
 *
 * [버그 수정]
 * 1. 멀티턴 대화: DB에서 히스토리 로드 & 저장
 * 2. MCP 도구 연결: tools 파라미터 전달 + tool_use 루프 처리
 */

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const logger = require('../utils/logger');
const { supabase, supabaseAdmin } = require('../config/supabase');

// MCP 도구 정의 & 핸들러 import
const eventTools = require('../mcp/tools/event.tools');
const cameraTools = require('../mcp/tools/camera.tools');

// Anthropic 클라이언트 초기화
const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey || 'placeholder-key'
});

// Claude에 전달할 MCP 도구 목록 (버그 2 수정)
const MCP_TOOLS = [
  ...eventTools.definitions,
  ...cameraTools.definitions
];

// 모든 MCP 핸들러 맵 (버그 2 수정)
const MCP_HANDLERS = {
  ...eventTools.handlers,
  ...cameraTools.handlers
};

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
- 도구를 사용해 실제 데이터를 조회한 후 답변합니다`;

// ============================================================
// [버그 1 수정] 대화 히스토리 DB 관리
// ============================================================

/**
 * 새 conversation 생성 → DB 저장
 */
const createConversation = async (userId) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .insert([{ user_id: userId || 'anonymous', title: null }])
      .select()
      .single();

    if (error) throw error;
    logger.info(`[Claude] Conversation created: ${data.id}`);
    return data.id;
  } catch (error) {
    // DB 미연결 시 임시 ID 반환 (개발 편의)
    const tempId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    logger.warn('[Claude] DB unavailable, using temp conversation ID:', error.message);
    return tempId;
  }
};

/**
 * DB에서 대화 히스토리 로드
 * @returns {Array} Claude messages 형식 [{ role, content }]
 */
const loadMessages = async (conversationId) => {
  // 임시 ID(conv_timestamp_xxx)는 DB에 없으므로 빈 배열 반환
  if (!conversationId || conversationId.startsWith('conv_')) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(50); // 최근 50개만 컨텍스트로 사용

    if (error) throw error;

    return (data || []).map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  } catch (error) {
    logger.warn('[Claude] Failed to load message history:', error.message);
    return [];
  }
};

/**
 * 메시지 DB에 저장
 */
const saveMessage = async (conversationId, role, content) => {
  if (!conversationId || conversationId.startsWith('conv_')) {
    return; // 임시 ID면 저장 건너뜀
  }

  try {
    const { error } = await supabaseAdmin
      .from('messages')
      .insert([{ conversation_id: conversationId, role, content }]);

    if (error) throw error;
  } catch (error) {
    logger.warn('[Claude] Failed to save message:', error.message);
  }
};

// ============================================================
// [버그 2 수정] MCP 도구 실행
// ============================================================

/**
 * tool_use 블록을 받아 실제 MCP 핸들러 실행
 */
const callMcpTool = async (toolName, toolArgs) => {
  const handler = MCP_HANDLERS[toolName];
  if (!handler) {
    logger.warn(`[Claude] Unknown MCP tool requested: ${toolName}`);
    return { error: `Unknown tool: ${toolName}` };
  }

  try {
    logger.info(`[Claude] Calling MCP tool: ${toolName}`);
    const result = await handler(toolArgs || {});
    return result;
  } catch (error) {
    logger.error(`[Claude] MCP tool error (${toolName}):`, error);
    return { error: error.message };
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

    // 1. 대화 ID 확보 (없으면 새로 생성)
    let convId = conversationId;
    if (!convId) {
      convId = await createConversation(userId);
    }

    // 2. [버그 1 수정] 기존 대화 히스토리 DB에서 로드
    const history = await loadMessages(convId);
    logger.debug(`[Claude] Loaded ${history.length} previous messages`);

    // 3. 현재 유저 메시지를 히스토리에 추가
    const messages = [...history, { role: 'user', content: message }];

    // 4. [버그 2 수정] Claude API 호출 - MCP tools 파라미터 전달
    let response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      system: SYSTEM_PROMPT,
      tools: MCP_TOOLS,
      messages
    });

    logger.debug(`[Claude] stop_reason: ${response.stop_reason}`);

    // 5. [버그 2 수정] tool_use 루프 - Claude가 도구 사용을 완료할 때까지 반복
    let loopCount = 0;
    const MAX_TOOL_LOOPS = 5; // 무한루프 방지

    while (response.stop_reason === 'tool_use' && loopCount < MAX_TOOL_LOOPS) {
      loopCount++;

      // tool_use 블록 추출 (동시에 여러 개 요청할 수 있음)
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      // assistant 메시지(tool_use 포함)를 히스토리에 추가
      messages.push({ role: 'assistant', content: response.content });

      // 각 도구 병렬 실행 후 tool_result 수집
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (toolBlock) => {
          const result = await callMcpTool(toolBlock.name, toolBlock.input);
          return {
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify(result, null, 2)
          };
        })
      );

      // tool_result를 user 역할로 히스토리에 추가
      messages.push({ role: 'user', content: toolResults });

      // Claude에 도구 결과를 전달하고 다시 응답 요청
      response = await anthropic.messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        system: SYSTEM_PROMPT,
        tools: MCP_TOOLS,
        messages
      });

      logger.debug(`[Claude] Tool loop ${loopCount}, stop_reason: ${response.stop_reason}`);
    }

    // 6. 최종 텍스트 응답 추출
    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // 7. [버그 1 수정] 유저 메시지 & 어시스턴트 응답 DB에 저장
    await saveMessage(convId, 'user', message);
    await saveMessage(convId, 'assistant', content);

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
      `- ${e.timestamp}: ${e.type} - ${e.description}`
    ).join('\n');

    const prompt = `다음은 ${date}의 집 안 이벤트 기록입니다:\n\n${eventSummary}\n\n위 기록을 바탕으로 하루 요약 리포트를 작성해주세요.`;

    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 1024,
      system: '당신은 하루 동안의 집 안 상황을 요약하는 AI 어시스턴트입니다.',
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
