# HomeCare Backend

MCP & LLM 기반 지능형 홈캠 AI 브리핑 시스템 (백엔드 + 웹 프론트엔드 + 엣지 전송 코드)

> 최근 수정일시: 2026-09-27 (MCP 서버 `/mcp` 전환, 채팅 기록·카드 UI, 한국 시간 처리, 홈 브리핑 서버 저장 반영)

## 📋 개요

HomeCare는 AI가 집 안 상황을 분석하고 자연어로 대화할 수 있는 지능형 홈 모니터링 시스템입니다.

- **"오늘 누가 왔어?"** → AI가 방문 기록을 검색하여 답변
- **위험 상황 감지** → 낙상, 비명 등 위험 신호 시 즉시 알림
- **하루 요약 리포트** → 하루 동안의 주요 이벤트 자동 정리

## 🏗️ 아키텍처

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web App       │────▶│  Backend Server │────▶│   Claude API    │
│ (React, Vercel) │     │ (Node, Render)  │     │   (Anthropic)   │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 ▼                       ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │    Supabase     │     │   MCP 서버      │
                        │   (Database)    │◀────│ (POST /mcp)     │
                        └─────────────────┘     └─────────────────┘
                                 ▲
                                 │ POST /api/events
                        ┌─────────────────┐
                        │  Edge Device    │
                        │ (Raspberry Pi)  │
                        │ YAMNet / YOLO   │
                        └─────────────────┘
```

- 백엔드 안에 MCP 서버(`/mcp`, Streamable HTTP)가 있고, 웹 채팅은 MCP 클라이언트(`src/services/mcp.service.js`)로 이 서버에 접속해 `tools/list`·`tools/call`을 호출합니다. 같은 `/mcp`에 Claude Desktop 같은 외부 MCP 클라이언트도 붙일 수 있습니다(`MCP_AUTH_TOKEN` Bearer 인증 필수, 아래 "MCP 서버 테스트" 참고).
- 모든 날짜/시각은 한국 시간(KST) 기준입니다. DB의 `timestamp`는 UTC이므로, 도구 결과에 한국 시간 문자열(`timeKst`)을 함께 넣어 모델이 UTC를 그대로 읽지 않게 합니다.
- 엣지는 감지 결과를 `edge/`의 전송 모듈(큐 + 재시도)을 통해 백엔드로 보냅니다. 상세는 [edge/README.md](edge/README.md).

## 🌐 배포 (2026-09-20 기준)

| 구성 | 위치 | 주소/비고 |
|---|---|---|
| 프론트엔드 | Vercel | https://homecare-9sr8.vercel.app/ (로컬: http://localhost:5173/) |
| 백엔드 | Render Web Service (Docker) | https://homecare-9kcu.onrender.com — `main`에 push하면 자동 재배포, `/health`로 상태 확인 |
| DB | Supabase | PostgreSQL + Storage |
| 엣지 | 라즈베리파이 | `edge/` 실행 (백엔드로 이벤트 전송) |

- 이전에는 백엔드를 라즈베리파이의 Docker + Tailscale Funnel로 운영했으나, Pi 초기화(2026-09-20)를 계기로 Render로 옮겼습니다. 그 이력은 [SH_README/hometalk_진행일지.md](SH_README/hometalk_진행일지.md) 참고.
- Render **무료 플랜은 유휴 시 잠들어** 첫 요청이 20초 넘게 걸릴 수 있습니다(관측: 22.7초). 상시 사용/시연이면 유료 플랜을 검토하세요.
- 프론트는 빌드 시점에 `VITE_API_URL`이 코드에 박히므로, 백엔드 주소를 바꾸면 **Vercel에서 환경변수 수정 후 재배포**해야 합니다.

### 배포 시 반드시 확인 (실제로 겪은 문제)

1. Render 환경변수의 `NODE_ENV`가 `production`인지 — `development`면 인증이 우회됩니다. 배포 후 `/health`의 `environment` 값과, 토큰 없이 `/api/chat/history`가 401인지 확인하세요.
2. `ALLOWED_ORIGINS`에 프론트 주소(`https://homecare-9sr8.vercel.app`, 끝에 `/` 없이)가 들어 있는지 — 없으면 브라우저에서 CORS 오류가 납니다.
3. Supabase `events` 테이블에 `video_url` 컬럼이 있는지 — 없으면 이벤트 저장이 실패합니다(`database/schema.sql`의 `ALTER TABLE` 참고).
4. Anthropic API 크레딧이 남아 있는지 — 부족하면 채팅이 `credit balance is too low`(400)로 실패합니다.
5. 새 테이블은 Supabase SQL Editor에서 **해당 블록만** 실행했는지 — `schema.sql` 전체 실행은 샘플 데이터가 섞입니다. 홈 브리핑 저장용 `briefings`(2026-09-27 추가), 웹 푸시용 `push_subscriptions`/`notification_preferences`.

