# Project Instructions

## 프로젝트 개요
- 홈캠 영상/이벤트를 AI(Claude)가 분석해 자연어로 브리핑하는 지능형 홈 모니터링 시스템 "HomeCare". 대상 사용자는 원격지 보호자(가족)로, "오늘 누가 왔어?" 같은 질문에 답하거나 낙상·비명 등 위험 신호를 감지해 알린다.
- 스택: Node.js + Express 백엔드(Claude API, MCP), Supabase(DB), React 19 + Vite + Tailwind 웹(`web/`), Python 엣지(`edge/` 전송 + YAMNet 오디오, `vision/` YOLO 카메라).
- 배포: 백엔드 = Render(https://homecare-9kcu.onrender.com, `main` push 시 자동 배포), 프론트 = Vercel(https://homecare-9sr8.vercel.app/), DB = Supabase, 엣지 = 라즈베리파이. 환경변수 값은 Render 대시보드/Pi의 `edge/.env`에만 있다.

## 현재 단계
- 2026-09-20 Pi 초기화 이후 백엔드는 Pi가 아니라 Render에서 돈다. MCP 서버는 백엔드의 `/mcp`(2026-09-27~).
- 엣지: 마이크→YAMNet 실시간 파이프라인 가동 중. 카메라 서비스 = `vision/` 파이프라인(YOLO 방문자·택배·낙상, 2026-09-28 통합). Pi/Render 실기 검증 항목은 `SH_README/hometalk_테스트_TODO.md`.
- 막힌 점·다음 할 일은 `인수인계.md`의 "알려진 이슈 / 남은 일"을 본다.

## 명령어
- 백엔드(루트): `npm install`, `npm run dev`(nodemon) / `dev:fresh`(3000 포트 kill 후) / `start`, `npm run kill`, `npm test`(Jest), `npm run lint`(eslint), `npm run mcp`(stdio, 로컬 외부 클라이언트 전용)
- 프론트(`web/`): `npm install`, `npm run dev`(http://localhost:5173/), `npm run build`(Vercel이 자동 실행), `npm run preview`, `npm run lint`(oxlint)
- 타입 체크: 없음(순수 JS, tsconfig 없음)
- 엣지(Pi): `python3 -m venv .venv && source .venv/bin/activate && pip install -r edge/requirements.txt`(시스템 pip은 PEP 668로 막힘), 전송 점검 `python -m edge.apps.send_test_event`, 카메라 서비스 `python -m vision.vision_pipeline`
- 엣지/vision 테스트(루트): `python -m unittest discover -s edge/tests -t .`, `python -m unittest discover -s vision/tests -t .`
- Jest에는 기존부터 실패하는 테스트 5건이 있다(수치·사유는 `인수인계.md`). 새 실패와 구분할 것.
- 배포: `main`에 push → Render 자동 배포. 확인은 `curl https://homecare-9kcu.onrender.com/health` — `environment`가 `production`이어야 한다.

## 구조
- 백엔드: `src/index.js` → `src/app.js`. `routes/` → `controllers/` → `services/` 3계층. `claude.service.js`가 Claude API 호출 + 도구 실행 루프.
- MCP: 도구 정의 `src/mcp/tools/`, 등록 `src/mcp/createServer.js`. `/mcp`(Streamable HTTP, `src/routes/mcp.routes.js`)가 서버이고, 웹 채팅은 `src/services/mcp.service.js`(MCP 클라이언트)로 호출한다. `src/mcp/server.js`는 같은 팩토리를 쓰는 stdio 버전(배포 안 함).
- 설정/검증: `src/config/index.js`(필수 환경변수 검증), `src/config/supabase.js`
- 웹: `web/`이 실제 배포되는 프론트. `frontend/`는 레거시 프로토타입으로 수정 불필요(백엔드가 SPA 폴백으로 서빙만 한다).
- DB: `database/schema.sql`(Supabase). 맨 아래 샘플 INSERT가 있어 파일 전체를 운영 DB에서 실행하면 가짜 데이터가 들어간다.
- 엣지: `edge/apps/`(실행 프로그램), `edge/transport/`(큐·전송, 변환표 `event_mapper.py`), `vision/`(YOLO), `yamnet/`(`core/` 모델·판정, `verification/` 평가, 설계 `Plan.md`)
- 테스트: `tests/`(Jest), `edge/tests/`, `vision/tests/`
- 배포 설정: `Dockerfile`(Render가 사용), `docker-compose.yml`(과거 Pi 배포용, 현재 경로 아님)
- 참조 문서(`SH_README/`): `hometalk_인수인계.md`, `hometalk_진행일지.md`, `DEPLOYMENT.md`(명령어·URL·환경변수 이름 목록), `hometalk_테스트_TODO.md`. 문서가 1000줄을 넘으면 새 파일을 만들어 이어 쓴다.

## 규칙
- 새 MCP 도구는 `src/mcp/tools/`에 정의(`inputSchema`, MCP 규격)+핸들러를 추가하고, 새 파일이면 `createServer.js`에 등록한다. 채팅은 `tools/list`로 자동 인식하므로 `claude.service.js`는 고치지 않는다. 도구 정의를 `input_schema`로 바꾸지 말 것(변환은 `mcp.service.js`가 한다).
- `/mcp`는 `MCP_AUTH_TOKEN` Bearer 인증이 필수다. 인증을 풀거나 개발환경 우회를 추가하지 말 것.
- `src/mcp/server.js`(stdio)는 상시 서비스로 띄우지 말 것(stdin EOF로 즉시 종료).
- 새 엔드포인트도 라우트/컨트롤러/서비스 3계층, `response.utils.js` 응답 포맷, `error.middleware.js` 중앙 에러 처리를 따른다. 공개 인터페이스(라우트 경로, 응답 스키마)는 바꾸라는 요청이 없으면 유지한다.
- 환경변수는 `src/config/index.js`에서 한 곳에 모아 처리한다. 서비스 파일에서 `process.env`를 직접 읽지 않는다(기존 예외 2곳: `src/index.js`의 `PORT`, `response.utils.js`의 `NODE_ENV`).
- `database/schema.sql` 테이블 구조를 바꿀 때는 운영 Supabase와 어긋나지 않는지 확인한다(마이그레이션 도구 없음, 동기화 여부 **확인 필요**).
- `.env`(루트, `web/`, `edge/`), `secrets/` 아래 파일은 읽거나 출력하지 않는다. 토큰·키·개인정보(`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EDGE_DEVICE_SECRET` 등)는 응답에 포함하지 않는다.
- 외부 서비스에 접근하는 명령은 항상 먼저 물어본다. 특정 사용자 계정의 서버 절대경로(`/home/alarmi/...`)를 코드에 커밋하지 않는다.
- 새 의존성은 사용자가 요청할 때만 추가한다.
- 파일 경로(파일·폴더 이동, 이름 변경)는 명시적인 요청 없이는 바꾸지 않는다.
- 실제 사고 이력:
  - **Render에 `NODE_ENV=development`를 넣으면 인증이 통째로 우회된다**(더미 유저로 통과). 배포 후 `/health`의 `environment`가 `production`인지, 토큰 없이 `/api/chat/history`가 401인지 확인.
  - **`events.id`와 `devices.id`를 혼동하지 말 것.** 엣지의 `HOMECARE_DEVICE_ID`(= `X-Device-Id`)는 `devices` 행 id여야 한다. 저장 성공은 응답 `id`가 UUID인지, Render 로그에 `Error creating event`가 없는지로 확인한다.
  - `schema.sql`을 바꿔도 운영 DB는 바뀌지 않는다. Supabase SQL Editor에서 필요한 `ALTER`만 따로 실행한다(파일 전체 실행 금지).

## 작업 방식
- 코드를 수정할 때마다 "무엇을 바꿨는지, 왜 그렇게 바꿨는지"를 설명한다. 동작한다는 확인만 하고 끝내지 않는다.
- 처음 나오는 개념이나 용어는 한두 문장으로 풀어서 설명한다.
- 모르는 것, 확인하지 못한 것은 추측하지 않고 모른다고 말한다(**확인 필요**로 표시).
- 큰 변경 전에는 먼저 계획을 보여주고 승인을 받는다. 여러 대안의 장단점을 비교해 최선을 고르고, 수정 전에 무엇을 왜 고치는지 알린다. 변경 범위는 요청에 맞게 최소화한다.
- 코드 변경 후 관련 Jest 테스트부터 실행한다(`npm test`). 테스트가 없는 영역이면 해당 모듈만 단독 실행해 문법·런타임 에러부터 확인한다.
- 단계가 끝날 때마다 `인수인계.md`를 최신 상태로 고치고, `진행일지.md`에 오늘 기록을 추가한다. 내린 결정과 그 이유는 `진행일지.md`에 적는다.
- `진행일지.md`에 기록한 문제 중 해결된 항목은 삭제하지 말고 취소선(`~~내용~~`)으로 "해결됨"을 표시한다. 새 일은 새 날짜 항목으로 추가한다.
- 수정 완료 시 어떤 파일을 어떻게 바꿨는지 요약한다.

## 문서 운영
- CLAUDE.md는 짧게 유지한다. 자세한 내용은 인수인계.md와 진행일지.md에 쓴다.
- 인수인계.md: 현재 상태, 막힌 점, 다음 할 일. 덮어써서 항상 최신으로 유지.
- 진행일지.md: 날짜별 한 일 / 이유 / 배운 점. 아래에 계속 추가.
- 세션 시작 때 인수인계.md를 읽는다. 진행일지.md는 필요할 때만 읽는다.
- CLAUDE.md를 수정할 때는 무엇을 왜 바꾸는지 알리고 승인받는다.
