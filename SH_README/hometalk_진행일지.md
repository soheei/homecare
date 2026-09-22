# HomeCare 서버 배포/인프라 진행일지

> 최근 수정일시: 2026-09-22 (카메라/마이크 온·오프 상태 하트비트 연동)
> 이 파일의 역할: **날짜별 작업 로그**(무엇을 했고, 무엇을 검증했고, 무엇을 발견했는지)만 기록.
> 설계/계획/인계 항목 등 구조적인 내용은 `hometalk_인수인계.md`에 남기고,
> 이 파일에는 실제로 실행한 작업과 그 결과만 시간순으로 append한다. 해결된 항목은 취소선 그어두어 업데이트한다.
> 현재 파일 속 길이가 1000줄 넘어가면 새로운 파일을 생성해서 그 파일에서 이어서 작성한다. 규칙은 똑같이 copy할 것.

---

## 2026-08-30

### GitHub 접근 환경 구성
- git 2.47.3 확인, GitHub CLI(`gh`) 신규 설치 → `soheei` 계정으로 `gh auth login` 완료
- `gh` hosts.yml에 `git_protocol: ssh`로 잘못 남아있던 설정을 `https`로 수정 (SSH 키 미등록 상태였음)
- `soheei/homecare` 저장소를 `/home/alarmi/homecare`에 clone (`main` 브랜치)

### 프론트엔드 배포 현황 기록
- Production: https://homecare-9sr8.vercel.app/
- Local Dev: http://localhost:5173/
- README.md에 "🌐 배포" 섹션으로 반영

### 백엔드 Docker 배포
- Debian 13 (trixie) / aarch64 환경에 `docker.io` + `docker-compose`(구 스타일, 하이픈 명령) 설치
  - apt 저장소에 `docker-compose-v2`, `docker-compose-plugin` 패키지가 없어 `docker-compose` 패키지 사용
  - docker 그룹 반영은 재로그인 필요 — 이번 세션에서는 `sg docker -c "..."`로 우회
- `.env` 파일은 사용자가 직접 채움 (ANTHROPIC_API_KEY, SUPABASE_*, EDGE_DEVICE_SECRET 등)
- `docker compose up -d --build`로 `homecare-backend`, `homecare-mcp` 컨테이너 최초 빌드/실행

### 발견 및 수정한 문제
1. ~~**mcp 컨테이너에 ANTHROPIC_API_KEY 누락** — `docker-compose.yml`의 mcp 서비스 environment에 backend에는 있던 `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`가 빠져있어 `Missing required environment variables` 에러로 즉시 종료.~~ → environment 목록에 추가. **(해결됨, 2026-08-30)**
2. ~~**MCP SDK setRequestHandler 호출 방식 오류** — `@modelcontextprotocol/sdk` v1.29.0에서는 `setRequestHandler('tools/list', ...)`처럼 문자열을 넘기면 `Error: Schema is missing a method literal` 발생.~~ → Zod 스키마 객체(`ListToolsRequestSchema`, `CallToolRequestSchema`, `@modelcontextprotocol/sdk/types.js`에서 import)를 넘기도록 `src/mcp/server.js` 수정. **(해결됨, 2026-08-30)**
3. ~~**mcp 서비스를 상시 컨테이너로 띄울 수 없는 구조적 문제** — `src/mcp/server.js`는 stdio 기반 MCP 서버라 외부 MCP 클라이언트가 stdin에 직접 붙어야 동작. 데몬으로 띄우면 stdin EOF로 즉시 종료 → `restart: unless-stopped`와 맞물려 무한 재시작 루프. 게다가 실제 백엔드(`src/services/claude.service.js`)는 MCP 도구를 인프로세스로 직접 import해서 호출하므로 이 stdio 서버가 런타임에 전혀 필요하지 않음.~~ → `docker-compose.yml`의 mcp 서비스에 `profiles: ["mcp-manual"]` 추가해 기본 `docker compose up`에서 제외, `restart: "no"`로 변경. 필요 시 `docker compose run --rm -i mcp`로 수동 실행. **(해결됨, 2026-08-30)**
4. ~~**헬스체크 IPv6 이슈** — 컨테이너 내부에서 `localhost`가 `::1`(IPv6)로 먼저 풀리는데 앱은 `0.0.0.0`(IPv4)에만 바인딩되어 `wget`이 접속 실패 → healthcheck가 `unhealthy`.~~ → healthcheck URL을 `http://127.0.0.1:3000/health`로 변경. **(해결됨, 2026-08-30)**

