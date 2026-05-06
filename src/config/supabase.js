/**
 * Supabase Client Configuration
 */

const { createClient } = require('@supabase/supabase-js');
const config = require('./index');
const logger = require('../utils/logger');

// Supabase 클라이언트 (일반 사용자용 - anon key)
const supabase = createClient(
  config.supabase.url || 'https://placeholder.supabase.co',
  config.supabase.anonKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: false
    }
  }
);

// Supabase Admin 클라이언트 (서버용 - service role key)
const supabaseAdmin = createClient(
  config.supabase.url || 'https://placeholder.supabase.co',
  config.supabase.serviceRoleKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// 연결 테스트
const testConnection = async () => {
  try {
    if (!config.supabase.url || config.supabase.url.includes('placeholder')) {
      logger.warn('⚠️  Supabase URL not configured. Database features will not work.');
      return false;
    }

    const { data, error } = await supabase.from('events').select('count').limit(1);
    
    if (error && error.code !== 'PGRST116') {
      logger.warn('Supabase connection test:', error.message);
    } else {
      logger.info('✅ Supabase connected successfully');
    }
    return true;
  } catch (error) {
    logger.error('❌ Supabase connection failed:', error.message);
    return false;
  }
};

module.exports = {
  supabase,
  supabaseAdmin,
  testConnection
};
