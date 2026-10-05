---
paths:
  - "src/mcp/**"
  - "src/services/mcp.service.js"
  - "src/routes/mcp.routes.js"
---

# MCP 규칙

- 새 도구는 `src/mcp/tools/`에 정의(`inputSchema`, MCP 규격)와 핸들러를 함께 추가한다. 새 파일이면 `src/mcp/createServer.js`에 등록한다.
- 웹 채팅은 `tools/list`로 도구를 자동 인식한다. 그래서 `claude.service.js`는 고치지 않는다.
- 도구 정의를 `input_schema`로 바꾸지 않는다. Claude API 형식으로의 변환은 `src/services/mcp.service.js`가 한다.
- `/mcp`(Streamable HTTP)는 `MCP_AUTH_TOKEN` Bearer 인증이 필수다. 인증을 풀거나 개발환경 우회를 추가하지 않는다.
- `src/mcp/server.js`(stdio)는 상시 서비스로 띄우지 않는다(stdin EOF로 즉시 종료). 로컬 외부 클라이언트 전용이며 배포하지 않는다.
- 도구를 바꾼 뒤에는 `tests/mcp.test.js`부터 실행한다.
