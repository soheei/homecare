/**
 * API Routes Index
 */

const express = require('express');
const router = express.Router();

const chatRoutes = require('./chat.routes');
const eventRoutes = require('./event.routes');
const deviceRoutes = require('./device.routes');

// API 버전 정보
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'HomeCare API',
    version: '1.0.0',
    endpoints: {
      chat: '/api/chat',
      events: '/api/events',
      devices: '/api/devices'
    }
  });
});

// 라우트 등록
router.use('/chat', chatRoutes);
router.use('/events', eventRoutes);
router.use('/devices', deviceRoutes);

module.exports = router;
