/**
 * Chat API 테스트
 */

const request = require('supertest');
const app = require('../src/app');

describe('Chat API', () => {
  describe('POST /api/chat/message', () => {
    it('should require message field', async () => {
      const res = await request(app)
        .post('/api/chat/message')
        .send({});
      
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Message is required');
    });

    it('should accept valid message', async () => {
      const res = await request(app)
        .post('/api/chat/message')
        .send({ message: '오늘 누가 왔어?' });
      
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('message');
      expect(res.body.data).toHaveProperty('conversationId');
    });
  });

  describe('GET /api/chat/history', () => {
    it('should return conversation history', async () => {
      const res = await request(app).get('/api/chat/history');
      
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('conversations');
    });
  });

  describe('POST /api/chat/summary', () => {
    it('should generate daily summary', async () => {
      const res = await request(app)
        .post('/api/chat/summary')
        .send({ date: '2024-03-20' });
      
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('date');
      expect(res.body.data).toHaveProperty('summary');
    });
  });
});
