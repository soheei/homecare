/**
 * MCP Client Service - 채팅이 HTTP MCP 서버(/mcp)에 접속해 도구를 조회/실행
 *
 * 흐름: Claude가 tool_use 요청 → 이 서비스가 MCP tools/call → MCP 서버가 Supabase 조회 → 결과 반환
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * MCP 서버에 접속해 fn(session)을 실행하고 연결을 정리
 * 채팅 1건 = MCP 연결 1개 (도구 목록 조회 + 도구 호출을 같은 연결로 처리)
 */
const withSession = async (fn) => {
  const client = new Client({ name: 'homecare-chat', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(config.mcp.url), {
    requestInit: {
      headers: { Authorization: `Bearer ${config.mcp.authToken}` }
    }
  });

  await client.connect(transport);
  logger.info(`[MCP Client] Connected to ${config.mcp.url}`);

  try {
    return await fn({
      /**
       * tools/list → Anthropic API tools 형식(input_schema)으로 변환
       */
      async listTools() {
        const { tools } = await client.listTools();
        logger.info(`[MCP Client] tools/list → ${tools.length} tools`);
        return tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          input_schema: inputSchema
        }));
      },

      /**
       * tools/call → Anthropic tool_result에 넣을 { content, isError }
       */
      async callTool(name, args) {
        logger.info(`[MCP Client] tools/call ${name}`);
        try {
          const result = await client.callTool({ name, arguments: args || {} });
          const text = (result.content || [])
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
          return { content: text, isError: Boolean(result.isError) };
        } catch (error) {
          logger.error(`[MCP Client] tools/call ${name} failed:`, error);
          return { content: JSON.stringify({ error: error.message }), isError: true };
        }
      }
    });
  } finally {
    await client.close().catch(() => {});
  }
};

module.exports = {
  withSession
};
