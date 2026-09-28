/**
 * 이벤트 사진/소리/영상 서명 URL 테스트 (events 버킷은 private)
 * - 앱 조회(GET /api/events, /api/events/:id) 응답에서 저장된 public URL이 서명 URL로 바뀌는지
 * - 외부 URL/없는 값은 그대로, 서명 실패 시 열리지 않는 링크 대신 null
 */

const STORAGE = 'https://proj.supabase.co/storage/v1/object/public/events';

const mockRows = [
  {
    id: 'ev-fall', type: 'danger', description: '낙상 의심',
    image_url: `${STORAGE}/image/1_1.jpg`, audio_url: null, video_url: `${STORAGE}/video/1_2.mp4`
  },
  {
    id: 'ev-ext', type: 'visitor', description: '외부 URL 사진',
    image_url: 'https://example.com/a.jpg', audio_url: null, video_url: null
  }
];

const mockCreateSignedUrls = jest.fn();
const mockFrom = () => {
  let rows = [...mockRows];
  const q = {
    select: () => q,
    order: () => q,
    range: () => q,
    eq: (col, v) => { rows = rows.filter(r => r[col] === v); return q; },
    single: () => Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: new Error('none') }),
    then: (resolve, reject) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject)
  };
  return q;
};

jest.mock('../src/config/supabase', () => {
  const admin = {
    from: (...args) => mockFrom(...args),
    storage: { from: () => ({ createSignedUrls: (...args) => mockCreateSignedUrls(...args) }) }
  };
  return { supabase: admin, supabaseAdmin: admin };
});

jest.mock('../src/middlewares/auth.middleware', () => {
  const pass = (req, res, next) => next();
  return {
    authenticateUser: (req, res, next) => { req.user = { id: 'user-1' }; next(); },
    authenticateDevice: pass,
    authenticateMcp: pass,
    requireAdmin: pass
  };
});

const request = require('supertest');
const app = require('../src/app');

const signAll = (paths, expiresIn) => Promise.resolve({
  data: paths.map(p => ({ path: p, signedUrl: `https://proj.supabase.co/storage/v1/object/sign/events/${p}?token=t&exp=${expiresIn}`, error: null })),
  error: null
});

beforeEach(() => mockCreateSignedUrls.mockReset());

describe('이벤트 미디어 서명 URL', () => {
  test('목록: Storage URL은 한 번의 요청으로 서명 URL로 바뀌고 외부 URL/null은 그대로', async () => {
    mockCreateSignedUrls.mockImplementation(signAll);

    const res = await request(app).get('/api/events');

    expect(res.status).toBe(200);
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['image/1_1.jpg', 'video/1_2.mp4'], 3600);

    const [fall, ext] = res.body.data.events;
    expect(fall.image_url).toMatch(/\/object\/sign\/events\/image\/1_1\.jpg\?token=/);
    expect(fall.video_url).toMatch(/\/object\/sign\/events\/video\/1_2\.mp4\?token=/);
    expect(fall.audio_url).toBeNull();
    expect(ext.image_url).toBe('https://example.com/a.jpg');
    expect(res.body.data.total).toBe(2); // 응답 구조 유지
  });

  test('상세: 영상 URL이 서명 URL로 바뀜', async () => {
    mockCreateSignedUrls.mockImplementation(signAll);

    const res = await request(app).get('/api/events/ev-fall');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('ev-fall');
    expect(res.body.data.video_url).toMatch(/\/object\/sign\/events\/video\/1_2\.mp4\?token=/);
  });

  test('서명 실패: Storage URL은 null(열리지 않는 링크 주지 않음), 조회 자체는 성공', async () => {
    mockCreateSignedUrls.mockResolvedValue({ data: null, error: new Error('bucket not found') });

    const res = await request(app).get('/api/events/ev-fall');

    expect(res.status).toBe(200);
    expect(res.body.data.image_url).toBeNull();
    expect(res.body.data.video_url).toBeNull();
  });

  test('Storage 파일이 없는 이벤트는 서명 요청을 보내지 않음', async () => {
    const res = await request(app).get('/api/events/ev-ext');

    expect(res.status).toBe(200);
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
    expect(res.body.data.image_url).toBe('https://example.com/a.jpg');
  });
});
