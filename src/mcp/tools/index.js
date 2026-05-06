/**
 * MCP Tools Index
 * 모든 MCP 도구들을 통합 관리
 */

const eventTools = require('./event.tools');
const cameraTools = require('./camera.tools');

// 모든 도구 정의 통합
const allDefinitions = [
  ...eventTools.definitions,
  ...cameraTools.definitions
];

// 모든 핸들러 통합
const allHandlers = {
  ...eventTools.handlers,
  ...cameraTools.handlers
};

/**
 * 도구 이름으로 핸들러 찾기
 */
const getHandler = (toolName) => {
  return allHandlers[toolName] || null;
};

/**
 * 도구 존재 여부 확인
 */
const hasTool = (toolName) => {
  return toolName in allHandlers;
};

/**
 * 모든 도구 이름 목록
 */
const getToolNames = () => {
  return Object.keys(allHandlers);
};

module.exports = {
  definitions: allDefinitions,
  handlers: allHandlers,
  getHandler,
  hasTool,
  getToolNames
};