### 알려진 이슈

- `src/mcp/server.js`(stdio, `npm run mcp`)는 `.env`를 읽지 않고 로그를 stdout으로 내보내 MCP 메시지와 섞입니다. 외부 클라이언트 테스트는 `/mcp`(HTTP)로 하세요.
- `npm test`는 34건 통과 / 5건 실패입니다. 실패 5건은 기존부터: `chat.test.js` 4건(토큰 없이 요청해 401 — 테스트가 낡음), `app.test.js` 404 1건(레거시 `frontend/` SPA 폴백).
- `docker-compose.yml`은 과거 Pi 배포용이며 현재 배포 경로가 아닙니다.

## 🚀 시작하기

### 요구사항

- Node.js 20 이상 권장 (`package.json`은 18 이상 허용이지만 `@supabase/supabase-js`가 Node 20+를 요구하고 Dockerfile도 `node:20`)
- npm 또는 yarn
- Supabase 계정
- Anthropic API Key (크레딧 필요)

### 설치

```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일 수정

# 3. 개발 서버 실행
npm run dev
```

웹 프론트엔드는 [web/README.md](web/README.md), 엣지는 [edge/README.md](edge/README.md)를 참고하세요.

### 환경 변수 (백엔드)

값은 절대 저장소에 올리지 않습니다. 운영에서는 Render 대시보드의 Environment에 설정합니다.

