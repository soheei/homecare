/**
 * Jest Setup File
 * 테스트 전에 실행되는 설정
 */

// 환경변수 설정
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';
process.env.LOG_LEVEL = 'error';

// 테스트 타임아웃 설정
jest.setTimeout(10000);

// 콘솔 로그 억제 (필요시)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };

// 테스트 후 정리
afterAll(async () => {
  // 연결 종료 등 정리 작업
});
