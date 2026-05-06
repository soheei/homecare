/**
 * MCP Server - Model Context Protocol Server
 * Claude가 호출할 수 있는 도구들을 제공
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const config = require('../config');
const logger = require('../utils/logger');
const eventTools = require('./tools/event.tools');
const cameraTools = require('./tools/camera.tools');

// MCP 서버 생성
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

// 도구 목록 정의
const tools = [
  ...eventTools.definitions,
  ...cameraTools.definitions
];

// 도구 목록 요청 핸들러
server.setRequestHandler('tools/list', async () => {
  return { tools };
});

// 도구 호출 핸들러
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  logger.info(`[MCP] Tool called: ${name}`);
  logger.debug(`[MCP] Arguments:`, args);

  try {
    let result;

    // 이벤트 관련 도구
    if (eventTools.handlers[name]) {
      result = await eventTools.handlers[name](args);
    }
    // 카메라 관련 도구
    else if (cameraTools.handlers[name]) {
      result = await cameraTools.handlers[name](args);
    }
    else {
      throw new Error(`Unknown tool: ${name}`);
    }

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

// 서버 시작
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`🔧 MCP Server "${config.mcp.name}" is running`);
}

main().catch((error) => {
  logger.error('[MCP] Server error:', error);
  process.exit(1);
});

module.exports = server;
