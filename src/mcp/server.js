/**
 * MCP Server (stdio) - Model Context Protocol Server
 * 외부 MCP 클라이언트가 프로세스로 직접 실행하는 용도 (npm run mcp)
 * 웹 채팅은 이 파일이 아니라 HTTP 엔드포인트(/mcp, src/routes/mcp.routes.js)를 사용
 */

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const config = require('../config');
const logger = require('../utils/logger');
const { createMcpServer } = require('./createServer');

// MCP 서버 생성
const server = createMcpServer();

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