```env
# 서버 (PORT는 Render가 주입하므로 운영에선 설정하지 않음)
PORT=3000
NODE_ENV=development        # 운영(Render)에서는 반드시 production (Dockerfile 기본값)

# Anthropic Claude API
ANTHROPIC_API_KEY=your_api_key

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# 엣지 디바이스 인증 (엣지의 edge/.env와 같은 값)
EDGE_DEVICE_SECRET=your_edge_secret

# CORS (쉼표로 구분, 프론트 주소 포함, 끝에 / 없이)
ALLOWED_ORIGINS=http://localhost:5173,https://homecare-9sr8.vercel.app

# MCP 서버(/mcp) Bearer 토큰 — 외부 클라이언트(Claude Desktop 등) 접속용.
# 미설정 시 기동마다 임의 토큰을 만들어 웹 채팅만 동작. 생성:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
MCP_AUTH_TOKEN=your_mcp_token

# 선택
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

## 📁 프로젝트 구조

```
homecare/
├── src/                  # 백엔드 (Node.js + Express)
│   ├── index.js          # 진입점
│   ├── app.js            # Express 앱 설정
│   ├── config/           # 설정 (index.js, supabase.js)
│   ├── routes/           # API 라우트 (chat, event, device)
│   ├── controllers/      # 컨트롤러
│   ├── services/         # 비즈니스 로직 (claude, event, device, storage)
│   ├── middlewares/      # auth(사용자 JWT / 엣지 시크릿), error
│   ├── mcp/              # MCP 도구 정의(tools/) + 서버 팩토리(createServer.js) + stdio 버전(server.js)
│   └── utils/
├── web/                  # 웹 프론트엔드 (React 19 + Vite + Tailwind, Vercel 배포)
├── edge/                 # 라즈베리파이 이벤트 전송 코드 (Python)
├── yamnet/               # YAMNet 오디오 분류 설계·검증 (core/, verification/, Plan.md)
├── database/             # schema.sql (Supabase)
├── tests/                # 백엔드 Jest 테스트
├── SH_README/            # 배포/인프라 인수인계 문서 (진행일지, 인수인계, DEPLOYMENT)
├── frontend/             # 레거시 프로토타입 (빌드/배포 안 됨, 확인 필요)
├── Dockerfile            # 백엔드 이미지 (Render가 사용)
├── docker-compose.yml    # 과거 Pi 배포용
├── .env.example
└── package.json
```

## 🔌 API 엔드포인트

프로덕션에서는 사용자 API에 Supabase JWT(`Authorization: Bearer`)가, 엣지용 `POST /api/events`와 heartbeat에는 `X-Device-Id` + `X-Device-Secret` 헤더가 필요합니다.

### Chat API
- `POST /api/chat/message` - AI에게 메시지 전송 (본인 대화가 아닌 `conversationId`면 새 대화로 시작)
- `GET /api/chat/history` - 내 대화 목록(최근 대화순) / `?conversationId=`로 그 대화의 메시지(본인 대화가 아니면 404)
- `POST /api/chat/summary` - 홈 "오늘의 브리핑" 생성. 생성과 동시에 사용자별로 저장(사용자당 1행, 새로 만들면 덮어씀)
- `GET /api/chat/summary/latest` - 마지막으로 만든 브리핑 조회(없으면 `data: null`) — 새로고침 시 복원용
- `DELETE /api/chat/history/:conversationId` - 내 대화 삭제(메시지도 함께)

### Events API
- `GET /api/events` - 이벤트 목록 조회
- `GET /api/events/:id` - 이벤트 상세 조회
- `POST /api/events` - 새 이벤트 생성 (Edge Device용, JSON 또는 이미지/오디오/영상 multipart). **저장 실패 시 500을 반환**하므로 엣지는 재시도해야 함
- `GET /api/events/summary/daily` - 일별 요약
- `GET /api/events/summary/weekly` - 주간 요약
- `DELETE /api/events/:id` - 이벤트 삭제

이벤트 필드: `type`(`visitor`/`motion`/`sound`/`danger`/`other`), `description`, `dangerLevel`(`normal`/`warning`/`danger`), `timestamp`, `metadata`.
`X-Device-Id`는 Supabase **`devices`** 테이블의 id(UUID)여야 합니다.

### Devices API
- `GET /api/devices` - 디바이스 목록
- `POST /api/devices/register` - 디바이스 등록
- `GET /api/devices/:id/status` - 상태 조회
- `POST /api/devices/:id/heartbeat` - Heartbeat 업데이트
- `POST /api/devices/:id/capture` - 캡처 요청
- `DELETE /api/devices/:id` - 디바이스 삭제

## 🛠️ MCP Tools

MCP 서버(`/mcp`)가 제공하는 도구 10개. 웹 채팅과 외부 MCP 클라이언트가 같은 도구를 씁니다.

| 도구명 | 설명 |
|--------|------|
| `get_today_events` | 오늘(한국 날짜) 이벤트 조회, 유형 필터 가능 |
| `get_events_by_date` | 특정 날짜(YYYY-MM-DD, 한국 날짜) 이벤트 조회 |
| `get_visitor_log` | 방문자 기록 — 날짜 생략 시 최근 7일(`days`) |
| `get_danger_events` | 최근 N일 위험/주의 이벤트 |
| `get_weekly_summary` | 최근 7일 요약: 건수·유형별·날짜별 + 기간 내 전체 이벤트 목록 |
| `get_daily_summary` | 특정 날짜 요약 |
| `get_camera_status` | 카메라 상태 확인 |
| `get_device_list` | 등록된 기기 목록 |
| `request_capture` | 즉시 캡처 요청 |
| `get_latest_capture` | 최근 캡처 조회 |

새 도구는 `src/mcp/tools/`에 정의(`inputSchema`)+핸들러를 추가하고, 새 파일이면 `src/mcp/createServer.js`에 등록합니다. 채팅은 `tools/list`로 자동 인식하므로 `claude.service.js`는 고칠 필요가 없습니다.

### MCP 서버 테스트 (Claude Desktop)

Claude Desktop은 stdio 서버만 직접 실행하므로, 원격 `/mcp`는 [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) 브리지로 연결합니다(Node.js 필요).

1. 백엔드에 `MCP_AUTH_TOKEN`을 설정합니다(운영: Render Environment, 로컬: `.env`). 미설정이면 외부 접속이 불가합니다.
2. `npm install -g mcp-remote`로 한 번 설치합니다. (`npx -y mcp-remote`는 Windows에서 Claude Desktop이 서버를 동시에 두 번 띄우며 npx 캐시가 깨져 `Cannot find module`로 실패했음 — 2026-09-27 실측)
3. Claude Desktop을 완전히 종료한 상태에서 Settings → Developer → **Edit Config**(`claude_desktop_config.json`)에 추가합니다.
   ```json
   {
     "mcpServers": {
       "homecare": {
         "command": "mcp-remote",
         "args": ["https://homecare-9kcu.onrender.com/mcp", "--header", "Authorization:${AUTH_HEADER}"],
         "env": { "AUTH_HEADER": "Bearer 여기에_MCP_AUTH_TOKEN" }
       }
     }
   }
   ```
   토큰 뒤에 줄바꿈이 섞이면 설정 파일 JSON이 깨집니다("Bad control character in string literal").
   (헤더 값의 공백이 Windows에서 깨지지 않도록 `env`로 넘깁니다. 로컬 백엔드는 주소를 `http://localhost:3000/mcp`로.)
4. Claude Desktop을 다시 실행 → 도구 목록에 `homecare`의 도구 10개가 보이면 연결 성공.
5. "이번 주 집에 무슨 일 있었어?"처럼 질문하고, 백엔드 로그에 `[MCP] Tool called: ...`가 찍히는지 확인합니다.

이 설정 파일에는 토큰이 들어가므로 공유하거나 커밋하지 마세요. Claude Desktop 없이 확인하려면 `npx @modelcontextprotocol/inspector`로 같은 주소·헤더를 넣어 도구를 직접 호출해 볼 수 있습니다.

## 📝 라이선스

MIT License

## 👥 팀

- **알람i Team** - 서울과학기술대학교 캡스톤디자인
