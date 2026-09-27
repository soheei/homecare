/**
 * MCP Controller - Streamable HTTP MCP 서버 엔드포인트
 *
 * stateless 모드: 요청마다 MCP 서버/트랜스포트를 새로 만들고 응답 후 정리
 * (세션을 메모리에 두지 않으므로 서버 재시작/다중 인스턴스에도 안전)
 * 응답은 response.utils가 아니라 MCP 규격(JSON-RPC)을 따른다.
 */

const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpServer } = require('../mcp/createServer');
const logger = require('../utils/logger');

/**
 * POST /mcp - MCP JSON-RPC 요청 처리 (initialize, tools/list, tools/call ...)
 */
const handleRequest = async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error('[MCP] HTTP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
};

/**
 * GET/DELETE /mcp - stateless 모드에선 SSE 스트림/세션 종료를 지원하지 않음
 */
const methodNotAllowed = (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null
  });
};

module.exports = {
  handleRequest,
  methodNotAllowed
};
