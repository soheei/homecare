# Project Instructions

## 세션 시작 시 필수 확인
- **새 창/새 세션에서 이 저장소로 서버 배포·인프라 작업을 시작할 때는, 답변하기 전에 먼저 `SH_README/` 폴더의 문서를 읽는다**:
  1. `SH_README/hometalk_인수인계.md` — 현재 배포 상태(프론트/백엔드 URL, 접근 정보, 운영 명령어, 알려진 이슈) 요약. 최신 상태로 유지됨.
  2. `SH_README/hometalk_진행일지.md` — 위 작업의 날짜별 실제 진행 로그(무엇을 했고 어떤 문제를 발견·수정했는지).
- 이 두 문서가 현재 라즈베리파이 서버 배포 상태의 최신 정보를 담고 있으므로, 코드만 보고 판단하지 말고 반드시 함께 확인할 것.
- 두 문서 모두 상단에 "최근 수정일시"를 명시한다 — **가장 최근 일시가 적힌 쪽을 우선시할 것**.

## Project Overview
- 이 저장소는 홈캠 영상/이벤트를 AI(Claude)가 분석해 자연어로 브리핑해주는 지능형 홈 모니터링 시스템 "HomeCare"의 백엔드 + 웹 프론트엔드. 대상 사용자는 원격지 보호자(가족)로, "오늘 누가 왔어?" 같은 질문에 답하거나 낙상·비명 등 위험 신호를 감지해 알린다.
- 주요 언어/프레임워크: Node.js + Express(백엔드), Anthropic Claude API(`@anthropic-ai/sdk`), MCP(`@modelcontextprotocol/sdk`), Supabase(DB), React 19 + Vite + Tailwind(웹 프론트엔드), Docker/Docker Compose(배포).
- 핵심 코드 위치:
  - 백엔드 진입점: `src/index.js` → `src/app.js`(Express 앱 설정)
  - 라우트/컨트롤러/서비스: `src/routes/`, `src/controllers/`, `src/services/` (`claude.service.js`가 Claude API 호출 + MCP 도구 실행 루프의 핵심)
  - MCP 도구 정의: `src/mcp/tools/` (`event.tools.js`, `camera.tools.js`) — **주의**: 백엔드는 이 도구들을 인프로세스로 직접 import해서 호출하며, `src/mcp/server.js`(stdio 기반 별도 MCP 서버)는 런타임에 쓰이지 않음. 상세 배경은 `SH_README/hometalk_진행일지.md` 2026-08-30 항목 참고.
  - 설정/검증: `src/config/index.js` (필수 환경변수 검증), `src/config/supabase.js`
  - 웹 프론트엔드(실제 배포되는 것): `web/` — Vite + React 19 + Tailwind, Vercel 배포 (https://homecare-9sr8.vercel.app/)
  - 레거시/프로토타입 프론트엔드(package.json 없음, 빌드/배포 안 됨 — **확인 필요**): `frontend/`
  - DB 스키마: `database/schema.sql` (Supabase PostgreSQL)
  - 배포 설정: `Dockerfile`, `docker-compose.yml` (mcp 서비스는 `profiles: ["mcp-manual"]`로 기본 실행에서 제외됨)
- 테스트 코드 위치: `tests/` (`app.test.js`, `chat.test.js`, `setup.js`), Jest 사용 (`jest.config.js`).

## Common Commands
- 설치: `npm install` (백엔드), `cd web && npm install` (프론트엔드)
- 로컬 실행(백엔드): `npm run dev` (nodemon), `npm run dev:fresh`(3000 포트 kill 후 재시작), `npm start`(프로덕션 모드)
- 로컬 실행(프론트엔드): `cd web && npm run dev` (Vite, 기본 http://localhost:5173/)
- 린트: 백엔드 `npm run lint` (eslint, `.eslintrc.json`), 프론트엔드 `cd web && npm run lint` (oxlint, `web/.oxlintrc.json`)
- 타입 체크: 별도 설정 없음(순수 JS, 백엔드/프론트 모두) — **확인 필요**(프론트는 `@types/react` 등 devDependency는 있으나 tsconfig 없음)
- 유닛 테스트: `npm test` (Jest)
- 빌드: 백엔드는 별도 빌드 없음(Node 직접 실행). 프론트엔드는 `cd web && npm run build` (Vite, Vercel이 자동 빌드)
- Docker 배포: `docker compose up -d --build backend` (Debian trixie 서버 apt 저장소엔 `docker compose` 플러그인이 없어 `docker-compose`(하이픈) 명령 사용 — 상세는 `SH_README/hometalk_인수인계.md` 참고)

## Working Rules
- `src/services/claude.service.js`가 MCP 도구 목록(`MCP_TOOLS`)과 핸들러 맵(`MCP_HANDLERS`)을 직접 관리하므로, `src/mcp/tools/`에 새 도구를 추가할 때는 이 파일도 함께 갱신해야 실제로 Claude가 호출할 수 있다.
- `src/mcp/server.js`(stdio MCP 서버)는 현재 런타임에서 쓰이지 않는 별도 산출물이다. 이 파일을 수정할 땐 "언젠가 외부 MCP 클라이언트가 붙을 수도 있다"는 전제로만 관리하고, 상시 서비스로 되살리려 하지 말 것(구조적으로 불가능 — 진행일지 참고).
- `.env`, `database/schema.sql`에 정의된 테이블 구조를 바꿀 때는 실제 Supabase 프로젝트의 스키마와 어긋나지 않는지 확인한다 — 이 저장소엔 마이그레이션 도구가 없어 `schema.sql`이 유일한 스키마 근거다(**확인 필요**: 실제 운영 DB와 동기화 여부).
- 경로는 명시적인 요청 없이는 수정하지 않는다.
- 새로운 의존성은 사용자가 요청할 때만 추가한다.
- 변경 범위는 항상 사용자 요청에 맞게 최소화한다.
- 코드 변경 후, 관련 Jest 테스트부터 실행한다(`npm test`). 테스트가 없는 영역이면 최소한 해당 모듈만 단독 실행해 문법·런타임 에러부터 확인한다.
- 과장하지 말고, 모르는 부분/확신 없는 부분은 "확인 필요"로 명시할 것.
- 여러 방식, 대안의 장단점을 먼저 비교 검토한 뒤 최선의 방향으로 진행.
- 기능 구현할 때 여러가지 대안을 검토하고 가장 최선의 대안을 선택. 코드를 무작정 수정하지 않고 수정 전에 어떤 걸 왜 수정해야 하는지 알려주고 실행.
- 코드 수정이 완료됐으면 어떤 파일을 어떻게 수정했는지 요약 브리핑.
- 서버에서 배포/인프라 작업을 한 날마다 `SH_README/hometalk_진행일지.md`에 이어서 기록한다 — 새 문서를 만들지 말 것. 배포 상태나 운영 방법이 바뀔 때만 `SH_README/hometalk_인수인계.md`를 함께 수정한다.
- `hometalk_진행일지.md`는 날짜별 작업 로그만 담고, 구조적인 내용(설계/현재 상태/운영 절차)은 `hometalk_인수인계.md`에만 남긴다. 진행일지에 기록한 문제 중 해결된 항목은 삭제하지 말고 취소선(`~~내용~~`)을 그어 "해결됨" 표시로 업데이트한다.
- 두 문서를 수정할 때마다 상단의 "최근 수정일시"를 그날 날짜와 변경 요약으로 갱신한다.
- `.md` 파일 속 내용이 1000줄 이상 너무 길어지면 새로 파일 만들어서 작성.

## Code Style
- 기존 코드 패턴을 우선 따라간다 — 컨트롤러/서비스/라우트 3계층 분리, `response.utils.js`를 통한 일관된 응답 포맷, `error.middleware.js`를 통한 중앙 에러 처리 패턴이 이미 확립돼 있으므로 새 엔드포인트도 동일한 구조를 따른다.
- 환경변수 검증은 `src/config/index.js`에서 한 곳에 모아 처리하는 패턴을 유지한다 — 개별 서비스 파일에서 `process.env`를 직접 읽지 않는다.
- API 공개 인터페이스(라우트 경로, 응답 스키마)는 명시적으로 바꾸라는 요청이 없는 한 유지한다.

## Security
- `.env`, `secrets/` 아래 파일을 읽거나 출력하지 않는다.
- 토큰, 키, 개인 정보(ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, EDGE_DEVICE_SECRET 등)는 응답에 포함하지 않는다.
- 외부 서비스에 접근하는 명령은 항상 먼저 물어본다.
- 서버 로컬 경로(예: `/home/alarmi/...`)처럼 특정 사용자 계정에 하드코딩된 절대경로를 코드에 커밋하지 말 것.

## 실수 내용
- (아직 기록된 항목 없음 — 이 저장소에서 반복될 만한 실수가 생기면 여기에 날짜와 함께 추가할 것)
