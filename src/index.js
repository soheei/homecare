/**
 * HomeCare Backend - Main Entry Point
 * MCP & LLM 기반 지능형 홈캠 AI 브리핑 시스템
 */

require('dotenv').config();

const app = require('./app');
const logger = require('./utils/logger');
const config = require('./config');

const PORT = config.port;
const HOST = config.host;

// 서버 시작
const server = app.listen(PORT, HOST, () => {
  logger.info(`🚀 HomeCare Backend Server running on http://${HOST}:${PORT}`);
  logger.info(`📡 Environment: ${config.nodeEnv}`);
  logger.info(`🔗 MCP Server will be available on port ${config.mcp.port}`);
});

// Graceful Shutdown
const gracefulShutdown = (signal) => {
  logger.info(`\n${signal} received. Shutting down gracefully...`);
  
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });

  // 10초 후 강제 종료
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 처리되지 않은 예외 핸들링
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = server;
