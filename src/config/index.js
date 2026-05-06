/**
 * Application Configuration
 */

const config = {
  // 서버 설정
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || 'localhost',

  // Anthropic Claude API
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514',
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
    name: process.env.MCP_SERVER_NAME || 'homecare-mcp'
  },

  // Edge Device
  edge: {
    secret: process.env.EDGE_DEVICE_SECRET
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
};

validateConfig();

module.exports = config;
