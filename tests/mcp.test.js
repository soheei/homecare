/**
 * MCP Server (Streamable HTTP, /mcp) 테스트
 * 실제 서버를 띄우고 MCP SDK 클라이언트로 접속해 프로토콜 동작을 확인
 */

jest.mock('../src/services/device.service', () => ({
  getDevices: jest.fn().mockResolvedValue([
    { id: 'dev-1', name: 'ReSpeaker 2-Mic HAT', type: 'microphone', location: '거실', status: 'online' }
  ]),
  getDeviceStatus: jest.fn()
}));

// 이벤트 서비스 mock: 실제 Supabase 행과 같은 snake_case 필드 사용
jest.mock('../src/services/event.service', () => {
  const rows = [
    { id: 'ev-danger', type: 'danger', description: '낙상 감지 테스트', danger_level: 'danger', image_url: null, timestamp: '2026-09-25T07:00:47Z' },
    { id: 'ev-sound', type: 'sound', description: '문 소리 감지', danger_level: 'normal', image_url: null, timestamp: '2026-09-22T07:02:56Z' },
    { id: 'ev-visitor', type: 'visitor', description: '방문 감지', danger_level: 'normal', image_url: 'https://example.com/v.jpg', timestamp: '2026-09-22T07:02:56Z' }
  ];
  return {
    // 실제 서비스처럼 type 필터 적용 (기간 필터는 고정 날짜 데이터라 생략)
    getEvents: jest.fn(async ({ type, limit = 20 } = {}) => {
      const events = rows.filter(r => !type || r.type === type).slice(0, limit);
      return { events, total: events.length, limit, offset: 0 };
    }),
    getEventsByDate: jest.fn().mockResolvedValue(rows),
    getEventById: jest.fn(async (id) => {
      const media = {
        'ev-scream': { id: 'ev-scream', type: 'danger', description: '비명 감지', danger_level: 'danger', audio_url: 'https://x.supabase.co/storage/v1/object/public/events/audio/1.wav', timestamp: '2026-09-25T07:00:47Z' }
      };
      return media[id] || rows.find(r => r.id === id) || null;
    }),
    getDailySummary: jest.fn(),
    getWeeklySummary: jest.fn().mockResolvedValue({ startDate: '2026-09-20', endDate: '2026-09-27', totalEvents: 3, dailySummaries: { '2026-09-22': { count: 2, types: { sound: 1, visitor: 1 } }, '2026-09-25': { count: 1, types: { danger: 1 } } } })
  };
});

// Claude API mock: 1차 응답은 tool_use, 2차 응답은 도구 결과를 본 최종 답변
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockCreate }
})));

const request = require('supertest');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const app = require('../src/app');
const config = require('../src/config');
const mcpService = require('../src/services/mcp.service');

let server;
let mcpUrl;

