/**
 * MCP Server Factory
 * stdio(server.js)와 HTTP(/mcp 라우트)가 같은 도구 등록 로직을 쓰도록 분리
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const config = require('../config');
const logger = require('../utils/logger');
const eventTools = require('./tools/event.tools');
const cameraTools = require('./tools/camera.tools');

// 도구 목록 정의
const tools = [
  ...eventTools.definitions,
  ...cameraTools.definitions
];

// 도구 이름 → 핸들러
const handlers = {
  ...eventTools.handlers,
  ...cameraTools.handlers
};

/**
 * 도구가 등록된 MCP 서버 인스턴스 생성
 */
const createMcpServer = () => {
  const server = new Server(
    {
      name: config.mcp.name,
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // 도구 목록 요청 핸들러
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // 도구 호출 핸들러
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.info(`[MCP] Tool called: ${name}`);
    logger.debug('[MCP] Arguments:', args);

    try {
      const handler = handlers[name];
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }

      const result = await handler(args || {});

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };

    } catch (error) {
      logger.error(`[MCP] Tool error (${name}):`, error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: error.message })
          }
        ],
        isError: true
      };
    }
  });

  return server;
};

module.exports = {
  createMcpServer
};