### 최종 상태
- `homecare-backend`: `0.0.0.0:3000`, docker healthcheck `healthy`
- `homecare-mcp`: 기본 실행에서 제외됨 (필요시 수동 실행)
- 관련 내용은 `README.md`의 "🌐 배포" / "알려진 이슈" 섹션에도 반영함

---

## 2026-09-04

### Vercel 프론트엔드 "최근 이벤트" 무한 로딩 문제 진단
- 사용자가 https://homecare-9sr8.vercel.app/ 홈 화면에서 "최근 이벤트"가 계속 "불러오는 중..."에 멈춰있다고 제보
- 라즈베리파이 백엔드 자체는 정상이었음 — `docker ps`로 `homecare-backend` healthy 확인, `curl localhost:3000/health` 및 `curl https://alarmi.tail3c4e8f.ts.net/health` 둘 다 200 정상 응답
- 원인 2건 확인:
  1. **Vercel 빌드에 `VITE_API_URL` 미설정** — 배포된 JS 번들(`/assets/index-*.js`)을 직접 받아 문자열 검색해보니 API 호출 주소가 `http://localhost:3000`으로 baked-in 되어 있었음. Vite는 빌드 시점에 `import.meta.env.VITE_API_URL`을 치환하는데, Vercel 프로젝트에 이 환경변수가 없어 [web/src/lib/api.js](../web/src/lib/api.js)의 fallback 값(`http://localhost:3000`)이 그대로 박힘. 이 주소는 방문자 자신의 PC를 가리키므로 당연히 응답이 없음. → **미해결, Vercel 대시보드에서 직접 설정 필요** (아래 "남은 일" 참고)
  2. **백엔드 CORS가 Vercel 도메인 미허용** — `curl -H "Origin: https://homecare-9sr8.vercel.app" .../api/events`로 확인해보니 `Access-Control-Allow-Origin` 헤더가 없었음. `src/config/index.js`의 `ALLOWED_ORIGINS` 환경변수(`.env`)에 이 도메인이 빠져있었음. → **해결함**: `.env`의 `ALLOWED_ORIGINS`에 `https://homecare-9sr8.vercel.app` 추가 (수정 전 백업: `.env.bak.*`), `docker-compose up -d --build backend`로 재배포. 재배포 후 동일 curl로 `access-control-allow-origin: https://homecare-9sr8.vercel.app` 헤더 확인 완료.

### 남은 일
- ~~Vercel 프로젝트(Settings → Environment Variables)에 `VITE_API_URL=https://alarmi.tail3c4e8f.ts.net` 추가 후 재배포 필요 — CLI/대시보드 접근 권한이 없어 이번 세션에서는 서버(백엔드) 쪽만 처리함. 이게 반영되기 전까지는 프론트엔드가 여전히 백엔드에 연결 못함.~~ → **(해결됨, 2026-09-20)** 백엔드를 Render로 옮기면서 `VITE_API_URL`을 Render 주소로 설정·재배포. 배포된 JS 번들에 Render 주소만 있고 `localhost:3000`은 없음을 확인.

### Git 커밋/푸시 (README, docker-compose.yml, src/mcp/server.js, CLAUDE.md, SH_README/)
- 로컬 저장소에 `user.name`/`user.email` 미설정 상태라 첫 커밋 실패 → `git config user.name "soheei"`, `git config user.email "soheei@users.noreply.github.com"`로 저장소 로컬 설정
- `web/README_SH.md`가 클론 시점부터 이미 삭제된 상태였음(우리 작업과 무관) — 사용자 확인 후 삭제를 커밋에 포함
- `git push` 시 `fatal: could not read Username for 'https://github.com'` 에러 → `gh auth setup-git`으로 gh 토큰을 git 자격증명에 연결해서 해결
- 커밋 `f85ef9c`로 push 완료