beforeAll((done) => {
  server = app.listen(0, '127.0.0.1', () => {
    mcpUrl = `http://127.0.0.1:${server.address().port}/mcp`;
    config.mcp.url = mcpUrl; // mcp.service가 테스트 서버에 접속하도록
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

const connectClient = async () => {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${config.mcp.authToken}` } }
  });
  await client.connect(transport);
  return client;
};

describe('MCP Server /mcp', () => {
  describe('인증', () => {
    it('토큰 없이 요청하면 401', async () => {
      const res = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

      expect(res.statusCode).toBe(401);
      expect(res.body.error.message).toBe('Unauthorized');
    });

    it('틀린 토큰이면 401', async () => {
      const res = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer wrong-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

      expect(res.statusCode).toBe(401);
    });

    it('GET은 405 (stateless 모드)', async () => {
      const res = await request(app).get('/mcp');
      expect(res.statusCode).toBe(405);
    });

    it('OAuth 탐색(/.well-known/*)은 SPA HTML이 아니라 404 JSON (mcp-remote가 HTML을 JSON 파싱하다 죽던 문제)', async () => {
      for (const p of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']) {
        const res = await request(app).get(p);
        expect(res.statusCode).toBe(404);
        expect(res.headers['content-type']).toMatch(/json/);
      }
    });
  });

  describe('MCP 프로토콜', () => {
    it('tools/list로 도구 11개를 반환', async () => {
      const client = await connectClient();
      const { tools } = await client.listTools();
      await client.close();

      expect(tools).toHaveLength(11);
      expect(tools.map(t => t.name)).toEqual(expect.arrayContaining([
        'get_today_events', 'get_danger_events', 'get_device_list'
      ]));
      expect(tools[0]).toHaveProperty('inputSchema');
    });

    it('tools/call로 도구를 실행하고 결과를 text로 반환', async () => {
      const client = await connectClient();
      const result = await client.callTool({ name: 'get_device_list', arguments: {} });
      await client.close();

      expect(result.isError).toBeFalsy();
      const devices = JSON.parse(result.content[0].text);
      expect(devices[0].name).toBe('ReSpeaker 2-Mic HAT');
    });

    it('get_danger_events는 DB의 danger_level로 위험 이벤트를 찾음', async () => {
      const client = await connectClient();
      const result = await client.callTool({ name: 'get_danger_events', arguments: { days: 7 } });
      await client.close();

      const events = JSON.parse(result.content[0].text);
      expect(events.map(e => e.id)).toEqual(['ev-danger']);
    });

    it('get_visitor_log는 날짜 생략 시 오늘만이 아니라 최근 7일 방문을 조회', async () => {
      const eventService = require('../src/services/event.service');
      // 5일 전 초인종 방문 (오늘 방문은 없음)
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      eventService.getEvents.mockImplementationOnce(async ({ type, startDate }) => {
        expect(type).toBe('visitor');
        expect(new Date(startDate).getTime()).toBeLessThan(Date.now() - 6.9 * 24 * 60 * 60 * 1000);
        const events = [{ id: 'ev-door', type: 'visitor', description: '초인종/방문 감지 (신뢰도 0.49)', image_url: null, timestamp: fiveDaysAgo }];
        return { events, total: 1, limit: 10, offset: 0 };
      });

      const client = await connectClient();
      const result = await client.callTool({ name: 'get_visitor_log', arguments: {} });
      await client.close();

      const visitors = JSON.parse(result.content[0].text);
      expect(visitors).toHaveLength(1);
      expect(visitors[0].description).toBe('초인종/방문 감지 (신뢰도 0.49)');
    });

    it('get_weekly_summary는 최근 7일 요약(날짜별·유형별 건수)을 반환', async () => {
      const client = await connectClient();
      const result = await client.callTool({ name: 'get_weekly_summary', arguments: {} });
      await client.close();

      expect(result.isError).toBeFalsy();
      const summary = JSON.parse(result.content[0].text);
      expect(summary.totalEvents).toBe(3);
      expect(summary.dailySummaries['2026-09-25'].types.danger).toBe(1);
    });

    it('get_visitor_log는 이벤트 id와 미디어 유무를 반환 (URL은 넘기지 않음)', async () => {
      const client = await connectClient();
      const result = await client.callTool({ name: 'get_visitor_log', arguments: { date: '2026-09-22' } });
      await client.close();

      const visitors = JSON.parse(result.content[0].text);
      expect(visitors).toHaveLength(1);
      expect(visitors[0]).toMatchObject({ id: 'ev-visitor', hasImage: true, hasAudio: false, hasVideo: false });
      expect(visitors[0]).not.toHaveProperty('imageUrl');
    });

    it('이벤트 목록 도구는 미디어 URL 대신 hasAudio/hasVideo/hasImage를 반환', async () => {
      const client = await connectClient();
      const result = await client.callTool({ name: 'get_events_by_date', arguments: { date: '2026-09-22' } });
      await client.close();

      const events = JSON.parse(result.content[0].text);
      const visitor = events.find(e => e.id === 'ev-visitor');
      expect(visitor.hasImage).toBe(true);
      expect(visitor).not.toHaveProperty('image_url');
    });

    it('get_event_media는 미디어가 있는 이벤트면 success + eventId (URL 없음)', async () => {
      const client = await connectClient();
      const result = await client.callTool({ name: 'get_event_media', arguments: { eventId: 'ev-scream' } });
      await client.close();

      const media = JSON.parse(result.content[0].text);
      expect(media).toMatchObject({ success: true, eventId: 'ev-scream', hasAudio: true, hasVideo: false });
      expect(JSON.stringify(media)).not.toContain('supabase.co');
    });

    it('get_event_media는 미디어가 없거나 없는 이벤트면 success:false + 사용자용 문구', async () => {
      const client = await connectClient();
      const noMedia = await client.callTool({ name: 'get_event_media', arguments: { eventId: 'ev-sound' } });
      const missing = await client.callTool({ name: 'get_event_media', arguments: { eventId: 'no-such-event' } });
      await client.close();

      expect(JSON.parse(noMedia.content[0].text)).toMatchObject({ success: false, error: '이 이벤트에는 저장된 소리나 영상이 없어요.' });
      expect(JSON.parse(missing.content[0].text)).toMatchObject({ success: false, error: '해당 이벤트를 찾을 수 없어요.' });
    });

    it('없는 도구 호출은 isError', async () => {
      const client = await connectClient();
      const result = await client.callTool({ name: 'no_such_tool', arguments: {} });
      await client.close();

      expect(result.isError).toBe(true);
    });
  });

  describe('mcp.service (채팅용 MCP 클라이언트)', () => {
    it('listTools는 Anthropic API 형식(input_schema)으로 변환', async () => {
      const tools = await mcpService.withSession(mcp => mcp.listTools());

      expect(tools).toHaveLength(11);
      expect(tools[0]).toHaveProperty('input_schema');
      expect(tools[0]).not.toHaveProperty('inputSchema');
    });

    it('callTool은 { content, isError }를 반환', async () => {
      const result = await mcpService.withSession(mcp => mcp.callTool('get_device_list', {}));

      expect(result.isError).toBe(false);
      expect(JSON.parse(result.content)[0].type).toBe('microphone');
    });
  });

  describe('claude.service 채팅 → MCP 도구 실행', () => {
    it('Claude의 tool_use를 MCP tools/call로 실행해 결과를 다시 전달', async () => {
      const claudeService = require('../src/services/claude.service');

      mockCreate
        .mockResolvedValueOnce({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_device_list', input: {} }]
        })
        .mockResolvedValueOnce({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '마이크가 켜져 있어요.' }],
          usage: {}
        });

      const result = await claudeService.chat({ message: '기기 상태 알려줘', userId: 'test-user' });

      expect(result.content).toBe('마이크가 켜져 있어요.');

      // 시스템 프롬프트에 현재 한국 날짜가 들어가야 "오늘/이번 주"를 해석할 수 있음
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
      expect(mockCreate.mock.calls[0][0].system).toContain('현재 시각');
      expect(mockCreate.mock.calls[0][0].system).toContain(today);

      // 1차 호출: MCP 서버에서 받은 도구 목록이 Anthropic 형식으로 전달됨
      const firstCall = mockCreate.mock.calls[0][0];
      expect(firstCall.tools).toHaveLength(11);
      expect(firstCall.tools[0]).toHaveProperty('input_schema');

      // 2차 호출: MCP tools/call 결과가 tool_result로 전달됨
      const secondCall = mockCreate.mock.calls[1][0];
      const toolResult = secondCall.messages[secondCall.messages.length - 1].content[0];
      expect(toolResult.type).toBe('tool_result');
      expect(toolResult.tool_use_id).toBe('toolu_1');
      expect(toolResult.is_error).toBe(false);
      expect(JSON.parse(toolResult.content)[0].name).toBe('ReSpeaker 2-Mic HAT');
    });
  });
});
