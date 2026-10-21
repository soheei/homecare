/**
 * 미디어 업로드 경로 — 기기별 폴더 + 추측할 수 없는 이름, 확장자는 안전한 값만
 */

const mockUpload = jest.fn().mockResolvedValue({ data: {}, error: null });
jest.mock('../src/config/supabase', () => ({
  supabase: {},
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: (...args) => mockUpload(...args),
        getPublicUrl: (p) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/events/${p}` } })
      })
    }
  }
}));

const storageService = require('../src/services/storage.service');

const file = (originalname, mimetype) => ({ originalname, mimetype, buffer: Buffer.from('x') });

beforeEach(() => mockUpload.mockClear());

describe('uploadFile 경로', () => {
  it('{기기id}/{종류}/{uuid}.확장자 형태이고 호출마다 다른 이름', async () => {
    const a = await storageService.uploadFile(file('a.mp4', 'video/mp4'), 'events', 'dev-123');
    const b = await storageService.uploadFile(file('a.mp4', 'video/mp4'), 'events', 'dev-123');
    const re = /\/events\/dev-123\/video\/[0-9a-f-]{36}\.mp4$/;
    expect(a).toMatch(re);
    expect(b).toMatch(re);
    expect(a).not.toBe(b);
  });

  it('경로를 깨는 기기 id·확장자는 안전한 값으로 대체', async () => {
    const url = await storageService.uploadFile(file('x.p/../ng', 'image/png'), 'events', '../evil');
    expect(url).toMatch(/\/events\/unknown\/image\/[0-9a-f-]{36}$/);
  });
});
