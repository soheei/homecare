/**
 * 채팅 대화 기록(멀티턴) 테스트
 * - 이전 메시지를 불러와 Claude에 전달하는지
 * - 남의 대화 ID로는 기록을 읽거나 메시지를 끼워 넣을 수 없는지
 * - 긴 대화는 "최근" 50개를 시간순으로 전달하는지
 */

// 메모리 가짜 DB (schema.sql의 conversations/messages 컬럼 사용)
const mockDb = { conversations: [], messages: [] };

const mockFrom = (table) => {
  let rows = [...mockDb[table]];
  let inserted = null;
  let patch = null;
  let deleting = false;
  let count = null;
  const q = {
    select: () => q,
    eq: (col, val) => { rows = rows.filter(r => r[col] === val); return q; },
    order: (col, { ascending }) => {
      rows.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (ascending ? 1 : -1));
      return q;
    },
    limit: (n) => { rows = rows.slice(0, n); return q; },
    range: (from, to) => { count = rows.length; rows = rows.slice(from, to + 1); return q; },
    maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
    single: () => Promise.resolve({ data: inserted ? inserted[0] : rows[0], error: null }),
    insert: (arr) => {
      inserted = arr.map((r, i) => ({ id: `${table}-new-${mockDb[table].length + i}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
      mockDb[table].push(...inserted);
      return q;
    },
    update: (p) => { patch = p; return q; },
    delete: () => { deleting = true; return q; },
    then: (resolve, reject) => {
      if (patch) rows.forEach(r => Object.assign(r, patch));
      if (deleting) {
        mockDb[table] = mockDb[table].filter(r => !rows.includes(r));
        // messages는 FK ON DELETE CASCADE
        if (table === 'conversations') {
          const ids = rows.map(r => r.id);
          mockDb.messages = mockDb.messages.filter(m => !ids.includes(m.conversation_id));
        }
      }
      return Promise.resolve({ data: rows, error: null, count: count ?? rows.length }).then(resolve, reject);
    }
  };
  return q;
};

// anon 클라이언트는 운영과 같이 RLS(auth.uid() 없음)에 막혀 항상 빈 결과
const mockRlsBlocked = () => {
  const q = {
    select: () => q, eq: () => q, order: () => q, limit: () => q, insert: () => q,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
    then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject)
  };
  return q;
};

jest.mock('../src/config/supabase', () => ({
  supabase: { from: mockRlsBlocked },
  supabaseAdmin: { from: mockFrom }
}));

// MCP 도구는 이 테스트 관심사가 아니므로 비워 둠
jest.mock('../src/services/mcp.service', () => ({
  withSession: (fn) => fn({ listTools: async () => [], callTool: async () => ({ content: '', isError: false }) })
}));

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockCreate }
})));

// 인증: 테스트에서는 X-Test-User 헤더의 사용자로 로그인한 것으로 처리
jest.mock('../src/middlewares/auth.middleware', () => {
  const pass = (req, res, next) => next();
  return {
    authenticateUser: (req, res, next) => {
      const id = req.headers['x-test-user'];
      if (!id) return res.status(401).json({ success: false, error: 'Authorization token required' });
      req.user = { id };
      next();
    },
    authenticateDevice: pass,
    authenticateMcp: pass,
    requireAdmin: pass
  };
});

const request = require('supertest');
const app = require('../src/app');
const claudeService = require('../src/services/claude.service');

const minutes = (n) => new Date(Date.UTC(2026, 8, 27, 0, n)).toISOString();

beforeEach(() => {
  mockDb.conversations = [
    { id: 'conv-mine', user_id: 'user-A', title: '최근 무슨 일 있었어?', created_at: minutes(0), updated_at: minutes(2) },
    { id: 'conv-mine-old', user_id: 'user-A', title: '어제 방문자', created_at: minutes(0), updated_at: minutes(1) },
    { id: 'conv-other', user_id: 'user-B', title: '남의 대화', created_at: minutes(0), updated_at: minutes(3) }
  ];
  mockDb.messages = [
    { conversation_id: 'conv-mine', role: 'user', content: '최근 무슨 일 있었어?', created_at: minutes(1) },
    { conversation_id: 'conv-mine', role: 'assistant', content: '낙상 감지가 1건 있었어요.', created_at: minutes(2) },
    { conversation_id: 'conv-other', role: 'user', content: '남의 비밀 대화', created_at: minutes(1) }
  ];
  mockCreate.mockReset().mockResolvedValue({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '응답' }],
    usage: {}
  });
});

describe('claude.service 대화 기록', () => {
  it('본인 대화면 이전 메시지를 불러와 Claude에 함께 전달', async () => {
    const result = await claudeService.chat({ message: '그게 언제였어?', conversationId: 'conv-mine', userId: 'user-A' });

    expect(result.conversationId).toBe('conv-mine');
    const sent = mockCreate.mock.calls[0][0].messages;
    expect(sent.map(m => m.content)).toEqual(['최근 무슨 일 있었어?', '낙상 감지가 1건 있었어요.', '그게 언제였어?']);

    // 새 질문/답변이 같은 대화에 저장됨
    expect(mockDb.messages.filter(m => m.conversation_id === 'conv-mine')).toHaveLength(4);
  });

  it('남의 대화 ID면 기록을 읽지 않고 새 대화로 시작 (남의 대화에 저장도 안 함)', async () => {
    const result = await claudeService.chat({ message: '안녕', conversationId: 'conv-other', userId: 'user-A' });

    expect(result.conversationId).not.toBe('conv-other');
    const sent = mockCreate.mock.calls[0][0].messages;
    expect(sent.map(m => m.content)).toEqual(['안녕']);
    expect(mockDb.messages.filter(m => m.conversation_id === 'conv-other')).toHaveLength(1);
  });

  it('새 대화는 첫 질문을 제목으로 저장하고, 메시지 저장 시 updated_at 갱신', async () => {
    const result = await claudeService.chat({ message: '오늘 누가 왔어?', userId: 'user-A' });

    const conv = mockDb.conversations.find(c => c.id === result.conversationId);
    expect(conv.title).toBe('오늘 누가 왔어?');
    expect(conv.user_id).toBe('user-A');

    const before = mockDb.conversations.find(c => c.id === 'conv-mine').updated_at;
    await claudeService.chat({ message: '이어서', conversationId: 'conv-mine', userId: 'user-A' });
    expect(mockDb.conversations.find(c => c.id === 'conv-mine').updated_at > before).toBe(true);
  });

  it('긴 대화는 최근 50개를 시간순으로 전달', async () => {
    mockDb.messages = Array.from({ length: 60 }, (_, i) => ({
      conversation_id: 'conv-mine',
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
      created_at: minutes(i)
    }));

    await claudeService.chat({ message: '새 질문', conversationId: 'conv-mine', userId: 'user-A' });

    const sent = mockCreate.mock.calls[0][0].messages;
    expect(sent).toHaveLength(51);
    expect(sent[0].content).toBe('msg-10');
    expect(sent[49].content).toBe('msg-59');
    expect(sent[50].content).toBe('새 질문');
  });
});

describe('채팅 기록 API (사용자별)', () => {
  it('GET /api/chat/history: 내 대화만 최근 대화 순으로', async () => {
    const res = await request(app).get('/api/chat/history').set('X-Test-User', 'user-A');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.conversations.map(c => c.id)).toEqual(['conv-mine', 'conv-mine-old']);
    expect(res.body.data.conversations[0].title).toBe('최근 무슨 일 있었어?');
    expect(res.body.data.total).toBe(2);
  });

  it('GET /api/chat/history?conversationId=: 내 대화의 메시지를 시간순으로', async () => {
    const res = await request(app).get('/api/chat/history?conversationId=conv-mine').set('X-Test-User', 'user-A');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(res.body.data.messages[1].content).toBe('낙상 감지가 1건 있었어요.');
  });

  it('남의 대화 메시지 조회는 404', async () => {
    const res = await request(app).get('/api/chat/history?conversationId=conv-other').set('X-Test-User', 'user-A');

    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('남의 비밀 대화');
  });

  it('DELETE: 내 대화 삭제 시 메시지도 함께 삭제', async () => {
    const res = await request(app).delete('/api/chat/history/conv-mine').set('X-Test-User', 'user-A');

    expect(res.statusCode).toBe(200);
    expect(mockDb.conversations.map(c => c.id)).not.toContain('conv-mine');
    expect(mockDb.messages.filter(m => m.conversation_id === 'conv-mine')).toHaveLength(0);
  });

  it('DELETE: 남의 대화는 404이고 삭제되지 않음', async () => {
    const res = await request(app).delete('/api/chat/history/conv-other').set('X-Test-User', 'user-A');

    expect(res.statusCode).toBe(404);
    expect(mockDb.conversations.map(c => c.id)).toContain('conv-other');
  });

  it('로그인 안 하면 401', async () => {
    const res = await request(app).get('/api/chat/history');
    expect(res.statusCode).toBe(401);
  });
});
