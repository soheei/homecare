# HomeCare Backend

MCP & LLM 기반 지능형 홈캠 AI 브리핑 시스템 백엔드

## 📋 개요

HomeCare는 AI가 집 안 상황을 분석하고 자연어로 대화할 수 있는 지능형 홈 모니터링 시스템입니다.

- **"오늘 누가 왔어?"** → AI가 방문 기록을 검색하여 답변
- **위험 상황 감지** → 낙상, 비명 등 위험 신호 시 즉시 알림
- **하루 요약 리포트** → 하루 동안의 주요 이벤트 자동 정리

## 🏗️ 아키텍처

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Mobile App    │────▶│  Backend Server │────▶│   Claude API    │
│  (React Native) │     │    (Node.js)    │     │   (Anthropic)   │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 ▼                       ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │    Supabase     │     │   MCP Server    │
                        │   (Database)    │◀────│    (Tools)      │
                        └─────────────────┘     └─────────────────┘
                                 ▲
                                 │
                        ┌─────────────────┐
                        │  Edge Device    │
                        │ (Raspberry Pi)  │
                        └─────────────────┘
```

## 🚀 시작하기

### 요구사항

- Node.js 18.0.0 이상
- npm 또는 yarn
- Supabase 계정
- Anthropic API Key

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

### 환경 변수

```env
# 서버
PORT=3000
NODE_ENV=development

# Anthropic Claude API
ANTHROPIC_API_KEY=your_api_key

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# MCP Server
MCP_SERVER_PORT=3001
```

## 📁 프로젝트 구조

```
homecare/
├── src/
│   ├── index.js          # 진입점
│   ├── app.js            # Express 앱 설정
│   ├── config/           # 설정 파일
│   │   ├── index.js
│   │   └── supabase.js
│   ├── routes/           # API 라우트
│   │   ├── index.js
│   │   ├── chat.routes.js
│   │   ├── event.routes.js
│   │   └── device.routes.js
│   ├── controllers/      # 컨트롤러
│   │   ├── chat.controller.js
│   │   ├── event.controller.js
│   │   └── device.controller.js
│   ├── services/         # 비즈니스 로직
│   │   ├── claude.service.js
│   │   ├── event.service.js
│   │   └── device.service.js
│   ├── middlewares/      # 미들웨어
│   │   ├── auth.middleware.js
│   │   └── error.middleware.js
│   ├── mcp/              # MCP 서버
│   │   ├── server.js
│   │   └── tools/
│   │       ├── event.tools.js
│   │       └── camera.tools.js
│   └── utils/            # 유틸리티
│       └── logger.js
├── tests/                # 테스트
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 🔌 API 엔드포인트

### Chat API
- `POST /api/chat/message` - AI에게 메시지 전송
- `GET /api/chat/history` - 대화 기록 조회
- `POST /api/chat/summary` - 하루 요약 요청

### Events API
- `GET /api/events` - 이벤트 목록 조회
- `GET /api/events/:id` - 이벤트 상세 조회
- `POST /api/events` - 새 이벤트 생성 (Edge Device용)
- `GET /api/events/summary/daily` - 일별 요약
- `GET /api/events/summary/weekly` - 주간 요약

### Devices API
- `GET /api/devices` - 디바이스 목록
- `POST /api/devices/register` - 디바이스 등록
- `GET /api/devices/:id/status` - 상태 조회
- `POST /api/devices/:id/heartbeat` - Heartbeat 업데이트

## 🛠️ MCP Tools

Claude가 호출할 수 있는 도구들:

| 도구명 | 설명 |
|--------|------|
| `get_today_events` | 오늘 발생한 이벤트 조회 |
| `get_visitor_log` | 방문자 기록 조회 |
| `get_danger_events` | 위험 상황 이벤트 조회 |
| `get_daily_summary` | 일별 요약 |
| `get_camera_status` | 카메라 상태 확인 |
| `request_capture` | 즉시 캡처 요청 |

## 📝 라이선스

MIT License

## 👥 팀

- **알람i Team** - 서울과학기술대학교 캡스톤디자인
