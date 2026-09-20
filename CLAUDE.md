# Project Instructions

## 세션 시작 시 필수 확인
- **새 창/새 세션에서 이 저장소로 서버 배포·인프라 작업을 시작할 때는, 답변하기 전에 먼저 `SH_README/` 폴더의 문서를 읽는다**:
  1. `SH_README/hometalk_인수인계.md` — 현재 배포 상태(프론트/백엔드 URL, 접근 정보, 운영 명령어, 알려진 이슈) 요약. 최신 상태로 유지됨.
  2. `SH_README/hometalk_진행일지.md` — 위 작업의 날짜별 실제 진행 로그(무엇을 했고 어떤 문제를 발견·수정했는지).
  3. `SH_README/DEPLOYMENT.md` — 실행 명령어 전체 목록, 서버 URL(Frontend/Backend/MCP), Raspberry Pi(엣지) 접속·실행 정보, 환경변수 이름 목록을 한 번에 보는 참조 문서.
- 이 문서들이 현재 배포 상태(백엔드=Render, 프론트=Vercel, 엣지=라즈베리파이)의 최신 정보를 담고 있으므로, 코드만 보고 판단하지 말고 반드시 함께 확인할 것. (2026-09-20 Pi 초기화 이후 백엔드는 Pi가 아니라 Render에서 돈다 — 과거 Pi/Docker/Tailscale Funnel 기록은 진행일지에만 남아 있음.)
- 세 문서 모두 상단에 "최근 수정일시"를 명시한다 — **가장 최근 일시가 적힌 쪽을 우선시할 것**.

