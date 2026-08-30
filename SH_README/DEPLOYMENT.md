# HomeCare 실행 명령어 & 서버 정보

> 이 문서는 프로젝트 코드(package.json, Dockerfile, docker-compose.yml, .env.example 등)에서
> 실제로 확인된 정보만 담고 있습니다. 추측/가정한 값은 넣지 않았고, 확인이 안 되는 부분은 "확인 필요"로 표시했습니다.
> 배포 상태 변경 시 이 문서도 함께 갱신할 것. 날짜별 작업 로그는 `hometalk_진행일지.md`, 인수인계 전반은 `hometalk_인수인계.md` 참고.

---

## 1. 프로젝트 실행

### Backend (`/home/alarmi/homecare`)

| 명령어 | 설명 |
|---|---|
| `npm install` | 의존성 설치 |
| `npm run dev` | 개발 서버 실행 (nodemon, 파일 변경 시 자동 재시작) |
| `npm run dev:fresh` | 3000번 포트를 먼저 kill한 뒤 개발 서버 실행 |
| `npm start` | 프로덕션 모드 실행 (`node src/index.js`) |
| `npm run kill` | 3000번 포트를 점유 중인 프로세스 종료 |
| `npm test` | Jest 테스트 실행 |
| `npm run lint` | eslint로 `src/` 검사 |
| `npm run mcp` | MCP stdio 서버 단독 실행 (`node src/mcp/server.js`) — 외부 MCP 클라이언트가 stdin/stdout에 직접 붙어야 동작. 실제 백엔드 채팅 기능은 이 서버를 쓰지 않음(도구를 인프로세스로 직접 호출) |

### Frontend — `web/` (Vite + React, Vercel 배포되는 실제 프론트엔드)

| 명령어 | 설명 |
|---|---|
| `cd web && npm install` | 의존성 설치 |
| `npm run dev` | 로컬 개발 서버 실행 (Vite, 기본 `http://localhost:5173/`) |
| `npm run build` | 프로덕션 빌드 (Vercel이 배포 시 자동 실행) |
| `npm run preview` | 빌드 결과물 로컬 미리보기 |
| `npm run lint` | oxlint로 검사 |

> `frontend/`(package.json 없음, `App.jsx` + `index.html`)도 저장소에 있으나 빌드/배포 설정이 없어 실제로 쓰이는지 확인 필요.

### Docker (`/home/alarmi/homecare`, `docker-compose.yml` 기준)

| 명령어 | 설명 |
|---|---|
| `docker compose up -d --build backend` | backend 이미지 빌드 후 컨테이너 실행 (백그라운드) |
| `docker compose stop backend` | backend 컨테이너 중지 |
| `docker compose down` | 컨테이너 전체 중지 및 제거 (네트워크 포함) |
| `docker ps` | 실행 중인 컨테이너 확인 |
| `docker logs homecare-backend --tail 50` | backend 로그 확인 |
| `docker compose run --rm -i mcp` | mcp 서비스를 필요할 때만 수동으로 1회 실행 (`profiles: ["mcp-manual"]`이라 기본 `up`에는 포함 안 됨) |

> 이 서버(Debian 13 trixie, aarch64)의 apt 저장소엔 `docker compose`(플러그인) 패키지가 없어 실제로는 `docker-compose`(하이픈) 명령을 씀.

---

## 2. Server URL

| 구분 | URL | 비고 |
|---|---|---|
| Frontend Production | https://homecare-9sr8.vercel.app/ | Vercel 배포 |
| Frontend Local | http://localhost:5173/ | `web/` Vite 개발 서버 기본값 |
| Backend Production (외부 공개) | https://alarmi.tail3c4e8f.ts.net | Tailscale Funnel로 `127.0.0.1:3000` 프록시. 라즈베리파이 재부팅 시 꺼질 수 있음(`tailscale funnel status`로 확인) |
| Backend Local | http://localhost:3000 | 컨테이너/로컬 실행 시 기본 포트(`.env.example` `PORT=3000`) |
| MCP Server | 없음 (HTTP/URL로 열려있지 않음) | stdio 기반이라 네트워크 주소가 없음. 필요 시 로컬에서 `npm run mcp` 또는 `docker compose run --rm -i mcp`로 프로세스 단위 실행 |

---

## 3. Raspberry Pi / Edge Device

- 기기: 라즈베리파이, 호스트명 `alarmi`, OS Debian 13 (trixie), aarch64
- Tailscale 사설 IP: `100.120.42.52`
- Tailscale DNS 이름: `alarmi.tail3c4e8f.ts.net`
- 접속 방법: 같은 Tailnet에 연결된 상태에서 SSH 접속 (`ssh alarmi@100.120.42.52`) — VSCode Remote-SSH로 실제 접속되어 작업 중인 것으로 확인됨
- Backend(도커 컨테이너)와 통신하는 주소: 라즈베리파이 로컬에서는 `127.0.0.1:3000` / `localhost:3000`, 외부에서는 위 Tailscale Funnel URL(`https://alarmi.tail3c4e8f.ts.net`)

### Tailscale 명령어

| 명령어 | 설명 |
|---|---|
| `tailscale status` | 이 기기와 tailnet 내 다른 기기 상태 확인 |
| `tailscale funnel status` | 현재 Funnel(외부 공개) 설정 확인 |
| `tailscale funnel --bg 3000` | 3000번 포트를 외부 인터넷에 HTTPS로 공개 (백그라운드 실행) |
| `tailscale funnel --https=443 off` | Funnel 비활성화 |

> Funnel을 처음 켤 때 (1) Tailscale 관리자 콘솔 Access Controls의 `nodeAttrs`에 `funnel` 권한 부여, (2) DNS 설정에서 HTTPS Certificates 활성화, 이 두 가지가 선행되어야 함(이 기기는 완료됨). 이 기기의 Tailscale operator는 `alarmi`로 설정되어 있어(`sudo tailscale set --operator=alarmi`) sudo 없이 `tailscale funnel` 명령 사용 가능.

---

## 4. 환경변수

값은 절대 여기에 적지 않음 — 이름만 정리. 실제 값은 서버의 `.env`(git 미포함)에 있음.

### Backend — `.env` (`.env.example` 기준)

```env
NODE_ENV=
PORT=
HOST=

ANTHROPIC_API_KEY=

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

MCP_SERVER_PORT=
MCP_SERVER_NAME=

EDGE_DEVICE_SECRET=

LOG_LEVEL=

ALLOWED_ORIGINS=

RATE_LIMIT_WINDOW_MS=
RATE_LIMIT_MAX_REQUESTS=

# Firebase (아직 미설정 — .env.example에 주석 처리되어 있음)
# FIREBASE_PROJECT_ID=
# FIREBASE_PRIVATE_KEY=
# FIREBASE_CLIENT_EMAIL=
```

### Frontend — `web/.env` (`web/.env.example` 기준)

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=
```

> `web/.env`는 서버 파일시스템에 존재하지 않음 — Vercel에 배포된 프로덕션 빌드가 `VITE_API_URL`을 무엇으로 설정해뒀는지(Tailscale Funnel URL을 가리키는지)는 Vercel 프로젝트 설정에서 직접 확인 필요.