### Tailscale Funnel로 백엔드 외부(인터넷) 공개
- 목적: Vercel에 배포된 프론트엔드(`https://homecare-9sr8.vercel.app/`)가 라즈베리파이 백엔드(`localhost:3000`)를 호출할 수 있으려면 HTTPS 공인 URL이 필요함
- 이 서버에 Tailscale이 이미 설치되어 있어 Tailscale Funnel 사용 (별도 ngrok/Cloudflare Tunnel 계정 불필요)
- 막혔던 지점과 해결:
  1. `tailscale funnel 3000` 최초 실행 시 "Funnel is not enabled on your tailnet" → 관리자 콘솔에서 Funnel 활성화 링크(`https://login.tailscale.com/f/funnel?node=...`) 방문 필요
  2. Access Controls → JSON editor에서 `nodeAttrs`에 `{"target": ["autogroup:member"], "attr": ["funnel"]}` 추가 후 Save → 그래도 여전히 "not enabled" 에러 지속
  3. `sudo tailscale cert ...`로 테스트해보니 `"your Tailscale account does not support getting TLS certs"` — Funnel의 전제조건인 **HTTPS Certificates**가 DNS 설정에서 별도로 꺼져 있었음. `https://login.tailscale.com/admin/dns`에서 활성화
  4. ACL 저장 + HTTPS Certificates 활성화 후에도 이 기기(`alarmi`)의 capability 목록에 `funnel`이 안 잡힘 → `sudo systemctl restart tailscaled`로 강제 재동기화하니 `funnel`, `https` capability 정상 반영됨
  5. `tailscale funnel --bg 3000` 실행 시 `Access denied: serve config denied` → `sudo tailscale set --operator=$USER`로 현재 사용자를 operator로 지정해서 해결
- 최종 결과: `https://alarmi.tail3c4e8f.ts.net` → `http://127.0.0.1:3000`으로 프록시 확인 (`/health` 응답 정상)
- 주의: 라즈베리파이 재부팅 시 Funnel이 꺼질 수 있음 (`tailscale funnel status`로 확인, 꺼져있으면 `tailscale funnel --bg 3000` 재실행). 끄려면 `tailscale funnel --https=443 off`

### DEPLOYMENT.md 작성
- 사용자 요청으로 `SH_README/DEPLOYMENT.md` 신규 작성: 실행 명령어(backend/frontend/mcp/docker), Server URL, Raspberry Pi/Tailscale 접속 정보, 환경변수 이름 목록(값 제외)을 한 문서에 정리
- package.json, docker-compose.yml, Dockerfile, .env.example, web/package.json, web/.env.example, vercel.json 등 실제 파일을 직접 재확인하여 작성 (추측 값 없음)
- `web/.env`가 서버에 실제로 존재하지 않아 Vercel 프로덕션이 `VITE_API_URL`을 무엇으로 설정했는지는 "확인 필요"로 남김
- CLAUDE.md의 "세션 시작 시 필수 확인" 목록에 이 문서를 3번째 항목으로 추가

### 다음에 확인할 것 (미해결/보류)
- `docker-compose.yml`의 `version: '3.8'` 속성이 obsolete 경고 발생 중 — 동작엔 문제없지만 정리하면 좋음 (2026-09-20 이후 백엔드는 Render가 Dockerfile로 직접 빌드하므로 compose는 현재 배포 경로가 아님)
- ~~Node.js 18 deprecated 경고 (`@supabase/supabase-js`가 Node 20+ 요구) — Dockerfile의 base 이미지를 `node:20-alpine`으로 올리는 것 고려~~ → **(해결됨, 2026-09-20)** Dockerfile을 `node:20-alpine`으로 변경
- ~~`docker` 그룹 권한이 현재 쉘 세션에 반영 안 됨 — 재로그인하면 `sg docker` 없이 `docker` 명령 바로 사용 가능~~ → **(무효, 2026-09-20)** Pi 초기화로 Docker 환경 자체가 사라짐
- ~~Tailscale Funnel은 라즈베리파이 재부팅/네트워크 단절 시 꺼질 수 있음 — 부팅 시 자동 재시작되도록 systemd 서비스화하는 것 고려 필요~~ → **(폐기, 2026-09-20)** 백엔드를 Render로 이전해 Funnel을 쓰지 않음
- ~~Vercel 프론트엔드의 API base URL을 `https://alarmi.tail3c4e8f.ts.net`로 실제 연결했는지 아직 미확인 — 프론트 쪽 `.env`/설정 확인 필요~~ → **(해결됨, 2026-09-20)** Render 주소로 연결 확인 (위 "남은 일" 참고)

