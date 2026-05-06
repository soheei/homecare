/**
 * API 테스트 - Health Check & Basic Routes
 */

const request = require('supertest');
const app = require('../src/app');

describe('Health Check', () => {
  it('GET /health should return 200', async () => {
    const res = await request(app).get('/health');
    
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('HomeCare Backend is running');
  });
});

describe('API Info', () => {
  it('GET /api should return API info', async () => {
    const res = await request(app).get('/api');
    
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.endpoints).toHaveProperty('chat');
    expect(res.body.endpoints).toHaveProperty('events');
    expect(res.body.endpoints).toHaveProperty('devices');
  });
});

describe('404 Handler', () => {
  it('should return 404 for unknown routes', async () => {
    const res = await request(app).get('/unknown-route');
    
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Resource not found');
  });
});
