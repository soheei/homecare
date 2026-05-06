/**
 * MCP 도구 직접 테스트 스크립트
 * Claude API 크레딧 없이 MCP 핸들러가 DB와 잘 연결됐는지 확인
 *
 * 실행: node test-mcp.js
 */

require('dotenv').config();

const eventTools  = require('./src/mcp/tools/event.tools');
const cameraTools = require('./src/mcp/tools/camera.tools');

const OK   = '✅';
const FAIL = '❌';
const INFO = '🔍';

async function runTest(label, fn) {
  process.stdout.write(`${INFO} ${label} ... `);
  try {
    const result = await fn();
    const preview = JSON.stringify(result).substring(0, 120);
    console.log(`${OK}\n   결과: ${preview}${preview.length === 120 ? '...' : ''}\n`);
    return true;
  } catch (error) {
    console.log(`${FAIL}\n   에러: ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log('\n===========================================');
  console.log(' MCP 도구 연동 테스트');
  console.log('===========================================\n');

  let passed = 0;
  let total  = 0;

  // ── Event Tools ──────────────────────────────
  console.log('[ Event Tools ]\n');

  total++;
  if (await runTest('오늘 이벤트 조회 (get_today_events)', async () => {
    return await eventTools.handlers.get_today_events({});
  })) passed++;

  total++;
  if (await runTest('날짜별 이벤트 조회 (get_events_by_date)', async () => {
    const today = new Date().toISOString().split('T')[0];
    return await eventTools.handlers.get_events_by_date({ date: today });
  })) passed++;

  total++;
  if (await runTest('방문자 기록 조회 (get_visitor_log)', async () => {
    return await eventTools.handlers.get_visitor_log({ limit: 5 });
  })) passed++;

  total++;
  if (await runTest('위험 이벤트 조회 (get_danger_events)', async () => {
    return await eventTools.handlers.get_danger_events({ days: 7 });
  })) passed++;

  total++;
  if (await runTest('일별 요약 (get_daily_summary)', async () => {
    const today = new Date().toISOString().split('T')[0];
    return await eventTools.handlers.get_daily_summary({ date: today });
  })) passed++;

  // ── Camera Tools ─────────────────────────────
  console.log('[ Camera Tools ]\n');

  total++;
  if (await runTest('디바이스 목록 (get_device_list)', async () => {
    return await cameraTools.handlers.get_device_list({});
  })) passed++;

  total++;
  if (await runTest('카메라 상태 (get_camera_status)', async () => {
    return await cameraTools.handlers.get_camera_status({});
  })) passed++;

  total++;
  if (await runTest('최근 캡처 조회 (get_latest_capture)', async () => {
    return await cameraTools.handlers.get_latest_capture({
      deviceId: '22222222-2222-2222-2222-222222222222'
    });
  })) passed++;

  total++;
  if (await runTest('캡처 요청 (request_capture)', async () => {
    return await cameraTools.handlers.request_capture({
      deviceId: '22222222-2222-2222-2222-222222222222'
    });
  })) passed++;

  // ── 결과 요약 ─────────────────────────────────
  console.log('===========================================');
  console.log(` 결과: ${passed}/${total} 통과`);

  if (passed === total) {
    console.log(' ✅ MCP 도구 전체 정상 동작!');
    console.log(' → API 크레딧 충전하면 Claude 채팅 즉시 사용 가능\n');
  } else {
    console.log(' ⚠️  일부 도구 실패 — 위 에러 메시지 확인\n');
  }
  console.log('===========================================\n');
}

main();
