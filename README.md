# HomeCare Backend

MCP & LLM 기반 지능형 홈캠 AI 브리핑 시스템 (백엔드 + 웹 프론트엔드 + 엣지 전송 코드)

> 최근 수정일시: 2026-09-20 (백엔드 Render 이전, 엣지 전송 모듈 추가 반영)

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
                        │    Supabase     │     │   MCP 도구      │
                        │   (Database)    │◀────│ (인프로세스)    │
                        └─────────────────┘     └─────────────────┘
                                 ▲
                                 │ POST /api/events
                        ┌─────────────────┐
                        │  Edge Device    │
                        │ (Raspberry Pi)  │
                        │ YAMNet / YOLO   │
                        └─────────────────┘
```

- 채팅에서 Claude가 호출하는 MCP 도구(`src/mcp/tools/`)는 백엔드가 **인프로세스로 직접** 실행합니다. `src/mcp/server.js`(stdio MCP 서버)는 런타임에서 쓰이지 않습니다.
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

### 알려진 이슈

- `src/mcp/server.js`는 stdio 기반이라 상시 서비스로 띄울 수 없고, 실제 채팅도 이 서버를 쓰지 않습니다(도구를 인프로세스로 호출). 외부 MCP 클라이언트 연동이 필요해질 때만 별도 검토.
- `npm test`는 현재 5건 실패 / 2건 통과 상태입니다(인증 401로 보임, 원인 미확인).
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

# 선택
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
MCP_SERVER_PORT=3001
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
│   ├── mcp/              # MCP 도구 정의(tools/) + stdio 서버(server.js, 런타임 미사용)
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
- `POST /api/chat/message` - AI에게 메시지 전송
- `GET /api/chat/history` - 대화 기록 조회
- `POST /api/chat/summary` - 하루 요약 요청
- `DELETE /api/chat/history/:conversationId` - 대화 삭제

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

Claude가 호출할 수 있는 도구들 (`src/services/claude.service.js`에서 인프로세스로 실행):

| 도구명 | 설명 |
|--------|------|
| `get_today_events` | 오늘 발생한 이벤트 조회 |
| `get_visitor_log` | 방문자 기록 조회 |
| `get_danger_events` | 위험 상황 이벤트 조회 |
| `get_daily_summary` | 일별 요약 |
| `get_camera_status` | 카메라 상태 확인 |
| `request_capture` | 즉시 캡처 요청 |

새 도구를 `src/mcp/tools/`에 추가하면 `claude.service.js`의 `MCP_TOOLS`/`MCP_HANDLERS`도 함께 갱신해야 Claude가 호출할 수 있습니다.

## 📝 라이선스

MIT License

## 👥 팀

- **알람i Team** - 서울과학기술대학교 캡스톤디자인
