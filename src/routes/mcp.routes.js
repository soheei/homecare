/**
 * MCP Routes - Streamable HTTP MCP 서버
 * 웹 채팅(claude.service.js의 MCP 클라이언트)과 외부 MCP 클라이언트(Claude Desktop 등)가 공용으로 접속
 */

const express = require('express');
const router = express.Router();
const mcpController = require('../controllers/mcp.controller');
const { authenticateMcp } = require('../middlewares/auth.middleware');

/**
 * POST /mcp
 * MCP JSON-RPC 요청 (Authorization: Bearer <MCP_AUTH_TOKEN>)
 */
router.post('/', authenticateMcp, mcpController.handleRequest);

/**
 * GET /mcp, DELETE /mcp
 * stateless 모드라 미지원 (405)
 */
router.get('/', mcpController.methodNotAllowed);
router.delete('/', mcpController.methodNotAllowed);

module.exports = router;