---

## 2026-09-20

### 라즈베리파이 초기화 → 백엔드 배포 위치를 Render로 이전
- Pi가 초기화되어 기존 Docker 배포(`homecare-backend`), Tailscale Funnel, 서버 `.env`가 모두 사라짐. 저장소는 GitHub에 남아 있어 코드는 재사용.
- 배포 위치 검토: Pi 재배포 vs 클라우드. 백엔드는 상태가 거의 없고(DB=Supabase, AI=Anthropic API) 집 전원/인터넷/Funnel 재부팅 이슈에 묶일 이유가 없어 클라우드로 결정.
- Google Cloud Run 시도 후 중단: Cloud Build 서비스 계정(Compute Engine 기본 SA)에 로그 작성 등 권한이 없어 빌드가 실패하고 로그도 볼 수 없었음. 결제 계정/무료 사용량 한도가 부담되어 Render로 변경. (GCP에 만들어 둔 서비스와 결제 계정 정리 여부는 **확인 필요**)
- 배포 준비 코드 변경(커밋 `a03de7a`): `.dockerignore` 신규(`.env`·`node_modules` 등 이미지 제외), Dockerfile `node:20-alpine`, `src/app.js`에 `trust proxy 1`(프록시 뒤 rate limit이 전체 사용자 공유 한도가 되는 문제 방지).
- Render Web Service(Docker 런타임, GitHub `main` 자동 배포)로 배포: https://homecare-9kcu.onrender.com

### 배포 후 검증에서 발견·수정한 문제
1. ~~**Render 환경변수에 `NODE_ENV=development`가 들어가 있어 인증이 우회됨**~~ — `/health`가 `environment: development`, 토큰 없이 `/api/chat/history`가 200. 프로덕션이 아니면 [auth.middleware.js](../src/middlewares/auth.middleware.js)가 더미 유저로 통과시키기 때문(누구나 Claude API 비용을 쓰게 만들 수 있는 상태). → `production`으로 변경. 재확인: `environment: production`, 인증 없는 요청 401. **(해결됨, 2026-09-20)**
2. ~~**CORS에 Vercel 도메인 없음**~~ — Vercel Origin으로 요청 시 `access-control-allow-origin` 헤더 없음. → Render `ALLOWED_ORIGINS`에 `https://homecare-9sr8.vercel.app` 설정 후 헤더 확인. **(해결됨, 2026-09-20)**
3. **Anthropic API 크레딧 부족** — 채팅 요청이 `Your credit balance is too low`(400)로 실패. 코드/연결 문제가 아니라 계정 크레딧 문제. → 충전 필요. **(충전 여부·채팅 응답 확인 필요)**
4. ~~**Supabase `events` 테이블에 `video_url` 컬럼 없음**~~ — 이벤트 저장이 `Could not find the 'video_url' column of 'events' in the schema cache`로 실패. Supabase에서 컬럼 추가, `database/schema.sql`에도 반영(`CREATE TABLE`에 컬럼 + `ADD COLUMN IF NOT EXISTS`). 이후 이벤트가 UUID로 저장되는 것 확인. **(해결됨, 2026-09-20)**
5. ~~**이벤트 저장 실패를 `temp_` ID로 성공 처리(201)하던 폴백**~~ — [event.service.js](../src/services/event.service.js)의 `createEvent`가 DB 실패를 숨겨 엣지가 실패를 알 수 없었음(4번도 이 때문에 응답만 보면 성공처럼 보였음). → 저장 실패 시 500 `Failed to save event`를 반환하도록 수정(원인은 로그에만). **(해결됨, 2026-09-20)**
6. **Render 무료 플랜 유휴 지연** — 유휴 후 첫 `/health` 응답이 약 22.7초. 채팅/엣지 전송에 영향. **미해결 (플랜 결정 필요)**
- 참고: `database/schema.sql` 전체를 SQL Editor에서 실행하면 맨 아래 개발용 샘플 데이터(가짜 방문 이벤트, `dev-user-001` 기기)가 운영 DB에 들어감. 실제로 `events`에 샘플 행이 들어 있는 것이 확인됨 → 웹/채팅에 가짜 기록이 섞이므로 정리 여부 **확인 필요**.

