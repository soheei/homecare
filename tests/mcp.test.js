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
  });

  describe('MCP 프로토콜', () => {
    it('tools/list로 도구 9개를 반환', async () => {
      const client = await connectClient();
      const { tools } = await client.listTools();
      await client.close();

      expect(tools).toHaveLength(9);
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

      expect(tools).toHaveLength(9);
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

      // 1차 호출: MCP 서버에서 받은 도구 목록이 Anthropic 형식으로 전달됨
      const firstCall = mockCreate.mock.calls[0][0];
      expect(firstCall.tools).toHaveLength(9);
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
