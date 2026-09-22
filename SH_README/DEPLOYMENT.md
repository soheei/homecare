# HomeCare 실행 명령어 & 서버 정보

> 최근 수정일시: 2026-09-22 (카메라/마이크 하트비트 관련 엣지 명령어·환경변수 추가)
> 이 문서는 프로젝트 코드(package.json, Dockerfile, .env.example, edge/ 등)와 실제 확인한 배포 상태에서
> 확인된 정보만 담고 있습니다. 추측/가정한 값은 넣지 않았고, 확인이 안 되는 부분은 "확인 필요"로 표시했습니다.
> 배포 상태 변경 시 이 문서도 함께 갱신할 것. 날짜별 작업 로그는 `hometalk_진행일지.md`, 인수인계 전반은 `hometalk_인수인계.md` 참고.

---

## 1. 프로젝트 실행

### Backend (저장소 루트)

| 명령어 | 설명 |
|---|---|
| `npm install` | 의존성 설치 |
| `npm run dev` | 개발 서버 실행 (nodemon, 파일 변경 시 자동 재시작) |
| `npm run dev:fresh` | 3000번 포트를 먼저 kill한 뒤 개발 서버 실행 |
| `npm start` | 프로덕션 모드 실행 (`node src/index.js`) |
| `npm run kill` | 3000번 포트를 점유 중인 프로세스 종료 |
| `npm test` | Jest 테스트 실행 (현재 5건 실패/2건 통과, 원인 미확인) |
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

### Edge — `edge/` (라즈베리파이, Python)

| 명령어 | 설명 |
|---|---|
| `python3 -m venv .venv` | 가상환경 생성 (시스템 pip은 PEP 668 `externally-managed-environment`로 막힘) |
| `source .venv/bin/activate` | 가상환경 활성화 (새 터미널마다 필요) |
| `pip install -r edge/requirements.txt` | 의존성 설치 (`requests`) |
| `python -m edge.send_test_event` | 가짜 이벤트 1건을 백엔드로 전송해 경로 점검. 웹 "최근 이벤트"에 `[테스트] 엣지 전송 확인`이 보이면 성공 |
| `python -m edge.stream_pipeline` | 마이크(ReSpeaker) → YAMNet 실시간 이벤트 감지 실행. 실행 중엔 20초 간격으로 자동 하트비트 전송(홈 화면 "마이크" 상태) |
| `python -m edge.camera_monitor` | 카메라(Camera Module V3) 하드웨어 인식 여부를 20초마다 확인해 하트비트 전송(홈 화면 "카메라" 상태). 상시 실행되려면 systemd 등록 필요(2026-09-22 기준 미등록) |
| `python -m edge.camera_monitor --list-cameras` | 카메라 감지 결과만 1회 출력(디버그용) |
| `python -m unittest discover -s edge/tests -t .` | 엣지 단위 테스트, 저장소 루트에서 실행 |

### 백엔드 배포 (Render)

| 작업 | 방법 |
|---|---|
| 배포 | `main` 브랜치에 push → Render 자동 재배포 |
| 로그 확인 | Render 대시보드 → 서비스 → Logs |
| 환경변수 변경 | Render 대시보드 → Environment (저장하면 재배포됨) |
| 상태 확인 | `curl https://homecare-9kcu.onrender.com/health` (`environment`가 `production`이어야 함) |

> `Dockerfile`(Node 20)을 Render가 빌드한다. `docker-compose.yml`은 과거 Pi 배포용이며 현재 배포 경로가 아니다.

---

## 2. Server URL

