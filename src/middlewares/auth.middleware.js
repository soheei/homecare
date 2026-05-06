/**
 * Authentication Middleware
 *
 * [버그 수정]
 * 1. 프로덕션 Supabase Auth JWT 검증 실제 구현 (TODO 제거)
 * 2. Edge Device 시크릿 검증에 timingSafeEqual 적용 (timing attack 방지)
 */

const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const config = require('../config');
const logger = require('../utils/logger');

// ============================================================
// 사용자 인증 미들웨어
// ============================================================

/**
 * Supabase JWT 토큰 검증
 * - 개발 환경: 더미 유저로 스킵
 * - 프로덕션: Supabase Auth getUser 실제 검증
 */
const authenticateUser = async (req, res, next) => {
  try {
    // 개발 환경에서는 더미 사용자로 스킵
    if (config.nodeEnv === 'development') {
      req.user = {
        id: 'dev-user-001',
        email: 'dev@example.com',
        role: 'user'
      };
      return next();
    }

    // Authorization 헤더 확인
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authorization token required'
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token is empty'
      });
    }

    // [버그 1 수정] Supabase Auth로 실제 JWT 검증
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      logger.warn('[Auth] Invalid token:', error?.message);
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // 검증된 사용자 정보를 req.user에 주입
    req.user = {
      id: user.id,
      email: user.email,
      role: user.user_metadata?.role || 'user'
    };

    next();

  } catch (error) {
    logger.error('[Auth] Authentication error:', error);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// ============================================================
// Edge Device 인증 미들웨어
// ============================================================

/**
 * [버그 2 수정] timingSafeEqual로 시크릿 비교 (timing attack 방지)
 */
const safeCompare = (a, b) => {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    // 길이가 다르면 즉시 false — 단, 길이 노출을 막기 위해 동일 길이 버퍼로 패딩
    if (bufA.length !== bufB.length) {
      // 길이 자체가 다른 경우에도 timingSafeEqual을 한 번 돌려 일정 시간 소비
      crypto.timingSafeEqual(
        Buffer.alloc(bufA.length, 0),
        Buffer.alloc(bufA.length, 0)
      );
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
};

/**
 * Edge Device 인증
 * - X-Device-Id 헤더와 X-Device-Secret 헤더 확인
 */
const authenticateDevice = async (req, res, next) => {
  try {
    const deviceId = req.headers['x-device-id'];
    const deviceSecret = req.headers['x-device-secret'];

    // 개발 환경에서는 인증 스킵
    if (config.nodeEnv === 'development') {
      req.device = {
        id: deviceId || 'dev-device-001'
      };
      return next();
    }

    if (!deviceId) {
      return res.status(401).json({
        success: false,
        error: 'X-Device-Id header required'
      });
    }

    if (!deviceSecret) {
      return res.status(401).json({
        success: false,
        error: 'X-Device-Secret header required'
      });
    }

    // [버그 2 수정] timing-safe 비교
    const expectedSecret = config.edge.secret || '';
    if (!expectedSecret) {
      logger.error('[Auth] EDGE_DEVICE_SECRET is not configured');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error'
      });
    }

    if (!safeCompare(deviceSecret, expectedSecret)) {
      logger.warn(`[Auth] Invalid device secret for device: ${deviceId}`);
      return res.status(403).json({
        success: false,
        error: 'Invalid device credentials'
      });
    }

    req.device = { id: deviceId };
    next();

  } catch (error) {
    logger.error('[Auth] Device authentication error:', error);
    return res.status(401).json({
      success: false,
      error: 'Device authentication failed'
    });
  }
};

// ============================================================
// 관리자 권한 확인 미들웨어
// ============================================================

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }
  next();
};

module.exports = {
  authenticateUser,
  authenticateDevice,
  requireAdmin
};
