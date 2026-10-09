/**
 * Application Configuration
 */

const crypto = require('crypto');

const port = parseInt(process.env.PORT, 10) || 3000;

const config = {
  // 서버 설정
  nodeEnv: process.env.NODE_ENV || 'development',
  port,
  host: process.env.HOST || '0.0.0.0',

  // Anthropic Claude API
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    // claude-sonnet-4-20250514는 2026-06-15 종료 → Haiku 4.5로 변경 (2026-09-27) → claude-haiku-5-5로 변경 (2026-10-09, 존재 여부 확인 필요)
    model: 'claude-haiku-5-5',
    maxTokens: 4096
  },

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  },

  // MCP Server
  mcp: {
    port: parseInt(process.env.MCP_SERVER_PORT, 10) || 3001,
    name: process.env.MCP_SERVER_NAME || 'homecare-mcp',
    // 채팅(MCP 클라이언트)이 접속할 HTTP MCP 서버 주소 — 기본은 같은 프로세스의 /mcp
    url: process.env.MCP_SERVER_URL || `http://127.0.0.1:${port}/mcp`,
    // /mcp Bearer 토큰. 미설정 시 내부 채팅 전용 임의 토큰 생성 (외부 클라이언트는 접속 불가)
    authToken: process.env.MCP_AUTH_TOKEN || crypto.randomBytes(32).toString('hex'),
    authTokenConfigured: Boolean(process.env.MCP_AUTH_TOKEN)
  },

  // Edge Device
  edge: {
    secret: process.env.EDGE_DEVICE_SECRET
  },

  // Web Push (VAPID)
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'debug',

  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:3000', 'http://localhost:19006'],

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100
  }
};

// 필수 환경 변수 검증
const validateConfig = () => {
  const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0 && config.nodeEnv === 'production') {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (missing.length > 0) {
    console.warn(`⚠️  Warning: Missing environment variables: ${missing.join(', ')}`);
  }

  if (!config.vapid.publicKey || !config.vapid.privateKey) {
    console.warn('⚠️  Warning: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY가 없어 푸시 알림 발송이 비활성화됩니다.');
  }

  if (!config.mcp.authTokenConfigured) {
    console.warn('⚠️  Warning: MCP_AUTH_TOKEN이 없어 임의 토큰을 사용합니다. 웹 채팅은 동작하지만 외부 MCP 클라이언트는 /mcp에 접속할 수 없습니다.');
  }
};

validateConfig();

module.exports = config;