| 구분 | URL | 비고 |
|---|---|---|
| Frontend Production | https://homecare-9sr8.vercel.app/ | Vercel 배포. `VITE_API_URL`을 Render 주소로 설정해 재배포함(번들에서 확인) |
| Frontend Local | http://localhost:5173/ | `web/` Vite 개발 서버 기본값 |
| Backend Production | https://homecare-9kcu.onrender.com | Render Web Service. 무료 플랜이면 유휴 후 첫 응답이 20초대로 느림 |
| Backend Local | http://localhost:3000 | 로컬 실행 시 기본 포트(`.env.example` `PORT=3000`) |
| MCP Server | 없음 (HTTP/URL로 열려있지 않음) | stdio 기반이라 네트워크 주소가 없음. 필요 시 로컬에서 `npm run mcp`로 프로세스 단위 실행 |

---

## 3. Raspberry Pi / Edge Device

- 기기: 라즈베리파이, 호스트명 `alarmi`, 계정 `alarmi`, OS Debian 13 (trixie), aarch64
- 2026-09-20에 초기화되어 이전 Docker 배포와 Tailscale Funnel은 사라졌고, 이제 **엣지 코드만** 돈다(백엔드는 Render).
- 코드 위치: `~/homecare` (`git clone --filter=blob:none --no-checkout` + `git sparse-checkout`으로 `edge`, `yamnet/core`만), 가상환경 `~/homecare/.venv`
- 백엔드로 보내는 곳: `https://homecare-9kcu.onrender.com/api/events` (헤더 `X-Device-Id`, `X-Device-Secret`)
- Supabase `devices` 테이블에 등록된 기기 행: `raspberry-pi-5` (이 행의 `id`가 `HOMECARE_DEVICE_ID`)
- Tailscale(SSH 접속용)은 초기화 이후 재설정 여부 **확인 필요**. 백엔드 공개용 Tailscale Funnel은 더 이상 쓰지 않는다.

---

## 4. 환경변수

값은 절대 여기에 적지 않음 — 이름만 정리. 실제 값은 Render 대시보드(백엔드), Vercel 프로젝트 설정(프론트), Pi의 `edge/.env`(엣지)에 있음.

### Backend — Render Environment (`.env.example` 기준)

```env
NODE_ENV=            # 운영은 production (development면 인증 우회됨)
PORT=                # 운영에선 설정하지 않음 (Render가 주입)

ANTHROPIC_API_KEY=

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

EDGE_DEVICE_SECRET=  # 엣지 edge/.env의 같은 이름 값과 일치해야 함

ALLOWED_ORIGINS=     # 프론트 주소 (쉼표 구분, 끝에 / 없이)

LOG_LEVEL=
RATE_LIMIT_WINDOW_MS=
RATE_LIMIT_MAX_REQUESTS=

MCP_SERVER_PORT=
MCP_SERVER_NAME=

VAPID_PUBLIC_KEY=    # 웹 푸시(Web Push). 프론트 VITE_VAPID_PUBLIC_KEY와 동일한 값이어야 함
VAPID_PRIVATE_KEY=   # 생성: npx web-push generate-vapid-keys
VAPID_SUBJECT=       # 예: mailto:admin@example.com
```

### Frontend — Vercel Environment Variables (`web/.env.example` 기준)

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=        # Render 백엔드 주소. 값 변경 후 반드시 Redeploy (빌드 시점에 박힘)
VITE_VAPID_PUBLIC_KEY=  # 백엔드 VAPID_PUBLIC_KEY와 동일한 값
```

### Edge — Pi의 `edge/.env` (`edge/.env.example` 기준)

```env
HOMECARE_BACKEND_URL=       # 백엔드 주소 (끝에 / 없이)
HOMECARE_DEVICE_ID=         # Supabase devices 테이블의 마이크(ReSpeaker) 기기 행 id (events 행의 id가 아님)
EDGE_DEVICE_SECRET=         # Render의 EDGE_DEVICE_SECRET과 같은 값
HOMECARE_CAMERA_DEVICE_ID=  # Supabase devices 테이블의 카메라(Camera Module V3) 기기 행 id — camera_monitor.py 전용

# 선택
# EDGE_REQUEST_TIMEOUT=60
# EDGE_OUTBOX_DIR=
# HOMECARE_CAMERA_CHECK_INTERVAL_SEC=20
```