### 엣지(Pi) → 백엔드 이벤트 전송 경로 구축 (`edge/` 신규)
- Pi 세팅: 저장소를 `git clone --filter=blob:none --no-checkout` + `git sparse-checkout`으로 `~/homecare`에 받음. Debian의 PEP 668(`externally-managed-environment`) 때문에 시스템 pip 설치가 막혀 `python3 -m venv .venv` 안에 `edge/requirements.txt`(`requests`만) 설치.
- 구조: 감지기(YAMNet, 이후 YOLO)가 `EventEmitter.emit(category_id, source, ...)`만 호출 → 쿨다운 → SQLite 큐(`edge/data/`, git 제외) → 백그라운드 sender가 `POST /api/events`(헤더 `X-Device-Id`, `X-Device-Secret`)로 전송. 5xx/네트워크 오류/429는 지수 백오프(5초~15분, 최대 50회) 재시도, 4xx는 dead 처리, 인증 오류는 유지하며 재시도, `temp_` ID 응답은 미저장으로 보고 재시도. 이벤트마다 `metadata.event_uid`를 넣어 중복 저장 시 걸러낼 수 있게 함(백엔드에 중복 제거 없음).
- 카테고리 → 백엔드 `type`/`dangerLevel` 변환표는 `edge/event_mapper.py`(기본안, 팀 결정 필요). `category_map.py`의 위험도(높음/중간/낮음)를 따랐음. `fall_suspect`·`baby_person_distress`는 Plan.md §2.4 초안(중간/낮음)과 달리 §9에서 2026-09-04에 '높음'으로 확정된 값. Plan.md §2.4의 "높음은 쿨다운 없이 매번"과 달리 중복 프레임 방지용 10초 하한을 둠.
- 단위 테스트 15개 통과(`python -m unittest discover -s edge/tests -t .`), 로컬 임시 서버로 실제 HTTP JSON/multipart 전송 형식 확인.
- Pi 실전송 검증(`python -m edge.send_test_event`): 첫 시도는 `HOMECARE_DEVICE_ID`에 `events` 테이블의 행 id를 잘못 넣어(외래키 위반) 백엔드가 500을 반복 → 재시도 큐가 정상 동작함을 확인. `devices` 테이블의 `raspberry-pi-5` 행 id로 교체 후 성공, 큐에 남아 있던 이벤트 포함 2건이 실제 UUID로 저장됨. (테스트 이벤트 `[테스트] 엣지 전송 확인` 2건이 DB에 남아 있음 — 정리 필요)

### 다음에 확인할 것 (미해결/보류)
- Anthropic 크레딧 충전 후 웹 채팅 응답 확인, 채팅이 방금 저장된 엣지 이벤트를 언급하는지 확인
- Render 플랜(무료 유휴 지연) 결정
- ~~엣지 2단계: 마이크 입력 → YAMNet → 판정 규칙 → `emit()` 파이프라인~~ → **(해결됨, 2026-09-22)** `edge/stream_pipeline.py`로 실제 가동 중, 운영 DB에 실제 이벤트 저장 확인. 부팅 시 자동 실행(systemd)은 아직 **확인 필요**. YOLO(카메라 영상 분석)는 여전히 미구현.
- ~~엣지 heartbeat(`POST /api/devices/:id/heartbeat`) 미구현 — `devices.status`가 계속 `offline`~~ → **(해결됨, 2026-09-22)** 마이크는 `stream_pipeline.py`가 자동 전송, 카메라는 `edge/camera_monitor.py`(Pi 실기 감지 성공 확인). 둘 다 24시간 상시 감시가 아니라 사용자가 원할 때만 `systemctl start`로 켜는 방식으로 결정 — systemd unit은 작성했으나 Pi에 설치는 **미완료**.
- `npm test` 기존 5건 실패(인증 401로 보임) 원인 미확인
- Pi의 Tailscale 상태(초기화 후 재설치 여부) **확인 필요**

