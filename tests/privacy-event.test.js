/**
 * 사생활 모드 기기의 이벤트는 첨부(사진·소리·영상)를 저장하지 않고 글만 저장
 */

let mockPrivacy;
const mockUpload = jest.fn().mockResolvedValue('https://x.supabase.co/storage/v1/object/public/events/a.jpg');
const mockCreate = jest.fn(async (data) => ({ id: 'ev-new', ...data }));

jest.mock('../src/middlewares/auth.middleware', () => {
  const pass = (req, res, next) => next();
  return {
    authenticateUser: pass,
    authenticateMcp: pass,
    requireAdmin: pass,
    authenticateDevice: (req, res, next) => { req.device = { id: 'dev-1' }; next(); }
  };
});
jest.mock('../src/services/device.service', () => ({
  isPrivacyMode: jest.fn(async () => mockPrivacy)
}));
jest.mock('../src/services/storage.service', () => ({
  uploadFile: (...args) => mockUpload(...args),
  signEventMedia: async (e) => e
}));
jest.mock('../src/services/event.service', () => ({
  createEvent: (...args) => mockCreate(...args)
}));
jest.mock('../src/services/notification.service', () => ({ notifyEvent: jest.fn() }));
jest.mock('../src/services/accessLog.service', () => ({ record: jest.fn() }));
jest.mock('../src/config/supabase', () => ({ supabase: {}, supabaseAdmin: {} }));

const request = require('supertest');
const app = require('../src/app');

const post = () => request(app)
  .post('/api/events')
  .field('type', 'motion')
  .field('description', '사람 감지')
  .field('imageUrl', 'https://example.com/leak.jpg')
  .attach('image', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'a.jpg', contentType: 'image/jpeg' });

beforeEach(() => { mockUpload.mockClear(); mockCreate.mockClear(); });

describe('POST /api/events 사생활 모드', () => {
  it('켜져 있으면 업로드하지 않고 미디어 URL도 비운 채 글만 저장', async () => {
    mockPrivacy = true;
    const res = await post();

    expect(res.statusCode).toBe(201);
    expect(mockUpload).not.toHaveBeenCalled();
    const saved = mockCreate.mock.calls[0][0];
    expect(saved).toMatchObject({ description: '사람 감지', image_url: null, audio_url: null, video_url: null, device_id: 'dev-1' });
  });

  it('꺼져 있으면 기존처럼 업로드해 저장', async () => {
    mockPrivacy = false;
    const res = await post();

    expect(res.statusCode).toBe(201);
    expect(mockUpload).toHaveBeenCalledWith(expect.anything(), 'events', 'dev-1');
    expect(mockCreate.mock.calls[0][0].image_url).toMatch(/a\.jpg$/);
  });
});