## Project Overview
- 이 저장소는 홈캠 영상/이벤트를 AI(Claude)가 분석해 자연어로 브리핑해주는 지능형 홈 모니터링 시스템 "HomeCare"의 백엔드 + 웹 프론트엔드. 대상 사용자는 원격지 보호자(가족)로, "오늘 누가 왔어?" 같은 질문에 답하거나 낙상·비명 등 위험 신호를 감지해 알린다.
- 주요 언어/프레임워크: Node.js + Express(백엔드), Anthropic Claude API(`@anthropic-ai/sdk`), MCP(`@modelcontextprotocol/sdk`), Supabase(DB), React 19 + Vite + Tailwind(웹 프론트엔드), Docker(백엔드 이미지, Render가 Dockerfile로 빌드), Python(엣지: YAMNet 오디오 분류 + 이벤트 전송).
- 배포 구성(2026-09-20 기준): 백엔드 = Render Web Service(https://homecare-9kcu.onrender.com, `main` push 시 자동 배포), 프론트 = Vercel, DB = Supabase, 엣지 = 라즈베리파이(`edge/` 코드가 `POST /api/events`로 전송). 환경변수 값은 Render 대시보드/Pi의 `edge/.env`에만 있다.
- 핵심 코드 위치:
  - 백엔드 진입점: `src/index.js` → `src/app.js`(Express 앱 설정)
  - 라우트/컨트롤러/서비스: `src/routes/`, `src/controllers/`, `src/services/` (`claude.service.js`가 Claude API 호출 + MCP 도구 실행 루프의 핵심)
  - MCP 도구 정의: `src/mcp/tools/` (`event.tools.js`, `camera.tools.js`) — **주의**: 백엔드는 이 도구들을 인프로세스로 직접 import해서 호출하며, `src/mcp/server.js`(stdio 기반 별도 MCP 서버)는 런타임에 쓰이지 않음. 상세 배경은 `SH_README/hometalk_진행일지.md` 2026-08-30 항목 참고.
  - 설정/검증: `src/config/index.js` (필수 환경변수 검증), `src/config/supabase.js`
  - 웹 프론트엔드(실제 배포되는 것): `web/` — Vite + React 19 + Tailwind, Vercel 배포 (https://homecare-9sr8.vercel.app/)
  - 레거시/프로토타입 프론트엔드(package.json 없음, 빌드/배포 안 됨 — **확인 필요**): `frontend/`
  - DB 스키마: `database/schema.sql` (Supabase PostgreSQL). **주의**: 맨 아래에 개발용 샘플 데이터 INSERT가 있어 파일 전체를 운영 DB에서 실행하면 가짜 이벤트/기기가 들어간다.
  - 엣지(라즈베리파이) 전송 코드: `edge/` — 감지기가 `EventEmitter.emit()`만 호출하면 쿨다운 → SQLite 큐(`edge/data/`) → sender가 `POST /api/events`로 전송(재시도 포함). 카테고리→`type`/`dangerLevel` 변환표는 `edge/event_mapper.py`. 마이크→YAMNet 실시간 파이프라인(`edge/stream_pipeline.py`)과 YOLO 연동은 **아직 없음**.
  - 오디오 분류 실험/설계: `yamnet/` (`core/` = 모델 로딩·카테고리·판정 규칙, `verification/` = ESC-50 평가 스크립트, 설계는 `yamnet/Plan.md`)
  - 배포 설정: `Dockerfile`(Node 20, Render가 사용), `docker-compose.yml`(과거 Pi 배포용, 현재 배포 경로 아님. mcp 서비스는 `profiles: ["mcp-manual"]`로 기본 실행에서 제외됨)
- 테스트 코드 위치: `tests/` (`app.test.js`, `chat.test.js`, `setup.js`), Jest 사용 (`jest.config.js`). 현재 5건 실패/2건 통과 상태(인증 401로 보임, 원인 미확인 — 새 변경과 무관하게 기존부터 실패). 엣지는 `python -m unittest discover -s edge/tests -t .`(15개).

## Common Commands
- 설치: `npm install` (백엔드), `cd web && npm install` (프론트엔드)
- 로컬 실행(백엔드): `npm run dev` (nodemon), `npm run dev:fresh`(3000 포트 kill 후 재시작), `npm start`(프로덕션 모드)
- 로컬 실행(프론트엔드): `cd web && npm run dev` (Vite, 기본 http://localhost:5173/)
- 린트: 백엔드 `npm run lint` (eslint, `.eslintrc.json`), 프론트엔드 `cd web && npm run lint` (oxlint, `web/.oxlintrc.json`)
- 타입 체크: 별도 설정 없음(순수 JS, 백엔드/프론트 모두) — **확인 필요**(프론트는 `@types/react` 등 devDependency는 있으나 tsconfig 없음)
- 유닛 테스트: `npm test` (Jest)
- 빌드: 백엔드는 별도 빌드 없음(Node 직접 실행). 프론트엔드는 `cd web && npm run build` (Vite, Vercel이 자동 빌드)
- 백엔드 배포: `main`에 push하면 Render가 자동 재배포한다(별도 명령 없음). 상태 확인은 `curl https://homecare-9kcu.onrender.com/health` — 응답의 `environment`가 반드시 `production`이어야 한다. (과거의 `docker-compose up -d --build backend`는 Pi 시절 방식 — 상세는 `SH_README/`)
- 엣지(Pi): `python3 -m venv .venv && source .venv/bin/activate && pip install -r edge/requirements.txt` (시스템 pip은 PEP 668로 막힘). 전송 경로 점검: `python -m edge.send_test_event`.

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
- `.env`(루트, `web/.env`, `edge/.env` 포함), `secrets/` 아래 파일을 읽거나 출력하지 않는다.
- 토큰, 키, 개인 정보(ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, EDGE_DEVICE_SECRET 등)는 응답에 포함하지 않는다.
- 외부 서비스에 접근하는 명령은 항상 먼저 물어본다.
- 서버 로컬 경로(예: `/home/alarmi/...`)처럼 특정 사용자 계정에 하드코딩된 절대경로를 코드에 커밋하지 말 것.

## 실수 내용
- (2026-09-20) **Render 환경변수에 `NODE_ENV=development`를 넣으면 인증이 통째로 우회된다.** `auth.middleware.js`가 development에서 토큰 검사를 건너뛰고 더미 유저로 통과시킨다 — 로컬 `.env`를 통째로 복사해 붙여넣다 발생. 배포 후엔 `/health`의 `environment`가 `production`인지, 토큰 없이 `/api/chat/history`가 401인지 반드시 확인할 것.
- (2026-09-20) **`events.id`와 `devices.id`를 혼동하지 말 것.** 엣지의 `HOMECARE_DEVICE_ID`(= `X-Device-Id`)는 Supabase **`devices`** 테이블의 행 id여야 한다. `events` 행의 id를 넣으면 `events.device_id` 외래키 위반으로 저장이 실패한다.
- (2026-09-20) 이벤트 저장이 실패해도 예전에는 `temp_` ID로 201 성공을 응답했다(`event.service.js`, 현재는 500으로 수정됨). API 응답만 보고 저장됐다고 판단하지 말고 응답 `id`가 UUID인지 / Render 로그에 `Error creating event`가 없는지 확인할 것.
- (2026-09-20) `database/schema.sql`을 바꿨다고 운영 DB가 바뀌는 것이 아니다. `video_url` 컬럼처럼 코드는 쓰는데 운영 DB엔 없는 경우가 실제로 있었으니, 스키마 변경은 Supabase SQL Editor에서 따로 적용해야 한다(파일 전체 실행은 샘플 데이터가 섞이므로 필요한 `ALTER`만 실행).