---

## 2026-09-22

### 웹 UI "디자인만 있고 동작 안 하던" 기능 두 가지 연결
사용자 요청: `https://homecare-9sr8.vercel.app/`의 설정 화면 알림 토글, 이벤트 화면의 이벤트 삭제가 디자인만 있고 실제로 동작하지 않아 수정.

**1) 이벤트 삭제** — 백엔드 `DELETE /api/events/:id`(`event.controller.js`/`event.service.js`)와 프론트 `api.events.delete()`는 이미 구현돼 있었는데 [EventsScreen.jsx](../web/src/screens/EventsScreen.jsx)에 삭제 버튼 자체가 없었음. 카드마다 `×` 버튼 추가 → `window.confirm` 확인 후 삭제 API 호출 → 성공 시 로컬 목록에서 제거.

**2) 알림 설정 → 실제 Web Push 알림** — 기존엔 [SettingsScreen.jsx](../web/src/screens/SettingsScreen.jsx) 토글이 로컬 state만 바꾸고 새로고침하면 초기화됐고, 브라우저 알림/푸시 인프라 자체가 프로젝트에 없었음. 사용자와 범위 협의 후(일일 브리핑 9시 자동 발송은 이번엔 제외, 실시간 위험/방문자/움직임/소리 알림만 구현) 아래와 같이 신설:
- 백엔드: `web-push` 패키지 추가, VAPID 키 발급(로컬에서 생성만 함 — 커밋 안 함, Render 환경변수로 사용자가 직접 등록해야 함). [src/config/index.js](../src/config/index.js)에 `config.vapid` 추가. [src/services/push.service.js](../src/services/push.service.js)(web-push 래퍼), [src/services/notification.service.js](../src/services/notification.service.js)(구독 저장/조회, 알림 설정 저장/조회, `notifyEvent`), [src/controllers/notification.controller.js](../src/controllers/notification.controller.js), [src/routes/notification.routes.js](../src/routes/notification.routes.js) 신규. `/api/notifications/public-key`, `/preferences`(GET/PUT), `/subscribe`, `/unsubscribe`. [event.controller.js](../src/controllers/event.controller.js)의 `createEvent`에서 저장 성공 후 `notificationService.notifyEvent(event)` 호출(이벤트 생성 응답을 막지 않도록 await 안 함, 내부에서 모든 에러 흡수).
- DB: `database/schema.sql`에 `push_subscriptions`(구독 endpoint/키), `notification_preferences`(사용자별 토글) 테이블 + RLS 정책 추가. **주의**: 파일 실행이 아니라 Supabase SQL Editor에서 이 두 테이블 관련 `CREATE TABLE`/`ALTER`/정책 블록만 따로 실행해야 함(파일 전체 실행 시 맨 아래 샘플 데이터가 섞임 — 기존 규칙과 동일).
- 프론트: [web/public/sw.js](../web/public/sw.js) 신규(서비스워커, `push`/`notificationclick` 처리), [web/src/lib/push.js](../web/src/lib/push.js)(권한 요청 + 구독 생성/해제 헬퍼), [main.jsx](../web/src/main.jsx)에서 서비스워커 등록, [api.js](../web/src/lib/api.js)에 `notifications` 네임스페이스 추가. SettingsScreen 토글 클릭 시: 위험/방문자/움직임/소리는 켤 때 `Notification.requestPermission()` → 구독 생성 → 서버 등록, 끌 때(다른 실시간 토글이 모두 꺼져 있으면) 구독 해제. 모든 토글 상태는 `notification_preferences`에 저장되어 새로고침해도 유지됨. 일일 브리핑 토글은 설정만 저장되고 아직 발송 로직은 없음(추후 스케줄러 작업 필요, `PUSH_BACKED_KEYS`에서 제외).
- 이벤트 생성 시 실제 발송 대상 판단: `events.device_id` → `devices.user_id` → 그 사용자의 `notification_preferences`에서 이벤트 `type`에 해당하는 토글이 켜져 있으면 그 사용자의 모든 `push_subscriptions`로 발송. 만료된 구독(404/410)은 자동 삭제.
- **배포 시 사용자가 직접 해야 하는 작업 (에이전트가 접근 못 함)**:
  1. Supabase SQL Editor에서 `push_subscriptions`/`notification_preferences` 생성 SQL 실행
  2. Render 환경변수에 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` 추가 (키는 이 세션에서 로컬로 생성했고 코드/문서 어디에도 커밋하지 않음 — 대화 로그에서 값 확인 후 등록)
  3. Vercel 환경변수에 `VITE_VAPID_PUBLIC_KEY`(위 `VAPID_PUBLIC_KEY`와 동일 값) 추가 후 재배포
  4. 위 설정 전에는 `pushService.isConfigured()`가 false라 발송은 조용히 스킵됨(에러 아님) — 토글은 저장되지만 실제 알림은 안 옴
- **확인 필요**: `deleteEvent`가 요청자가 그 이벤트의 소유 디바이스 사용자인지 검사하지 않음(다른 인증 사용자도 삭제 가능) — 이번 작업 범위 밖이라 손대지 않았고 별도 논의 필요.
- 로컬 검증: 백엔드 `npm test` 기존과 동일하게 5실패/2통과(회귀 없음), `node -e`로 라우트 로딩 확인. 프론트 `cd web && npm run build`/`npm run lint` 통과(이 머신은 npm 옵셔널 디펜던시 버그로 처음엔 rolldown/oxlint 네이티브 바인딩이 안 잡혔고, 해당 플랫폼 패키지를 수동 설치해 확인함 — 코드 문제 아님).
- 로컬에서 실제로 두 서버(`npm run dev`, `cd web && npm run dev`) 띄워서 사용자가 직접 UI 확인. 이 과정에서 `web/.env`가 아예 없어서 프론트가 Supabase 클라이언트 생성에서 죽는 걸 발견 → 사용자가 값 채워 넣어 해결(파일 내용은 안 읽고 키 이름 존재 여부만 `grep -c`로 확인).
- 사용자가 홈 화면 스크린샷을 보내며 "카메라 2대 온라인"이 실제 라즈베리파이 상태와 맞는지 확인 요청 → 로컬 백엔드로 운영 Supabase `/api/devices` 직접 조회해서 확인한 결과, 실제 파이(`raspberry-pi-5`)는 `status: offline`(하트비트 호출 자체가 없음)인데 화면의 "2대 온라인"은 `schema.sql`의 가짜 샘플 기기(거실/현관 카메라, `status: online` 하드코딩, 한 번도 갱신 안 됨) 때문이었음을 확인.

### 카메라/마이크 온·오프 상태 하트비트 연동
사용자 확인: 현재 Pi는 마이크(ReSpeaker 2-Mic HAT) 1개 + 카메라(Camera Module V3) 1개로 구성. "켜짐/꺼짐" 판단 기준은 "실제 분석 파이프라인 동작 여부"로 확정(카메라는 아직 분석 코드가 없어 하드웨어 인식 여부로 임시 대체).

- **devices 정정** (Node 스크립트로 1회 실행, 실행 후 삭제 — 커밋 안 함): 기존 `raspberry-pi-5`(id `0543f49c-1df9-44bb-97d9-61d24cc37905`, 실제로 마이크 이벤트를 보내던 기기)를 `type: microphone`, 이름 `ReSpeaker 2-Mic HAT`로 정정. `Camera Module V3`(`type: camera`) 신규 등록(새 id `2a418d81-5507-441d-b666-0a8029057dad`). 가짜 샘플 기기(거실/현관 카메라, `11111111.../22222222...`) 삭제 — `events.device_id`가 `ON DELETE SET NULL`이라 그 기기를 참조하던 샘플 이벤트는 FK 위반 없이 `device_id`만 null이 됨.
- **백엔드**: [device.service.js](../src/services/device.service.js)에 `withComputedStatus()`/`HEARTBEAT_STALE_MS`(60초) 추가 — `getDevices`/`getDeviceStatus` 둘 다 DB에 저장된 `status` 컬럼을 안 믿고 `last_heartbeat` 최신 여부로 매번 재계산하도록 통일(기존엔 `getDeviceStatus`만 이렇게 계산하고 목록 조회 `getDevices`는 저장된 값을 그대로 반환해서, 한 번 online 찍히면 하트비트 끊겨도 안 내려가는 문제가 있었음).
- **엣지**: [edge/heartbeat.py](../edge/heartbeat.py) 공용 헬퍼 신규(주기적으로 `POST /api/devices/:id/heartbeat`, 실패해도 다음 주기에 재시도라 재시도 큐 불필요). [edge/stream_pipeline.py](../edge/stream_pipeline.py)의 `main()`이 파이프라인 실행 중(`--wav-file` 테스트 모드 제외) 20초 간격으로 자동 하트비트 전송하도록 수정. [edge/camera_monitor.py](../edge/camera_monitor.py) 신규 — `rpicam-hello`/`libcamera-hello --list-cameras`로 카메라 인식 여부만 20초마다 확인해서 감지됐을 때만 하트비트 전송(감지 안 되면 그냥 안 보내서 자연스럽게 offline으로 표시됨). `edge/.env.example`에 `HOMECARE_CAMERA_DEVICE_ID`(신규, 카메라 기기 id) 추가.
- **프론트**: [HomeScreen.jsx](../web/src/screens/HomeScreen.jsx)의 "카메라 N대 온라인"(가짜 샘플 데이터 카운트) 카드를 없애고, 실제 `devices` 목록에서 `type`으로 찾은 카메라/마이크 각각의 상태를 "켜짐/꺼짐/미등록"으로 보여주는 카드 2개로 교체(기존 "시스템 상태" 고정 카드 자리 포함, 2x2 그리드 유지).
- **로컬 검증**: 로컬 백엔드(운영 Supabase 연결)로 `POST /api/devices/:id/heartbeat` curl 테스트 → `last_heartbeat` 갱신 후 `status: online`으로 정상 전환 확인. `python -m unittest discover -s edge/tests -t .` 18개 통과(회귀 없음). `npm test` 기존과 동일(회귀 없음). `cd web && npm run build` 통과.
- **아직 안 된 것**: `camera_monitor.py`를 Pi에서 상시 실행되게 만드는 systemd 등록은 이번에 안 함(Pi 직접 접속 필요) — 등록 전까지 카메라 카드는 계속 "꺼짐". `schema.sql`의 devices 샘플 INSERT 블록도 이제 실제 운영 상태와 안 맞으니 다음에 정리 필요(이번엔 실행 안 함, 운영 DB만 직접 수정).
- 사용자가 Pi에서 `python -m edge.camera_monitor` 직접 실행 → 20초 뒤 실제로 `hardware_detected: true` 하트비트가 운영 DB까지 도착하는 것을 로컬 백엔드로 직접 확인(Camera Module V3 인식 정상). `python -m unittest`도 Pi에서 18개 통과. 이 커밋은 사용자가 직접 `git push`함.
- Vercel/Render가 아직 이 코드로 재배포되지 않아서 배포 사이트에서는 반영 안 됨을 안내(DB는 공유라 하트비트 자체는 이미 쌓이고 있었음). 홈 화면이 마운트 시 1회만 기기 상태를 불러오는 것도 설명(실시간 자동 갱신 아님, 필요하면 폴링 추가 가능).

### systemd 상시 실행 → 수동 on/off로 방침 변경
사용자 확인: "실시간으로 계속 켜져있을 필요는 없고 내가 동작하고 싶을 때만 킬거야" — 24시간 상시 감시가 아니라 필요할 때만 수동으로 켜고 끄는 운영 방식을 원함. [[homecare-onoff-policy]]

- [edge/systemd/homecare-mic.service](../edge/systemd/homecare-mic.service), [edge/systemd/homecare-camera.service](../edge/systemd/homecare-camera.service) 신규 작성(`User=alarmi`, `WorkingDirectory=/home/alarmi/homecare`, `Restart=on-failure`).
- [edge/README.md](../edge/README.md)의 안내를 `systemctl enable --now`(부팅 자동시작) 대신 `daemon-reload`만 미리 해두고 필요할 때 `systemctl start`/`stop`으로 수동 on/off 하는 방식으로 수정. `hometalk_인수인계.md`도 같은 방향으로 갱신.
- 나중에 마음이 바뀌면 `systemctl enable`만 추가하면 부팅 자동시작으로 전환 가능하다고 README에 남겨둠.
