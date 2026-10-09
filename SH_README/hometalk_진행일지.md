# HomeCare 서버 배포/인프라 진행일지

> 최근 수정일시: 2026-10-09 (거실/현관 감지 모드 + 경비 모드 구현 기록, 팀원 vision 변경 병합 / 이전 2026-10-05: CLAUDE.md 정리·문서 정정·테스트 재검증 기록 추가 / 이전 2026-09-29: (Pi Remote-SSH 실패 원인 = 회선 속도, 카메라 서비스 TypeError = Pi 미push 커밋 → 낙상 2단계 판정으로 수정 / 낙상 영상 Storage 미저장 원인 = `events` 버킷 없음(Bucket not found), vision 영상 Pi 원본 즉시 삭제 / 이전 2026-09-28: 이벤트 미디어 서명 URL, 엣지 폴더 재구성 `edge/apps/`·`edge/transport/` / 이전: 홈/채팅 현재 화면 캡처 구현, 카메라 사진 촬영·DB 전송 스크립트 추가, 마이크/카메라 systemd 명령 정리)
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
3. ~~**Anthropic API 크레딧 부족** — 채팅 요청이 `Your credit balance is too low`(400)로 실패. 코드/연결 문제가 아니라 계정 크레딧 문제. → 충전 필요.~~ **(해결됨, 2026-09-27)** 충전 후 크레딧 에러는 사라짐. 채팅 응답은 2026-09-27 항목 참고.
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

---

## 2026-09-27

### Anthropic 크레딧 충전 → 채팅 `input_schema` 400 에러 발견·수정
- 사용자가 API 크레딧 충전 후 웹 채팅 "최근에 무슨 일 있었어?" → `400 invalid_request_error: tools.0.custom.input_schema: Field required`. 크레딧 에러는 사라지고 요청 검증 단계까지 도달한 것(크레딧 부족 시엔 이 검증 전에 막혀 드러나지 않았던 기존 버그).
- 원인: `src/mcp/tools/*.js`의 도구 정의는 MCP 규격 `inputSchema`(camelCase)인데, `claude.service.js`가 그대로 Anthropic API에 넘김(API는 `input_schema` 요구). 도구 파일을 바꾸면 MCP 서버 쪽이 깨지므로 API 전달 시점에만 변환하도록 수정. 사용자가 직접 push.
- 이 변환은 아래 MCP 전환 후 `mcp.service.js`의 `listTools()`로 옮겨짐.

### `npm test` 기존 5건 실패 원인 확인 (수정은 안 함)
- 채팅 테스트 4건: `tests/setup.js`가 `NODE_ENV=test`라 인증 우회(development 전용)가 안 걸리고, 테스트가 토큰 없이 요청해 401. 인증은 정상 — 테스트가 인증 추가 이전 기준으로 작성된 것으로 보임. 그대로 고치면 실제 Claude API를 호출해 크레딧이 나가므로 mock 필요.
- 404 테스트 1건: `app.js`의 레거시 `frontend/` SPA 폴백 `app.get('*')`가 모든 GET에 `index.html`을 200으로 응답해 404 핸들러에 도달하지 않음(운영 Render에서도 동일할 것으로 보임).
- 사용자가 정리 방향 결정 전이라 보류.

### MCP 서버를 Streamable HTTP(`/mcp`)로 열고 채팅이 MCP 프로토콜로 도구 호출하도록 전환
- 배경: 과제 목표가 "MCP 서버 활용으로 차별점". 기존 채팅은 도구 핸들러를 인프로세스로 직접 import해 호출 → 실제 MCP 통신이 없었음(`server.js` stdio 서버는 런타임 미사용).
- 검토한 대안: A) 백엔드가 stdio 서버를 자식 프로세스로 실행(주소 없음, 외부 연결 불가) / **B) Express에 `/mcp` HTTP 엔드포인트 + 채팅은 MCP 클라이언트로 접속(선택)** / C) Claude API MCP 커넥터로 Anthropic이 직접 `/mcp` 호출(베타, Render 유휴 시 실패 위험, 디버깅 어려움 — B 위에 나중에 확장 가능). 설치된 `@modelcontextprotocol/sdk` 1.29.0에 Streamable HTTP 서버/클라이언트가 있어 새 의존성 없음.
- 변경:
  - `src/mcp/createServer.js` 신규 — 서버 생성+도구 등록을 팩토리로 분리. `server.js`(stdio)는 이걸 쓰도록 축소(`npm run mcp` 동작 유지, stdin으로 `tools/list` 9개 확인).
  - `src/controllers/mcp.controller.js` + `src/routes/mcp.routes.js` 신규, `app.js`에서 `/mcp` 등록(SPA 폴백보다 앞). stateless 모드(요청마다 서버/트랜스포트 생성, `enableJsonResponse`). `GET`/`DELETE`는 405.
  - `auth.middleware.js`에 `authenticateMcp` — `Authorization: Bearer <MCP_AUTH_TOKEN>`, timing-safe 비교, 개발환경에서도 스킵 안 함.
  - `config/index.js`에 `mcp.url`(기본 `http://127.0.0.1:${PORT}/mcp`), `mcp.authToken`. `MCP_AUTH_TOKEN` 미설정 시 기동마다 임의 토큰 생성 → Render에 변수를 안 넣고 배포해도 채팅은 동작, 외부 접속만 막힘. `.env.example`엔 예시값이 그대로 쓰이지 않도록 주석으로만 추가.
  - `src/services/mcp.service.js` 신규 — 채팅 1건당 MCP 연결 1개로 `tools/list`(→ `input_schema` 변환), `tools/call`(→ `tool_result` + `is_error`).
  - `claude.service.js` — 직접 import/`MCP_TOOLS`/`MCP_HANDLERS`/`callMcpTool` 제거, `mcpService.withSession()` 안에서 tool_use 루프 실행.
  - `index.js` 기동 로그의 "MCP Server will be available on port 3001"(실제 없는 포트) 문구를 `/mcp`로 수정.
- 검증: `tests/mcp.test.js` 신규 9건 통과 — 토큰 없음/틀림 401, GET 405, SDK 클라이언트로 `tools/list` 9개, `tools/call` 결과(기기 서비스만 mock), 없는 도구 `isError`, `mcp.service` 변환, **채팅 전체 흐름**(Claude API mock: tool_use → MCP tools/call → tool_result 전달 → 최종 답변). 전체 `npm test` 16건 중 11 통과/5 실패(실패 5건은 기존과 동일, 회귀 없음). 변경 파일 eslint 통과(`index.js` 파일 끝 개행 경고는 기존).

### 채팅 모델 404 → Haiku 4.5로 변경
- `input_schema` 수정 배포 후 채팅이 `404 not_found_error: model: claude-sonnet-4-20250514`로 실패. Sonnet 4(`claude-sonnet-4-20250514`)는 2026-06-15 종료된 모델. (앞의 `input_schema` 400은 이 단계에서 더 이상 안 나옴 → 그 수정은 반영된 것으로 보임)
- 공식 대체는 `claude-sonnet-5`였으나 **사용자 결정으로 `claude-haiku-4-5-20251001`(Haiku 4.5)로 변경** — `src/config/index.js`의 `anthropic.model` 한 곳. Haiku 4.5는 thinking이 기본 꺼짐이라 `max_tokens`(채팅 4096, 요약/이미지 1024)는 그대로 둠. `temperature`/`budget_tokens` 등 호환 안 되는 파라미터는 원래 안 씀.
- `npm test` 11 통과/5 실패(기존과 동일).


### MCP 전환 운영 확인 + 채팅이 위험 이벤트를 못 찾는 버그 수정
- 사용자가 MCP/모델 변경을 푸시한 뒤 Render Logs에서 `[MCP Client] tools/list → 9 tools`, `tools/call get_daily_summary`, `POST /mcp 200`을 확인 — **채팅이 운영에서 실제 MCP 경유로 동작**. (`GET /mcp 405`는 SDK 클라이언트의 SSE 시도를 stateless 서버가 거절한 것으로 정상)
- 증상: 이벤트 화면에 2일 전 `낙상 감지 테스트`(높음)가 있는데 "최근 7일동안 기록" 질문에 "위험 상황 없음". 로그상 `get_danger_events`의 MCP 응답이 75바이트(빈 배열).
- ~~원인: `src/mcp/tools/event.tools.js`가 DB 행을 camelCase(`e.dangerLevel`, `e.imageUrl`)로 읽음 — Supabase 행은 snake_case(`danger_level`, `image_url`)라 위험 필터는 항상 빈 결과, 방문자 사진 URL은 항상 누락.~~ → snake_case로 수정, `tests/mcp.test.js`에 실제 DB 형태(snake_case) mock으로 회귀 테스트 2건 추가(수정 전 코드에선 실패 확인). **(해결됨, 2026-09-27 — 배포 전)**
- ~~**채팅이 이전 맥락을 기억 못 함**: 같은 대화의 두 번째 메시지에서 `Loaded 0 previous messages` — `claude.service.js`의 `loadMessages`가 anon 클라이언트로 `messages`를 읽는데, 사용자가 준 운영 스키마 기준 `messages` SELECT RLS가 `auth.uid()` 조건이라 사용자 JWT 없는 anon 요청은 항상 0건(저장은 admin이라 됨).~~ → `supabaseAdmin`으로 읽도록 수정. **(해결됨, 2026-09-27 — 배포 전)** 같이 수정:
  - 보안: 클라이언트가 보낸 `conversationId`를 검증 없이 써서(저장은 admin) 남의 대화 ID로 기록을 읽거나 메시지를 끼워 넣을 수 있었음 → `isOwnConversation()`으로 `conversations.user_id` 확인, 아니면 새 대화로 시작.
  - 오래된 순 정렬 후 `limit(50)`이라 50개 넘는 대화는 처음 50개만 전달되던 문제 → 최신순 50개를 가져와 시간순으로 되돌림.
  - `tests/chat-history.test.js` 신규 3건(anon은 RLS처럼 빈 결과를 주는 가짜 DB, 수정 전 코드에선 3건 모두 실패 확인). 전체 `npm test` 16 통과/5 실패(실패 5건은 기존).
- ~~남은 같은 종류 문제: `chat.controller.js`의 `getHistory`(`GET /api/chat/history`)와 `deleteConversation`도 anon 클라이언트로 `conversations`/`messages`를 읽어 RLS에 막힘 → 기록 조회는 항상 빈 결과, 삭제는 항상 404. 게다가 `getHistory?conversationId=`는 소유자 확인이 없었음.~~ → 아래 "채팅 기록" 작업에서 해결. **(해결됨, 2026-09-27 — 배포 전)**

### 채팅 기록 조회/삭제 (Claude 모바일 앱 스타일, 로그인 계정별)
- 백엔드: `src/services/conversation.service.js` 신규 — 대화 생성/소유자 확인/메시지 조회·저장/목록/삭제를 한 곳에 모음(모두 `supabaseAdmin` + `user_id` 직접 확인). `claude.service.js`와 `chat.controller.js`가 이걸 쓰도록 변경(컨트롤러에서 DB 직접 접근 제거). API 경로/응답 형태는 유지.
  - `GET /api/chat/history`: 로그인 사용자 대화만, `updated_at` 최근순. `?conversationId=`는 본인 대화가 아니면 404(기존엔 남의 대화 메시지도 조회됐음), 메시지는 전체 시간순(기존 `limit/offset` 페이지 적용은 대화 단위 조회에선 제거).
  - `DELETE /api/chat/history/:id`: 본인 대화만(아니면 404), messages는 FK CASCADE.
  - 대화 제목: 기존엔 항상 `null` → 첫 질문 앞 40자 저장. 메시지 저장 시 `conversations.updated_at` 갱신(기존엔 생성 후 갱신 안 돼 최근순 정렬이 안 됐음). **이미 있는 대화는 제목이 null이라 목록에 "제목 없는 대화"로 보임.**
- 프론트: 채팅 헤더 왼쪽 ☰ → 왼쪽 서랍(`web/src/components/ChatHistoryDrawer.jsx`): 새 채팅, "최근" 목록(현재 대화 강조, 상대시간), 항목별 삭제(확인창), 하단 로그인 계정. 헤더 오른쪽 ✎ = 새 채팅. `ChatContext`에 목록(처음 열 때 1회 로드 후 전송/삭제 시 로컬 갱신)·열기·새 채팅·삭제 추가. 답변 대기 중엔 대화 전환 막음. 채팅 영역 그라데이션 배경 제거(사용자 요청). 추가로 닫힌 서랍의 `shadow-2xl`이 화면 왼쪽 가장자리에 세로 그라데이션 띠처럼 비치던 문제 발견 → 열렸을 때만 그림자.
- 검증: Jest 신규 7건(목록 사용자별·최근순, 메시지 조회, 남의 대화 조회/삭제 404, 삭제 시 메시지 CASCADE, 제목·updated_at) — 전체 23 통과/5 실패(기존). 브라우저(Edge 헤드리스, mock 백엔드) 채팅 기록 시나리오 22건 + 기존 탭 이동 시나리오 19건 통과, 스크린샷으로 UI 확인. 실제 운영 DB/로그인으로는 **배포 후 확인 필요**.
- 참고: 사용자가 준 운영 스키마 사본에는 `push_subscriptions`/`notification_preferences` 테이블이 없음 — 운영 DB에 웹 푸시 테이블이 생성됐는지 **확인 필요**(인수인계 "웹 푸시 알림" 수동 작업 1번).

### AI 응답 UI 개선 (Markdown 노출·표 깨짐 → 카드/Badge/Alert)
- 원인: 프론트에 Markdown 렌더러가 없어 `ChatScreen`이 `{m.text}`를 그대로 출력(`**`, `|`, `-` 노출). 말풍선의 `whitespace-pre-wrap` + `max-w-[240px]`에서 `|------|` 같은 끊을 곳 없는 긴 줄이 말풍선을 뚫어 페이지 전체 가로 스크롤 발생.
- 라이브러리 추가 없이 구현(블록 분류 우선순위가 필요해 Markdown→HTML 방식 라이브러리로는 어차피 앞단 파서가 필요, 필요한 문법이 적음, HTML 문자열 미사용이라 XSS 없음):
  - `web/src/lib/chatBlocks.js`: 응답 → 블록 배열. 우선순위 JSON 구조화 데이터 > 장치/이벤트/통계 표·"장치 / 유형 / 위치 / 상태" 줄·⚠️ 경고 > 제목·목록·코드·일반 표 > 문단. 표는 헤더로 분류(장치명+상태 → 장치, 시간+이벤트 → 이벤트, 2열 숫자 → 통계, 그 외 → 세로 배치 표). 카드 바로 앞 제목 줄은 카드 제목으로 합침.
  - `web/src/components/chat/`: `AiMessage`(텍스트 블록은 말풍선, 구조화 블록은 독립 카드), `MarkdownText`(굵게·기울임·코드·링크, `🔴 오프라인` → Badge), `ChatCards`(StatusBadge, DeviceStatusCard, EventList, StatCard, AlertCard, ResponsiveTable).
  - 경고(Alert)는 `⚠️/🚨/❗` 또는 `주의:/경고:/위험:`으로 시작하는 줄만 — 일반 문장 속 "오프라인"까지 Alert로 바꾸면 설명문이 전부 경고가 되므로 제외.
  - 기존 API(`message` 문자열)·DB 저장 형식 유지 → 이전 대화 기록도 같은 UI로 보임. `claude.service.js` 시스템 프롬프트에 표 헤더/⚠️ 형식 규칙 5줄 추가(모델 출력을 파서 형식에 맞춤).
- 검증: 파서 단위 확인(14개 샘플), 브라우저 375px 모바일 폭에서 요청 테스트 A~D/1~6 + 충돌·JSON·일반 표·코드 14건 모두 의도한 UI, Markdown 기호 노출 없음, 페이지 가로 스크롤 없음(스크린샷 확인). 기존 탭 이동 19건·채팅 기록 22건 회귀 통과. 빌드 번들이 500KB 경고선을 약간 넘음(동작 무관).

### 채팅 "방문자 확인"이 며칠 전 초인종 방문을 못 찾던 문제
- 증상: 이벤트 화면엔 9/22 `초인종/방문 감지`(엣지 `door_visitor` → `type: visitor`)가 있는데 채팅 "방문자 확인"은 "최근 방문자 기록이 없습니다".
- ~~원인: `get_visitor_log`가 날짜 생략 시 **오늘(UTC) 하루만** 조회. 도구 설명도 "생략시 오늘"이라 모델이 기간을 넓혀 재조회하지 않음.~~ → 날짜 생략 시 최근 `days`일(기본 7) 방문을 `eventService.getEvents({type:'visitor'})`로 최신순 조회, 날짜 지정 시엔 기존처럼 그날만. 도구 설명 갱신. `tests/mcp.test.js` 회귀 테스트 추가(수정 전 코드에선 실패 확인). 전체 24 통과/5 실패(기존). **(해결됨, 2026-09-27 — 배포 전)**
- ~~남은 관련 문제: "오늘"·날짜 경계가 UTC 기준, 시스템 프롬프트에 오늘 날짜 없음~~ → 아래에서 해결.

### "이번주 요약" 버튼 + 기간 요약에서 이벤트가 빠지던 문제
- 채팅 빠른 질문에 "📅 이번주 요약" 추가. MCP 도구 `get_weekly_summary` 신규(`eventService.getWeeklySummary` 사용, 도구 10개).
- 증상: 7일 방문자 조회 수정 후에도 "방문자 없음", 이번주 요약은 3건 중 1건(낙상)만, 게다가 "9월 25일 **오전 7시**"(실제 오후 4시). 로컬 백엔드 REST로 직접 확인하니 기간 조회·주간 요약 API는 3건을 정확히 반환 → 데이터/쿼리 문제가 아니라 모델 쪽.
- ~~원인: ① 시스템 프롬프트에 현재 날짜가 없어 "이번 주/오늘" 해석 기준이 없음 → 부분 도구(오늘 요약·위험만)로 총계를 추측 ② 주간 요약이 건수만 있어 상세를 쓰려면 날짜별 추가 호출 필요 ③ 도구가 UTC timestamp만 줘서 모델이 UTC 시각을 그대로 읽음(9시간 오차) ④ 날짜 경계·"오늘"이 UTC 기준(한국 00~09시 이벤트가 전날로) ⑤ `[MCP] Arguments:` 로그가 비어 인자 확인 불가~~ → 수정:
  - `src/utils/date.utils.js`: `kstDateString`/`kstDayRange`/`formatKst` 추가(서버 시간대 무관 KST), `getTodayString`도 KST로.
  - `event.service.js`: `getEventsByDate` 한국 날짜 경계, `getWeeklySummary`에 `byType`·`events`(한국 시간 `timeKst` 포함) 추가·날짜 묶음 KST, `getDailySummary` timeline에 `timeKst`.
  - `event.tools.js`: "오늘" = KST, 모든 이벤트 결과에 `timeKst`. `chat.controller`/`event.controller` 기본 날짜 KST. 프론트 홈의 오늘 날짜도 기기 로컬 날짜로.
  - `claude.service.js`: 시스템 프롬프트에 요청마다 현재 한국 날짜/시각, 도구 선택 규칙(기간→weekly, 방문→visitor_log, 위험→danger), "결과의 이벤트는 빠짐없이, timeKst 그대로" 규칙.
  - `createServer.js`: 도구 인자를 `[MCP] Tool called: 이름 {인자}` 한 줄로 로그.
- 검증: `tests/event-date.test.js` 신규 3건(주간 요약 3건 전부+유형별, UTC 07:00→"오후 4:00", 한국 새벽 이벤트가 한국 날짜로 분류) + 시스템 프롬프트 날짜 포함 확인. 전체 28 통과/5 실패(기존). 실제 Claude 응답은 사용자 로컬 앱에서 **재확인 필요**(모델 응답이라 테스트로 보장 못 함).

### 채팅 화면 진입 시 위→아래 스크롤 애니메이션 제거
- ~~원인: `ChatScreen`의 `useEffect(() => scrollIntoView({ behavior: 'smooth' }), [messages])` — 그려진 **뒤** 실행돼 첫 프레임은 맨 위, 이어서 smooth 애니메이션. 전역 `html { scroll-behavior: smooth }`도 겹침(채팅은 window 스크롤, 탭 전환마다 재마운트).~~ → `useLayoutEffect`(그리기 전)로 바꾸고, 진입/대화 전환(첫 메시지가 바뀐 경우)은 `behavior: 'instant'`로 즉시 맨 아래, 대화 중 새 메시지는 기존대로 smooth. 전역 CSS는 유지.
- 검증: 브라우저에서 홈→채팅 클릭 직후 프레임별 scrollY 기록 — 수정 후 첫 프레임부터 맨 아래·40프레임 불변, 새 메시지는 부드럽게(7/7). 수정 전 코드로는 y=0→2→10→24→47… 애니메이션 재현(4/7). 채팅 기록 22건 회귀 통과.

- ~~**배포 후 확인 필요**: 커밋/푸시 전.~~ → 사용자가 커밋·push(`a1559cc` 채팅수정, `cc1ad07` 수정). Render 배포 후 Logs에 `[MCP Client] tools/call ...`, 웹 채팅이 실제 이벤트로 답하는지, 토큰 없이 `POST /mcp`가 401인지는 **아직 확인 필요**.

### "이번주 요약"이 여전히 3건 중 1건 + "오전 7시"로 답함 — 원인 재조사 (미해결)
- 사용자 스크린샷: 이벤트 화면엔 3건(9/25 낙상 테스트, 9/22 문 소리·초인종)인데 채팅 "이번주 요약"은 총 1건, "9월 25일 오전 7시"(UTC).
- 처음엔 "커밋 안 된 로컬 변경이라 Render(구 코드)가 답했다"고 판단했으나 **틀림**: Vite 개발 서버가 서빙하는 `api.js`에서 `VITE_API_URL`이 `http://localhost:3000`임을 확인, 로컬 백엔드는 17:20에 새 코드로 재시작돼 있었고 `MCP_SERVER_URL`도 미설정(같은 프로세스 `/mcp` 사용).
- 새 코드의 `get_weekly_summary`는 테스트상 3건·`timeKst`를 반환하므로, 모델이 이 결과를 보지 않은 것으로 추정. 후보: ① 같은 대화의 이전 답변 재사용(대화 기록엔 최종 텍스트만 저장, 도구 결과 미저장) ② 다른 도구 선택. **새 대화에서 재질문 후 로그 `[MCP] Tool called:` 도구명으로 판별 필요**.

### 채팅 통계 카드 높이 축소
- `web/src/components/chat/ChatCards.jsx` `StatCard`: 라벨/숫자 2줄 → 한 줄 좌우 배치, `p-3.5`→`px-3 py-2`, 숫자 `text-xl`→`text-base`. 타일 높이 약 절반.

### 홈 "오늘의 브리핑" 새로고침 시 유지 (서버 저장)
- 문제: 브리핑이 React state에만 있어 새로고침하면 "브리핑 만들기" 화면으로 돌아감.
- 1차로 브라우저 localStorage 저장을 구현했다가, 사용자 요청으로 서버 저장으로 교체(다른 기기에서도 보이도록).
- 백엔드: `src/services/briefing.service.js` 신규(supabaseAdmin + `user_id` 필터), `POST /api/chat/summary`가 생성과 동시에 저장(저장 실패해도 응답은 정상, 경고 로그만), `GET /api/chat/summary/latest` 신규. 처음엔 매번 행 추가였으나 사용자 요청으로 **사용자당 1행 upsert(`user_id UNIQUE`, `onConflict: 'user_id'`)**로 변경.
- DB: `database/schema.sql`에 "7-1. Briefings 테이블" + RLS(본인 SELECT, service_role 전체). **Supabase에 생성 SQL 실행 여부 확인 필요**(사용자에게 SQL 전달함 — 이미 누적형으로 만들었으면 중복 삭제 후 `UNIQUE` 추가 SQL도 전달).
- 프론트: `AppDataContext`가 앱 시작 시 최신 브리핑을 복원(`restoring` 상태 → "마지막 브리핑을 불러오는 중…"), 오늘 만든 게 아니면 생성 시각에 날짜도 표시.
- 검증: `tests/chat-history.test.js`에 5건 추가(최신 조회, 없으면 null, 생성 후 조회, 사용자당 1행 덮어쓰기·타인 불변, 401). 실제 Supabase로는 미검증.

### 브리핑 시각 UTC → 한국 시간, 브리핑 Markdown UI
- ~~`claude.service.js` `generateDailySummary`가 이벤트 `timestamp`(UTC)를 그대로 프롬프트에 넣어 브리핑 속 시각이 9시간 틀릴 수 있음~~ → `formatKst()`로 변환. 테스트로 "오후 4:00" 포함·UTC 문자열 미포함 확인. **(해결됨, 2026-09-27)**
- 브리핑이 `whitespace-pre-line` 텍스트라 `#`, `**`가 그대로 노출 → `AiMessage.jsx`에 `MarkdownBlocks`(채팅과 같은 파서·카드, 말풍선 없이) 추가, 홈 카드에서 사용(맨 앞 `#` 제목은 카드 제목과 중복이라 생략). 브리핑 전용 시스템 프롬프트 `BRIEFING_SYSTEM_PROMPT`(한 줄 요약, `## 이모지 섹션`, `- **오후 2:55** 내용`, `⚠️` 경고, 15줄 이내).
- 전체 `npm test` 34 통과/5 실패(기존 5건), 백엔드 eslint·프론트 lint/build 통과.

### Claude Desktop으로 MCP 서버 테스트하는 방법 조사
- stdio 버전을 로컬에서 `initialize` 요청으로 실행해 본 결과 두 가지 문제 확인(미수정): ① `server.js`가 `.env`를 로드하지 않아 `Missing environment variables` 경고(도구 호출 시 Supabase 실패 예상) ② winston 로그 `info: 🔧 MCP Server "homecare-mcp" is running`이 **stdout**에 찍혀 JSON-RPC 응답과 섞임.
- 결론: Claude Desktop은 원격 `/mcp`를 `mcp-remote` 브리지(`--header "Authorization:${AUTH_HEADER}"`, `env`로 `Bearer 토큰` 전달)로 연결하는 방식을 README "MCP 서버 테스트"에 정리. Render `MCP_AUTH_TOKEN` 설정 여부와 실제 연결은 **확인 필요**.
- README.md 갱신: 아키텍처(인프로세스 → `/mcp`), 도구 10개 표, Chat API(`summary/latest`), `MCP_AUTH_TOKEN`, 알려진 이슈·테스트 현황.

### Claude Desktop 실제 연결 시도 → 문제 3건
1. ~~설정 파일 JSON 파싱 오류(`Bad control character ... line 21`)~~ — 토큰을 `.env`에서 복사하며 줄바꿈이 섞여 닫는 따옴표가 다음 줄로 밀림 → 한 줄로 수정. **(해결됨, 사용자 조치)**
2. ~~`npx -y mcp-remote` 실행 실패(`ERR_MODULE_NOT_FOUND strict-url-sanitise`)~~ — Claude Desktop이 같은 서버를 일반 채팅용과 Cowork/Code용(`shared-pool`)으로 동시에 띄워 두 npx가 같은 `_npx` 캐시에 동시 설치 → `EPERM`으로 파일 누락. → `npm install -g mcp-remote` 후 `command: "mcp-remote"`로 변경. **(해결됨, 사용자 조치)** (Node 20.18.0 < undici 요구 20.18.1 `EBADENGINE` 경고는 동작엔 영향 없었음)
3. ~~`mcp-remote`가 OAuth 탐색에서 `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`으로 종료~~ — mcp-remote는 접속 전 `GET /.well-known/oauth-protected-resource` 등으로 OAuth 여부를 확인하는데, `app.js`의 레거시 `frontend/` SPA 폴백 `app.get('*')`가 이 경로에 `index.html`을 200으로 응답. → 폴백에서 `/.well-known/*`만 제외해 404 JSON을 주도록 수정(폴백 전체 제거는 영향 범위가 커서 보류). `tests/mcp.test.js`에 회귀 테스트 추가(35 통과/5 실패, 실패는 기존). 로컬 임시 서버(3999, 테스트 토큰)에 실제 `mcp-remote`로 접속해 `initialize` → `tools/list` 10개 수신까지 확인. **(해결됨, 2026-09-27 — 사용자 push `0282664`, 배포 후 HTML 오류 사라짐 확인)**
4. ~~배포 후에도 `Dynamic Client Registration rejected (404) /register` → SSE `405`~~ — 토큰 불일치 때와 같은 흐름(401 → mcp-remote가 OAuth·SSE로 폴백). PowerShell 직접 요청은 `OK 200`이었으나, 설정 파일 `AUTH_HEADER` 형식을 값 출력 없이 검사해 보니 **`Bearer ` 접두사가 빠져 있었음**(`authenticateMcp`는 `Bearer `로 시작하지 않으면 토큰을 빈 값으로 취급). → 사용자가 `Bearer `를 붙여 수정. **(해결됨, 2026-09-27 — Claude Desktop에서 homecare 도구 정상 동작 확인)**
- 참고: 폴백 로그 순서(`/register` 404 → `sse-only` 405)가 보이면 거의 항상 토큰/헤더 문제다. 로컬에서 일부러 틀린 토큰으로 같은 로그를 재현함.

### 카메라 사진 촬영 → DB 전송 (`edge/capture_photo.py`)
- 요청: Pi 카메라로 사진을 찍어 DB에 보내기. 확인해 보니 백엔드 `POST /api/events`가 이미 multipart `image`를 받아 Supabase Storage(`events` 버킷)에 올리고 `image_url`을 저장하고, 엣지 outbox/sender도 첨부 전송을 지원 → **촬영 코드만 없었음**. 백엔드는 수정 안 함(Render 재배포 불필요).
- 대안 검토: ① `camera_monitor.py`에 합치기(하트비트 데몬과 섞임) ② picamera2(새 의존성, venv 설치 번거로움) ③ **새 1회성 스크립트 + `rpicam-still` 호출**(camera_monitor와 같은 libcamera-apps, 의존성 없음) → ③ 선택.
- 변경:
  - `edge/capture_photo.py` 신규: `rpicam-still -n -t 1000 --width 1920 --height 1080 -q 85`(없으면 `libcamera-still`) → `camera_capture` 이벤트로 큐 저장 → 최대 3분 재시도하며 전송. `--no-send`, `--description` 옵션.
  - 전송 기기 id를 마이크(`HOMECARE_DEVICE_ID`)가 아니라 **카메라(`HOMECARE_CAMERA_DEVICE_ID`)**로, 큐를 `edge/data/camera/`로 분리(공용 큐면 마이크 sender가 사진 이벤트를 마이크 id로 보낼 수 있음).
  - `edge/event_mapper.py`: `camera_capture`(카메라 사진 촬영, `other`/`normal`, 쿨다운 0) 추가.
  - `edge/sender.py`: 첨부했는데 응답에 `*_url`이 비면 경고 — 백엔드가 Storage 업로드 실패 시에도 사진 없이 201 저장하기 때문(과거 `temp_` id 문제와 같은 "성공처럼 보이는 실패" 방지).
- 검증: 엣지 단위 테스트 21개 통과(기존 18 + 신규 3: `libcamera-still` 대체, 카메라 id·분리 큐로 전송, URL 누락 경고). `--help` 실행 확인. **Pi 실기 촬영·전송과 Supabase `events` 버킷 존재/public 여부는 확인 필요**. 커밋 전.

### 마이크/카메라 systemd 켜기·끄기 명령 정리
- 사용자가 쓰는 명령(둘 다 / 마이크만 / 카메라만의 `start`·`stop`·`is-active`, `status`, `journalctl -u ... -f`)을 인수인계 "카메라/마이크 온·오프 상태"에 정리. `homecare-camera.service`는 하트비트만 돌리고 사진은 찍지 않는다는 점도 명시.
- unit 파일이 Pi에 설치됐는지(`/etc/systemd/system/` 복사 + `daemon-reload`)는 이번에 직접 확인하지 않음 — **확인 필요**(인수인계 "알려진 이슈"의 미설치 항목은 확인 전까지 유지).

### 현재 화면 캡처 — 홈 카메라 카드 / 채팅 "현재 화면 보여줘"
- 요청: 홈의 기존 📷 카메라 카드와 채팅 "현재 화면 보여줘"로 라즈베리파이 카메라가 **그 순간 실제로 찍은 사진**을 보여주기.
- 사전 조사로 확인한 것: ① 백엔드↔Pi는 Pi→백엔드 단방향 HTTP뿐(백엔드가 Pi로 먼저 접속할 방법 없음, WebSocket/SSE/MQTT 없음) ② `POST /api/devices/:id/capture`는 TODO 껍데기(성공만 응답) ③ MCP `request_capture`는 `capture_requests`/`events`에 `[CAPTURE_REQUEST]` 가짜 행을 쓰기만 하고 가져가는 Pi 코드가 없었음 ④ 채팅 메시지는 텍스트(`content`)만 저장, 이미지 렌더링 없음 ⑤ 홈 카메라 카드는 클릭 안 되는 `div`.
- 대안 검토: Pi로 신호 보내기 — WebSocket/MQTT(새 의존성) / DB 폴링(몇 초 지연 + 테이블 추가) / **HTTP 롱폴링(선택, 기존 기기 인증 재사용·즉시 반응)**. 이미지 — Supabase Storage 공개 URL(집 내부 사진이 URL만으로 공개, 버킷 상태 불확실) / **백엔드 메모리 임시 보관 + 인증 조회(선택, 영구 저장 안 함)**. 채팅 이미지 — 모델이 URL을 쓰게 하기(옮겨 적다 틀릴 수 있음) / **서버가 도구 결과에서 붙이기(선택)**.
- 변경:
  - 백엔드: `src/services/capture.service.js` 신규(요청·롱폴링·결과·보관, 같은 카메라 동시 요청 합치기, 타임아웃). `device.controller.js`의 TODO `requestCapture` 구현 + `getCaptureImage`/`pollCaptureRequest`/`submitCaptureResult`, `device.routes.js`에 `GET :id/captures/:captureId`, `GET :id/capture-requests/next`, `POST :id/capture-requests/:requestId`(JPEG만, 10MB). 촬영·조회는 기기 소유자만.
  - MCP `request_capture`: 실제 촬영으로 교체, `deviceId` 선택. `claude.service.js`: 도구 결과의 `imageUrl`을 답변 앞에 `![현재 카메라 화면](...)`로 붙임, 시스템 프롬프트에 도구 선택 규칙 1줄.
  - Pi `edge/camera_monitor.py`: 캡처 요청 롱폴링 스레드 + `capture_current_frame()`(기존 `capture_photo.capture()` 재사용, 1280x720, 임시 폴더에서 바로 삭제), 인식 확인과 촬영 사이 lock, 실패 사유(`camera_not_detected`/`capture_failed`) 보고.
  - 프론트: `HomeScreen.jsx` 카메라 카드를 버튼으로(촬영 중 비활성화) + "현재 카메라 화면" 카드(로딩/성공/꺼짐/실패, 다시 촬영·닫기), `components/CaptureImage.jsx` 신규(토큰 붙여 Blob으로 받음, 비율 유지·최대 60vh, 누르면 전체 화면), `chatBlocks.js`에 캡처 경로 이미지 블록(외부 URL은 이미지로 안 그림), `api.js`에 에러 `status`와 Blob 요청.
- 발견·수정: 롱폴링 연결 끊김을 `req.on('close')`로 감지하려다, Node 16+에선 GET 본문을 다 읽자마자 발생해 폴링이 바로 끊기는 문제를 코드 작성 중 발견 → `res.on('close')`로 변경, 끊긴 순간 넘기려던 요청은 다음 폴링이 다시 가져가게(`undispatch`).
- 검증: `tests/capture.test.js` 13건 신규(전체 흐름·소유자만 조회, 꺼짐 409, Pi 미연결 503, 남의 기기 404/카메라 아님 400, 폴링 대기 만료, 동시 요청 촬영 1번, Pi 장치 없음 503, 타임아웃 504, 기기 id 불일치 403/만료 요청 410, MCP 도구 꺼짐/성공, 채팅 답변에 이미지 줄 붙임/실패 시 안 붙임). 전체 48 통과/5 실패(실패 5건은 기존 `chat.test.js` 4 + `app.test.js` 1). 엣지 24개 통과(리스너 3건 추가). 변경 파일 eslint 에러 0, 프론트 oxlint 에러 0·빌드 성공, 채팅 파서 이미지 블록 출력 확인.
- ~~**실기 검증 미완료**: Render 배포 + Pi `git pull` + `sudo systemctl restart homecare-camera.service` 후 홈 카드·채팅에서 실제 사진 확인 필요~~ → 사용자 커밋·push(`03634f2 캡쳐`), 배포 후 실제 환경에서 동작 확인(사용자 보고). **(해결됨, 2026-09-27)**

## 2026-09-28

### 엣지 폴더 재구성 (`edge/apps/`, `edge/transport/`)
- 파일이 한 폴더에 섞여 있어 역할별로 분리(`git mv`, 이력 유지):
  - `edge/apps/` — 직접 실행하는 프로그램: `stream_pipeline.py`, `camera_monitor.py`, `capture_photo.py`, `send_test_event.py`
  - `edge/transport/` — 이벤트 전송 모듈: `emit.py`, `event_mapper.py`, `cooldown.py`, `outbox.py`, `sender.py`, `heartbeat.py`, `config.py`
  - `systemd/`, `tests/`, `data/`는 그대로.
- 같이 고친 것: import 경로(`apps/`, `edge/tests/`, `vision/vision_pipeline.py`), `config.py`의 기준 폴더(`edge/` 유지 → `edge/.env`·`edge/data/` 위치 불변), `stream_pipeline.py`의 `yamnet/core` 경로, systemd unit `ExecStart`(`python -m edge.apps.xxx`), 문서의 실행 명령(CLAUDE.md, edge/README.md, DEPLOYMENT.md, 인수인계). logger 이름(`edge.sender` 등)은 그대로 둠.
- 검증: 엣지 단위 테스트 24개 통과, `edge/.env`·`edge/data`·`yamnet/core` 경로 해석 확인, `python -m edge.apps.{stream_pipeline,camera_monitor,capture_photo} --help` 정상. `vision/`은 `picamera2`(Pi 전용)가 없어 로컬 import 불가 — Pi에서 **확인 필요**.
- **Pi 반영 필요(미완료)**: `git pull` 후 `sudo cp edge/systemd/*.service /etc/systemd/system/ && sudo systemctl daemon-reload` → 켜 둔 서비스 `restart`. unit 파일을 다시 복사하지 않으면 옛 명령(`python -m edge.stream_pipeline`)이 모듈을 못 찾아 서비스가 실패함.

### 이벤트 사진/영상 조회 — private 버킷 서명 URL
- 결정(사용자): 영상은 Supabase Storage에 올리고 URL을 DB에 저장. `events` 버킷은 **private**, 앱은 서명 URL로 조회(방식 B). 기존 코드는 최대한 유지.
- 확인: 엣지→`POST /api/events`(multipart `video`)→Storage `events/video/`→`events.video_url` 저장 경로는 이미 구현돼 있음. 다만 업로드가 `getPublicUrl()` 값을 저장해 private 버킷에선 열리지 않는 링크였음. 웹에는 이벤트 사진/영상 표시 화면이 없음.
- 대안: 업로드 시 URL 대신 경로 저장(업로드·기존 데이터 형식 변경) / **조회 응답에서만 서명 URL로 치환(선택, DB·업로드 무변경, 기존 행도 동작)**.
- 수정: `src/services/storage.service.js`에 `signEventMedia()` 추가(저장된 URL에서 경로 추출 → `createSignedUrls` 1회, 1시간, 실패 시 null·외부 URL 유지), `src/controllers/event.controller.js`의 `getEvents`/`getEventById` 응답에 적용. MCP·요약은 미적용.
- 검증: `tests/event-media.test.js` 4건 신규(목록 일괄 서명·외부 URL 유지, 상세, 서명 실패 시 null, Storage 파일 없으면 요청 안 함). 전체 52 통과/5 실패(기존 5건). 추가 코드 eslint 에러 0(`uploadFile`의 기존 들여쓰기 에러 2건은 그대로).
- **미완료**: 커밋·Render 배포 전. 배포 후 실제 private 버킷 파일로 서명 URL이 열리는지 확인 필요.

### 엣지 소리 이벤트 반복 전송 버그 수정 (소리·영상 융합 0-1단계)
- 발견: `stream_pipeline.py`가 0.48초마다 **3시간치 점수 히스토리 전체**로 규칙을 다시 판정 → 예전에 한 번 넘은 프레임이 히스토리에 남아 있는 동안 계속 `triggered=True`, 쿨다운만 지나면 같은 이벤트를 다시 전송. 10분 시뮬레이션(유리 1회+초인종 1회)에서 glass_impact 60건·door_visitor 2건, 두 번째부터 신뢰도 0.01(최신 무음 프레임 점수). 3시간이면 유리 1번에 약 1,080건 추정. 운영 DB에 이미 중복 이벤트가 있을 수 있음(**확인 필요**).
- 대안: 이미 처리한 프레임 기억 / 규칙별로 필요한 구간만 판정(`event_rules.py`까지 수정) / **최신 프레임이 트리거에 포함될 때만 emit(선택, `_handle_triggers`만 수정)**.
- 수정: `edge/apps/stream_pipeline.py` `_handle_triggers()` — 최신 프레임 포함 시에만 emit, 신뢰도·top5·trigger_times는 최근 약 6초(`RECENT_TRIGGER_FRAMES=12`) 트리거 프레임 기준. 지속형 규칙(kitchen_risk/long_silence)은 기존처럼 쿨다운 간격 전송.
- 검증: 재현 테스트 `test_single_sound_is_not_re_emitted_after_cooldown` 추가(수정 전 6≠1로 실패 확인 → 수정 후 통과), 엣지 25개 통과, 같은 시뮬레이션 glass 1건·door 1건·신뢰도 0.8.
- 남은 것: 히스토리가 길어질수록 판정이 느려지는 문제(3시간 시 PC 기준 210ms/회)는 그대로 — Pi 실측 필요.

### vision 방문자 감지 버그 수정 + 행동 추적기 (소리·영상 융합 0-2단계)
- 발견: `vision/visitor_detector.py`가 ROI 안에 계속 있는 사람을 "이미 안에 있음"으로 보고 매 프레임 카운터를 0으로 리셋 → `required_frames=3`에 도달 불가, **방문자 이벤트가 한 번도 발생하지 않음**(기존 코드로 200프레임 연속 서 있기 재현 → 0건). 고치더라도 3프레임(0.6초)이면 지나가는 사람도 방문자.
- 수정(기존 인터페이스 유지): `vision/activity_tracker.py` 신규 — 없음→등장→머무름→퇴장/지나감 상태 추적, YOLO 순간 누락은 5프레임 유예, 마지막 사람 위치 기억(택배 판정용). `VisitorDetector`는 카운터 부분만 추적기로 교체(생성자·`update()` 입출력·ROI 판정 그대로). `vision_pipeline.py` `VISITOR_REQUIRED_FRAMES` 3→15(5fps 기준 3초).
- 검증: `vision/tests/test_visitor.py` 6건 신규(머무름 1회, 지나감 무시, 순간 누락에도 1회, 떠났다 오면 재발생, ROI 밖 무시, 상태 전이) — `python -m unittest discover -s vision/tests -t .`. 엣지 25개 통과. Pi 실제 카메라 확인은 나중에 일괄.

### vision 택배 감지 재설계 — 두고 간 물체 감지 (소리·영상 융합 0-4단계, 사용자 요청으로 0-3보다 먼저)
- 발견: YOLO 기본 모델(`yolov8n.pt`, COCO 80클래스)에 상자/택배 클래스가 없음(모델 파일에서 클래스 목록 직접 확인). 기존 `delivery_detector.py`는 "ROI 안 사람 + 백팩/핸드백/여행가방 3프레임"을 택배로 판정 → 실제 상자는 못 잡고 가방 멘 사람은 택배로 오탐.
- 대안: 두고 간 물체 감지(OpenCV 배경 비교) / 택배 상자 전용 YOLO 추가 학습 / YOLO-World(Pi에서 무거움) → **사용자 결정: 두고 간 물체 감지(A안)**.
- 수정: `vision/delivery_detector.py` 판정 로직 교체 — 사람 없을 때 배경 천천히 갱신 → 등장 시 고정 → 퇴장(머묾/지나감 모두) 후 최대 10초간 160×120 흑백으로 배경 비교, 사람이 서 있던 자리 주변에 새 덩어리가 연속 `required_frames` 보이면 택배(점수=밝기 차이/100). 화면 40% 이상 변화는 조명 변화로 무시, 사람이 다시 나타나면 중단, 확정 후 물체를 배경에 포함. `ActivityTracker`(0-2) 재사용. 클래스명·생성자·반환값 유지, `update()`에 `frame` 인자 추가(기본 None). `vision_pipeline.py`는 호출에 `frame=frame` 추가, `DELIVERY_REQUIRED_FRAMES` 3→10(2초).
- 검증: `vision/tests/test_delivery.py` 6건 신규(발밑 상자 1회 감지·점수 0.73, 아무것도 안 둠, 조명 변화, 먼 구석 물체, 다시 돌아옴, frame 없음) — vision 테스트 12개 통과. 프레임당 추가 처리 0.11ms(PC).
- **Pi에서 확인 필요**: 카메라 자동 노출이 사람 등장/퇴장 때 화면 밝기를 크게 바꾸면 조명 변화로 오인해 놓칠 수 있음, 그림자·상자 색이 바닥과 비슷할 때 `DIFF_THRESHOLD`(35) 조정. 택배 기사가 3초 이상 머물면 방문자 이벤트도 함께 발생(융합 단계에서 묶을 예정).

### 실기 테스트 TODO 문서 작성
- 오늘 작업(엣지 폴더 재구성, 서명 URL, 소리 반복 전송 수정, 방문자·택배 감지 재설계)이 코드·단위 테스트까지만 검증돼, Pi/Render/Supabase 실기 확인 항목과 방법, 소리·영상 융합 남은 수정사항을 `SH_README/hometalk_테스트_TODO.md`로 정리(체크리스트 성격이라 진행일지·인수인계와 분리, 인수인계 "알려진 이슈"에 링크).

### 카메라 서비스를 vision 파이프라인으로 통합 (소리·영상 융합 0-6단계)
- 배경: 카메라는 한 프로그램만 열 수 있음(libcamera). `homecare-camera.service`(= `camera_monitor.py`, `rpicam-hello` 인식 확인 + `rpicam-still` 현재 화면 촬영)와 `vision/vision_pipeline.py`(picamera2로 상시 촬영)가 동시에 돌 수 없음 → 사용자 요청으로 하나로 통합.
- 수정(기존 코드 재사용):
  - `edge/apps/camera_monitor.py`: 캡처 처리 함수 3개에 `capture_fn` 선택 인자만 추가(기본값 = 기존 rpicam-still, 동작 불변).
  - `vision/camera_service.py` 신규: `LatestFrame`(메인 루프가 매 프레임 보관) + 하트비트(최근 10초 안에 프레임이 있을 때만) + 캡처 요청 대기(최신 프레임을 JPEG로 업로드, camera_monitor의 롱폴링·업로드 함수 재사용).
  - `vision/vision_pipeline.py`: 카메라 서비스 시작·정리, 매 프레임 `latest_frame.set()`, 이벤트를 **카메라 기기 id + `edge/data/vision/` 큐**로 전송(기존엔 마이크 id·마이크 큐), logging 설정, 설정 오류 시 종료 코드 2.
  - `edge/systemd/homecare-camera.service`: `ExecStart` → `python -m vision.vision_pipeline` (서비스 이름·켜고 끄는 명령은 그대로).
- 달라지는 점: "현재 화면 보기" 사진 1280×720 → 640×480(vision 해상도), 대신 카메라를 다시 열지 않아 즉시 응답. `capture_photo`/`camera_monitor --list-cameras`는 서비스를 끈 상태에서만 동작.
- 검증: `vision/tests/test_camera_service.py` 5건 신규(프레임 없음/오래됨 → 꺼짐, JPEG 인코딩, 캡처 요청에 최신 프레임 업로드·rpicam-still 미사용, 카메라 기기 id로 시작) → vision 17개·엣지 25개 통과. 가짜 카메라/YOLO로 `main()` 연결 스모크 테스트(카메라 기기 id·vision 큐·최신 프레임 JPEG 확인).
- **Pi 반영 시 주의**: README의 sparse-checkout이 `edge yamnet/core`만 받게 되어 있어 Pi에 `vision/`이 없을 수 있음 → `git sparse-checkout add vision`. unit 파일 재복사 필요. vision 의존성 설치 여부 **확인 필요**. 확인 순서는 `hometalk_테스트_TODO.md` 3-1b.

### Pi vision 의존성 확인 (사용자가 Pi에서 확인 명령 실행)
- 결과: sparse-checkout에 `vision` 포함·폴더 있음, `edge/.env`에 `HOMECARE_CAMERA_DEVICE_ID` 있음. venv = Python 3.13.5, numpy 2.5.3, `include-system-site-packages = false`. venv에 `cv2`·`torch`·`ultralytics`·`picamera2` **없음**, picamera2는 apt `python3-picamera2`로 시스템에만 설치. `/mnt/ssd` **없음**. H.264는 cv2가 없어 확인 불가.
- 영향: 카메라 서비스(= vision)가 `import cv2`에서 바로 종료 → systemd가 10초마다 재시작 반복 가능. 설치 전까지 `homecare-camera.service`는 꺼 둘 것.
- 추가 발견: `vision_pipeline.py`가 `HOMECARE_EVENT_DIR`·`HOMECARE_CAMERA_ID`·`HOMECARE_CAMERA_CHECK_INTERVAL_SEC`를 모듈 로드 시점에 읽는데 `edge/.env`는 `main()`의 `load_config()`에서 로드됨 → `.env`에 적어도 무시되고 기본값 `/mnt/ssd/events` 사용 → 첫 이벤트 저장에서 폴더 생성 실패로 종료. 수정안: `load_config()` 이후에 읽기(A안, 추천) / systemd `Environment=`(B안). **미착수 — 사용자 결정 대기**.
- 설치 안내(미실행): ① `.venv/pyvenv.cfg` `include-system-site-packages = true` ② `pip install ultralytics` ③ numpy/tensorflow 버전 전후 비교 + `cv2 torch ultralytics picamera2 tensorflow sounddevice` import + H.264 + 엣지 25·vision 17 테스트. 위험(**확인 필요**): ultralytics 설치가 numpy를 바꿔 마이크(TensorFlow)에 영향, apt picamera2와 venv numpy 2.5.3 충돌.

### vision 설정값(.env) 반영 수정 — A안
- 문제: `vision/vision_pipeline.py`가 `HOMECARE_EVENT_DIR`·`HOMECARE_CAMERA_ID`·`HOMECARE_CAMERA_CHECK_INTERVAL_SEC`를 모듈 로드 시점에 읽음 → `edge/.env`(= `main()`의 `load_config()`에서 로드)에 적어도 무시되고 기본값 `/mnt/ssd/events` 사용 → Pi엔 `/mnt/ssd`가 없어 첫 이벤트 저장에서 종료될 상황.
- 수정: 세 값을 `read_settings()`로 옮겨 `load_config()` 이후 호출. 기본값 유지. 상대 경로는 실행 위치와 무관하게 저장소 루트 기준으로 해석(서비스 `WorkingDirectory`와 직접 실행 모두 같은 곳). `edge/.env.example`·DEPLOYMENT·인수인계·테스트 TODO에 `HOMECARE_EVENT_DIR=edge/data/events` 안내.
- 검증: `vision/tests/test_pipeline_settings.py` 3건 신규(임시 .env 값 반영·상대 경로 루트 기준, 절대 경로 유지, 미설정 시 기본값) → vision 20·엣지 25 통과, 가짜 카메라 스모크 테스트 정상.
- Pi 적용: `edge/.env`에 `HOMECARE_EVENT_DIR=edge/data/events` 한 줄 추가(값은 Pi에서 직접).

### Pi vision 의존성 설치·단위 테스트 (사용자 실행)
- 설치: `.venv/pyvenv.cfg` `include-system-site-packages = true` + `pip install ultralytics` → cv2·torch·ultralytics·picamera2·tensorflow·sounddevice import OK. numpy 2.5.3·tensorflow 2.21.0 설치 전후 동일(마이크 영향 없음). 버전: ultralytics 8.4.164, torch 2.14.0, torchvision 0.29.0, opencv-python 5.0.0.93(apt `opencv` 4.10.0도 시스템에 있음 — venv의 pip 쪽이 먼저 import됨) → `vision/requirements.txt` 신규 작성.
- Pi 반영: `git pull`, unit 파일 재복사(카메라 `vision.vision_pipeline`), `edge/.env`에 `HOMECARE_EVENT_DIR=edge/data/events`. 단위 테스트 엣지 25·vision 20 OK.
- ~~H.264 가능 여부 확인 필요~~ → **불가**: OpenCV가 `h264_v4l2m2m`(하드웨어 인코더)만 시도하다 실패 — Pi 5엔 H.264 하드웨어 인코더가 없음. 지금 코드는 `mp4v`로 저장 → 웹 브라우저 재생 불가. 소프트웨어 H.264(libx264) 변환 필요(0-5), Pi의 ffmpeg/PyAV libx264 지원 여부 **확인 필요**.

### vision 이벤트 영상 H.264 변환 (0-5 일부)
- 확인(사용자, Pi): ffmpeg `libx264` 인코더 있음, PyAV 14.2.0 `libx264` 있음.
- 대안: 저장 후 ffmpeg로 변환(기존 OpenCV 저장 코드 유지, 새 파이썬 의존성 없음) / PyAV로 처음부터 H.264 저장(저장 코드 교체) → **ffmpeg 변환 선택**.
- 수정: `vision/event_recorder.py` — `avc1` 열기에 실패해 `mp4v`로 저장한 경우에만 `ffmpeg -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart`로 변환 후 교체. ffmpeg 없음/시간 초과/실패 시 경고만 찍고 원본 mp4v 유지(이벤트 전송은 계속). `vision/requirements.txt`에 ffmpeg(apt) 안내.
- 검증: `vision/tests/test_event_recorder.py` 4건 신규(mp4v→H.264 교체, avc1 성공 시 변환 안 함, ffmpeg 없음 → 원본 유지, 변환 실패 → 원본 유지·임시 파일 정리) — PC엔 ffmpeg가 없어 가짜 ffmpeg로 검증. vision 24·엣지 25 통과. **Pi 실제 변환·브라우저 재생 확인 필요**.
- 참고: Pi에선 매 이벤트 저장 때 OpenCV가 `h264_v4l2m2m` 관련 ERROR 로그를 찍음(avc1 시도 실패 메시지) — 동작엔 영향 없음.

### vision 이벤트 영상 — 전송 성공 시 Pi 원본 삭제 (0-5 일부)
- 요청: Pi 원본(영상·썸네일)은 전송 성공하면 삭제. 기존엔 전송 대기 복사본만 지우고 원본(`HOMECARE_EVENT_DIR` 아래)은 계속 쌓였음.
- 대안: emit 직후 원본 삭제(`capture_photo` 방식 — 최종 실패 시 영상이 사라짐) / **큐에 원본 경로를 함께 기록해 전송 성공 때 삭제(선택 — 실패분은 Pi에 남음, 재부팅에도 유지)**.
- 수정: `edge/transport/outbox.py` `enqueue(..., delete_originals_on_sent=False)` — True면 첨부 항목에 `original` 경로 기록, `mark_sent`에서 원본까지 삭제, `mark_dead`는 큐 복사본만 삭제. `emit.py`에 같은 인자 전달. `vision_pipeline.py`만 True로 호출(마이크·capture_photo 등 기존 동작 불변). 원본 경로는 큐 DB에만 있고 백엔드로 보내지 않음.
- 검증: 엣지 테스트 3건 신규(성공 시 원본 삭제·재시작 후에도, 실패 시 원본 유지, 기본값은 원본 유지) — 수정 전 실패 확인 후 통과, 엣지 28·vision 24. 실제 녹화→큐→가짜 전송 스크립트로 201이면 원본 삭제·400이면 유지 확인.
- ~~참고: 쿨다운 등으로 큐에 안 들어간 이벤트의 원본은 전송되지 않으므로 그대로 남음.~~ → 2026-09-29 emit 직후 원본 삭제로 변경(해결됨)

## 2026-09-29

### 낙상 이벤트 영상이 Supabase Storage에 없음 — 원인: `events` 버킷 없음
- 증상(사용자): Pi vision 낙상 이벤트를 보냈는데 Storage에 영상이 안 보임.
- 확인: 영상 전송 코드는 이미 끝까지 연결돼 있음(`vision_pipeline` → `video_path` → outbox `video/mp4` → multipart `video` → `events/video/`). Render 로그(01:30:44 UTC, 카메라 `2a418d81…`): `[Storage] Supabase upload error: Bucket not found`가 썸네일·영상 모두에서 발생 → 이벤트는 사진·영상 없이 201 저장(`29d2c6f6…`), Pi는 성공으로 보고 원본 삭제(해당 영상 복구 불가).
- 인수인계의 "`events` 버킷 private(2026-09-28 사용자 확인)"과 불일치 — Render `SUPABASE_URL`과 다른 프로젝트에 만들었거나 이름 불일치 추정. **조치 필요(사용자)**: 같은 프로젝트에 `events`(private) 버킷 생성 후 낙상 재현 → Render 로그 `[Event] 영상 업로드 완료` 확인.
- 남은 문제: Storage 실패에도 백엔드가 201을 줘서 파일이 유실됨. 대안(첨부 업로드 실패 시 503 → Pi 재시도 / 201 유지 + 별도 재업로드) — **사용자 결정 대기**.

### vision 이벤트 영상 — Pi에 원본을 남기지 않음
- 요청(사용자): 전송 안 된 영상이 Pi에 그대로 저장되는데 Pi에 저장하지 않게.
- 원인: 원본(`HOMECARE_EVENT_DIR`)이 남는 경우 3가지 — 쿨다운으로 큐에 안 들어감(방문자 5분 쿨다운), 최종 실패(dead, 09-28에 일부러 남김), 재시도 중(원본+큐 복사본 두 벌).
- 수정: `vision/vision_pipeline.py`에 `emit_saved_event()` 추가 — emit(큐 폴더로 복사) 직후 결과와 상관없이 원본 영상·썸네일 삭제. `delete_originals_on_sent`는 vision에서 더 이상 사용 안 함(outbox 기능 자체는 유지). 재시도용 큐 복사본(`edge/data/vision/attachments/`)만 남고 전송 성공·dead 때 기존대로 삭제. 대신 최종 실패한 영상은 Pi에서도 사라짐.
- 검증: `vision/tests/test_pipeline_emit.py` 2건 신규(큐 저장 후 원본 삭제·큐 복사본 유지, 쿨다운으로 큐에 안 들어가도 원본 삭제) → vision 26·엣지 31 통과. **Pi 반영 전**: `git pull` 후 `sudo systemctl restart homecare-camera.service`, 기존에 쌓인 파일은 `rm -rf ~/homecare/edge/data/events/*`로 직접 정리.

### Pi VS Code Remote-SSH 접속 실패 — 원인: Pi 회선 속도
- 증상: Remote-SSH가 "Downloading VS Code Server"에서 멈춤. Tailscale(`aiarmi`, `100.115.219.47`) online, 22번 포트·비밀번호 로그인 정상 → Pi의 `wget` 다운로드 단계에서 2분 30초 뒤 `Got bad result from install script`.
- 원인: PC↔Pi 전송 속도 10~40KB/s. Tailscale 경로 `118.235.x.x`(LG U+ 모바일 대역 추정) → Pi가 핫스팟/LTE로 인터넷 연결된 것으로 추정(**확인 필요**).
- 조치: PC VS Code 설정 `"remote.SSH.localServerDownload": "always"`(PC가 받아 scp) + Pi `~/.vscode-server` 삭제 후 재접속 → 접속됨. 근본 해결은 Pi를 Wi-Fi/유선 LAN으로 연결.
- 부수 확인: Tailscale 재설정됨(인수인계의 "확인 필요" 항목), Pi SSH 공개키 미등록(초기화로 삭제) → 비밀번호 입력 필요. YAMNet 캐시가 `/tmp/tfhub_modules`라 재부팅마다 재다운로드됨(느린 회선에서 감지 시작 지연).

### 카메라 서비스 시작 즉시 종료 — 원인: Pi에만 있던 미push 커밋
- 증상: `homecare-camera.service`가 `TypeError: FallDetector.__init__() got an unexpected keyword argument 'aspect_ratio_threshold'`로 재시작 반복. Pi `git pull`도 "divergent branches"로 실패.
- 원인: 팀원(`thooni01`)이 Pi에서 직접 만든 커밋 `0550005`(push 안 됨)가 `FallDetector` 인자를 `previous_aspect_threshold`/`fall_aspect_threshold`로 바꿨는데 `vision_pipeline.py` 호출부는 옛 인자 그대로. 추가로 `required_frames=3`인데 후보 조건이 "직전 프레임 세로형"이라 2번째 프레임부터 후보가 될 수 없어 **낙상이 절대 감지되지 않는** 로직 버그도 있었음.
- 조치: Pi에서 `git format-patch`로 받은 패치를 작성자 유지한 채 PC에 적용(`e830fa6`, Pi 결과와 파일 해시 일치 확인) → 별도 커밋 `61f96b3`로 2단계 판정(급하강으로 의심 시작 → 가로형 유지 프레임 카운트, 일어나면 취소) + 호출부 인자 수정. 같은 패치에 오디오 `door_visitor` 0.5→0.7, `door_security` 0.3→0.6 임계값 상향 포함.
- 검증: `vision/tests/test_fall_detector.py` 5건 신규(팀원 원본 로직은 "정상 낙상" 케이스 실패 확인) → vision 31·엣지 31 통과, 파이프라인 상수로 `FallDetector` 생성 확인. **Pi 반영 전**: GitHub push 후 Pi에서 `git branch pi-thooni-0929 0550005 && git reset --hard origin/main` → 마이크·카메라 서비스 재시작.
- 운영 메모: Pi에서 커밋/push하지 않기(GitHub 비밀번호 push 불가, 공용 기기에 토큰 저장 위험) — PC에서 push → Pi는 pull만.

## 2026-10-05

### CLAUDE.md 정리 (72줄 → 64줄) — 문서만 수정, 코드 변경 없음
- 한 일: CLAUDE.md를 7개 섹션(프로젝트 개요 / 현재 단계 / 명령어 / 구조 / 규칙 / 작업 방식 / 문서 운영)으로 재구성. `hometalk_인수인계.md`·`DEPLOYMENT.md`의 낡은 기록도 정정.
- 점검에서 발견한 어긋남: CLAUDE.md가 "엣지 YOLO 연동 아직 없음"이라 했으나 `vision/`(YOLO 방문자·택배·낙상)이 2026-09-28 통합돼 가동 구조였음 / `vision/`·`npm run kill`·`npm run mcp`·vision 테스트 명령 누락 / 세션 시작 문서 목록에 `hometalk_테스트_TODO.md` 누락 / 인수인계 L25·L207도 같은 "YOLO 미구현" 낡은 기록 / DEPLOYMENT §3이 기기 행을 옛 이름 `raspberry-pi-5`로 적고 Tailscale을 "확인 필요"로 둠(인수인계는 이미 정정됨).
- 결정과 이유:
  - 코드 위치 12줄 상세 목록 → 구조 요약 1줄씩으로 압축: 코드를 읽으면 알 수 있는 내용은 CLAUDE.md에 두지 않는다는 방침.
  - 테스트 수치·실패 사유를 CLAUDE.md에서 빼고 인수인계로 일원화: 수치가 자주 바뀌어 CLAUDE.md에 두면 곧 낡음.
  - `frontend/`는 "레거시 프로토타입, 수정 불필요"로 확정(사용자 결정): 빌드는 안 되지만 `app.js`가 정적 서빙·SPA 폴백으로 사용하고 Dockerfile `COPY . .`로 이미지에 포함되므로 "안 쓰임"은 아님.
  - "경로는 수정하지 않는다"의 경로 = **파일 경로(파일·폴더 이동·이름 변경)**로 확정(사용자 결정). 라우트 경로는 Code Style의 "공개 인터페이스 유지"가 이미 다룸.
  - `process.env` 직접 읽기 금지 규칙에 예외 2곳(`src/index.js` `PORT`, `response.utils.js` `NODE_ENV`)을 명시(사용자 결정, 코드는 그대로): 실제 코드와 규칙이 어긋나 있었기 때문.
  - `temp_` ID 201 사건은 이미 수정된 일회성 사고라 상세는 이 일지에만 남기고(2026-09-20 기록 참고), CLAUDE.md엔 "응답 `id`가 UUID인지 확인"이라는 교훈만 남김.
  - 진행일지의 "해결 항목 취소선" 규칙은 유지(사용자 결정). 새 문서 운영 규칙 "기존 기록은 수정하지 않는다"와 충돌하므로, CLAUDE.md 작업 방식에 "해결 표시는 취소선으로만, 새 일은 새 날짜 항목"을 명시해 둘을 양립시킴.
- 테스트 재검증(이 PC): 처음엔 Jest 6개 스위트·엣지 2개 모듈·vision 5건이 에러 — 코드 문제가 아니라 의존성 미설치(`web-push`는 `npm install`, `numpy`/`scipy`/`opencv-python-headless`는 pip) 때문. 설치 후 **Jest 75 통과/5 실패(총 80, 실패 5건은 기존 `chat.test.js` 401·`app.test.js` 404와 같은 종류), 엣지 46 통과, vision 42 통과.**
- 배운 점: 테스트가 "실패"해도 먼저 의존성 로드 에러인지 구분할 것(스위트가 "failed to run"이면 코드가 아니라 환경 문제). 문서에 적힌 테스트 수치(52/5, 24개 등)는 시간이 지나면 어긋나므로 CLAUDE.md에 고정하지 말 것.
- ~~**확인 필요**: DEPLOYMENT §3의 Pi 저장소가 `edge`, `yamnet/core`만 sparse-checkout라고 되어 있는데 `vision/`이 Pi에서 돌려면 포함돼 있어야 함 — Pi에서 확인하지 못해 문구는 그대로 둠.~~ → **(해결됨, 2026-10-05)** 사용자가 Pi sparse-checkout에 `vision/`이 포함돼 있다고 확인, DEPLOYMENT §3·인수인계 "접근 / 계정" 문구에 `vision` 추가. 이 PC에서 vision 테스트는 `ultralytics` 없이(opencv·numpy만) 통과했으므로 YOLO 모델 추론 자체는 검증하지 않음.

### 앱 TODO 9개 중 단계 1 (앱·백엔드 단독 6건)
- 한 일(전체 계획은 3단계로 나눔: 1 앱 단독 → 2 이벤트 구분·영상 동봉(엣지) → 3 거실/현관 모드·경비 모드):
  - 홈 위험 알림 기준: `getDailySummary`의 `dangerEvents`를 `danger_level in (danger, warning)` → `type === 'danger'`로. 홈 카드에 "낙상·화재경보·파손 기준" 문구 추가.
  - 채팅방 이름 변경: `PATCH /api/chat/history/:conversationId`(`conversation.service.js` `renameConversation` — 소유자 확인, 공백 정리, 40자 제한), 서랍에 ✏️ 인라인 편집.
  - 새로고침: `usePullToRefresh`(맨 위에서 아래로 당기기, 채팅 탭·모달·영상 위 터치는 제외) + 홈 헤더 ↻ 버튼. 홈 데이터는 세션 1회 로드였어서 `AppDataContext`에 `refreshAll`/`loadHome(force)` 추가.
  - 홈/설정 헤더 높이: 두 헤더를 같은 `min-h-[112px]` + 세로 중앙 정렬로 통일(기존엔 `pt-7`/`pt-6`에 내용 높이가 달라 높이가 달랐음).
  - 영상만 보기: 영상(`video_url`)이 있으면 소리 플레이어·🔊 뱃지를 숨김. 영상에 소리가 이미 들어 있기 때문. 영상 없는 옛 이벤트만 소리 재생.
  - 토큰 절감: `HISTORY_LIMIT` 50→20, `MAX_TOOL_LOOPS` 5→3, `get_danger_events` 결과 30건 상한, 시스템 프롬프트를 [고정 본문(`cache_control`) + 현재 시각] 두 블록으로 분리, API 호출마다 `usage` 로그.
- 결정과 이유:
  - 위험 알림은 `type=danger`만(사용자 결정): 비명·울음(sound/warning)이 섞여 "위험"이 과대 집계된다는 판단. 푸시 알림 발송 기준(`notifyEvent`)은 type 기준이라 그대로.
  - Claude 유지 + 절감(사용자 결정): 무료 AI로 교체하면 도구 호출 루프(`tool_use`)를 다시 짜야 하고 새 의존성·품질 리스크가 큼.
  - 현재 시각을 캐시 지점 뒤에 둠: 시각이 본문 안에 있으면 매 요청마다 앞부분이 달라져 캐시가 절대 적중하지 않음.
- 테스트: Jest **79 통과 / 5 실패**(실패 5건은 기존과 동일, 신규 실패 0). 새 테스트 4건(제목 변경 3건, 일일요약 위험 기준 1건) 추가, 기존 2건은 바뀐 동작(히스토리 20개, system 배열)에 맞게 수정. 웹 `npm run build` 통과. `web` lint(oxlint)는 이 PC에 네이티브 바인딩이 없어 실행 못 함(코드 문제 아님).
- 미확인: 프롬프트 캐싱 실제 적중 여부(Haiku 최소 캐시 길이), 모바일 실기기에서의 당겨서 새로고침 동작·헤더 높이 육안 확인.

## 2026-10-09

### 거실/현관 감지 모드 + 경비 모드 (앱 TODO 단계 3) — 백엔드·엣지·웹 구현
- 요구(사용자): Pi 1대라 거실/현관을 같은 Pi의 **감지 모드 전환**으로 구현. 거실 = 비명·고함·반려동물 울음·아기 울음·화재경보·낙상, 현관 = 초인종·노크·문 열고 닫힘·택배(·방문자). 화재경보·유리 깨짐은 모드와 무관하게 항상. 경비+거실 = 방 안 사람 감지 시 위급 알림, 경비+현관 = 문이 5분 넘게 안 닫히면(영상 판단) 위급 알림. 홈 카메라 카드 1개 안에 거실/현관/경비 버튼.
- 대안과 결정:
  - 경비 상태 저장 위치: 계획 문서(TODO §6)는 `notification_preferences.security_armed`였으나, 엣지가 하트비트로 읽어야 해서 **`devices.security_armed`**로 결정(`devices.mode`와 함께). 푸시 판단(`notifyEvent`)도 `event.device_id`로 이미 devices를 조회한다.
  - 엣지 전달: 별도 폴링을 새로 만들지 않고 **하트비트 응답에 `{mode, securityArmed}`를 실음**(최대 20초 지연). 컬럼이 없거나 조회가 실패해도 하트비트를 막지 않도록 `getDeviceMode`가 기본값(거실·경비 꺼짐)을 돌려줌.
  - 필터: `edge/transport/modes.py` 하나를 마이크·카메라가 공유. 마이크는 `_handle_triggers`에서 녹음·영상 요청 전에 거르고, 카메라는 감지기를 계속 돌린 채 이벤트로 만들기 직전에 거름(감지기 상태 유지).
  - 모드 변경 API는 사용자의 **카메라+마이크 행을 함께 갱신**(두 프로세스가 별도 기기 행이라서).
- 백엔드: `device.service.js`(`getDeviceMode`·`setUserMode`), `device.controller.js`(하트비트 응답에 모드, `setMode`, `getSecurityMode`), `device.routes.js`(`PUT /api/devices/mode`, `GET /api/devices/:id/security-mode`), `notification.service.js`(`SECURITY_CATEGORIES` 이벤트는 경비 ON일 때만 토글 무관 "🚨 침입 의심" 푸시), `database/schema.sql`(ALTER 2줄).
- 엣지: `edge/transport/modes.py` 신규, `heartbeat.py`(응답 JSON을 `on_response` 콜백으로, 파싱 실패해도 하트비트는 성공 처리), `stream_pipeline.py`(마이크 필터), `event_mapper.py`(`intrusion_suspect` 추가). vision은 사용자 요청으로 **기존 줄을 건드리지 않고 줄 추가만**: `camera_service.py` +2줄, `vision_pipeline.py` +10줄.
- 웹: `HomeScreen.jsx` 카메라 카드를 윗부분(현재 화면 촬영 버튼)과 아랫부분([거실][현관] 선택 + 🛡️ 경비 토글)으로 나눔(버튼 안에 버튼 불가). 낙관적 반영 후 저장 실패 시 되돌림. `AppDataContext.setDeviceMode`, `api.devices.setMode`.
- 팀원 vision 변경 병합: 팀원이 같은 시기에 `vision/intrusion_detector.py`(경비 모드: `GuardModeClient`가 3초마다 `GET /api/devices/:id/security-mode` 호출 → `data.armed_mode`, 이벤트 `intrusion_suspect`)와 `FallDetector` 재작성을 push함(`569a6d3`). 우리 이름(`intruder_suspect`, 하트비트 `securityArmed`)과 어긋나 **백엔드를 팀원 쪽에 맞춤**: `security-mode` API 추가, 카테고리 이름 `intrusion_suspect`. `git pull` 시 `vision_pipeline.py` 한 곳(`camera_service.start` 호출부)이 충돌 → stash 후 pull, 팀원 코드 유지하고 `mode_state` 인자만 합쳐 해결.
- 아기 울음: 처음엔 어느 모드에도 없어 꺼졌으나 사용자 결정으로 거실 모드에 포함.
- 검증: 신규 테스트 — Jest `tests/device-mode.test.js` 11건(하트비트 응답 모드, `PUT /mode` 인증·검증·404, `security-mode` 응답·403, 경비 ON/OFF 푸시), 엣지 `test_modes.py` 15건(모드별 허용, ModeState, 하트비트 응답 파싱·오류 내성, 마이크 필터, 이벤트 스펙), vision `test_mode_wiring.py` 2건. 결과: Jest **90 통과/5 실패**(기존 5건 그대로), 엣지 **61 통과**, vision 44개 중 **6건 에러**, 웹 `npm run build` 통과·lint 에러 0.
- ~~vision 에러 6건~~은 이번 변경이 아니라 팀원의 시그니처 변경(`FallDetector.__init__`의 `vertical_threshold` 제거 5건, `detected_vision_event`에 `intrusion_detected` 인자 추가 1건)으로 옛 테스트가 깨진 것 — 팀원 수리 대기.
- 운영 DB: 사용자가 Supabase SQL Editor에서 `devices.mode`·`devices.security_armed` ALTER 실행 완료.
- 미완료/확인 필요:
  - push → Render·Vercel 배포, Pi `git pull` + `homecare-mic`/`homecare-camera` 서비스 재시작 후 실기 확인(`hometalk_테스트_TODO.md` §6 단계 3). 재시작 전 Pi는 모드와 무관하게 전부 감지.
  - ~~팀원 `GuardModeClient.start()`·`IntrusionDetector`가 파이프라인에 아직 연결 안 됨~~ → 2026-10-09 로컬 코드 연결 및 병합으로 해결됨. 경비 ON + 거실 모드에서만 활성화하며 실행 검증 필요.
  - `door_left_open`(문 5분 열림, 영상 판단)은 영상팀 담당·미구현.
  - 카메라 카드가 커져 같은 줄의 마이크 카드가 늘어남 — 모바일 폭 육안 확인 필요.

### 소리 이벤트에 영상 함께 전송 — 녹화 중 요청 거절 → 진행 중인 영상 공유 (앱 TODO 단계 2)
- 증상(사용자): 소리 이벤트가 소리(wav)만 전송되는 경우가 있음. 영상이 있으면 영상 하나만 재생해 영상 속 소리가 들리게.
- 확인: 마이크→영상 요청→vision 녹화(소리 합성)→wav와 함께 전송하는 경로는 이미 구현돼 있음(`stream_pipeline.py` `_request_video`, `vision_pipeline.py` `handle_sound_requests`). 영상 없이 가는 원인 후보: ① 카메라 서비스 꺼짐(`vision_alive`) ② 요청이 3초 넘게 늦음(`SOUND_REQUEST_MAX_AGE_SEC`) ③ **녹화기가 이미 다른 이벤트를 녹화 중이면 요청을 거절(`busy`)** → 소리만 전송. Pi 로그에서 어느 쪽인지는 아직 미확인(`[SOUND REQUEST REJECTED] … (busy|too old)`, `영상 못 받음`).
- 대안: 요청 유효시간 완화(원인 ②만 해결) / 녹화 끝난 뒤 다시 시작(소리 순간을 놓침) / **녹화 중이면 그 녹화 영상을 같이 쓰기(선택 — 마이크도 vision도 구조 변경 없이 ③ 해결)**.
- 수정: `vision/sound_clip_share.py` 신규(`WaitingSoundRequests` — 기다리는 요청 id 기억, 녹화가 끝나면 요청마다 영상 **복사본**을 넘김. 마이크가 받은 영상을 전송 후 지우기 때문). `vision/vision_pipeline.py`는 줄 추가만: import, `handle_sound_requests(..., waiting=None)`에서 busy이면서 늦지 않은 요청은 거절 대신 대기, `recorder.update()` 직후 대기 요청에 영상 전달(원본이 넘어가기 전). `waiting`을 안 주면 예전처럼 거절(기존 동작 호환), too old는 그대로 거절.
- 재생: 별도 수정 없음. 영상(`video_url`)이 있으면 소리 플레이어를 숨기고 영상만 재생(2026-10-05, 이벤트 목록·상세 모달·채팅 카드) — 영상에 마이크 소리가 합성돼 있어 같이 들림.
- 검증: `vision/tests/test_sound_clip_share.py` 6건 신규(대기·복사본 전달·요청별 별도 복사본·too old 거절 유지·기본 호환·복사 실패 시 영상 없음 응답) 통과. vision 50개 중 6건 에러는 팀원 `FallDetector`/`detected_vision_event` 시그니처 변경으로 인한 기존 에러(이번 변경과 무관).
- 미확인: Pi 실기(낙상 녹화 중 비명 → 한 이벤트로 영상+소리 전송 / 연달아 두 소리 이벤트), 원인 ①②는 로그 확인 후 필요하면 별도 대응(① 카메라 서비스를 켜 둬야 영상이 붙음).

### 홈 화면 UI 개편 — 거실/현관 공간 카드 + 경비 스위치 (웹만, API·DB 변경 없음)
- 요청(사용자): 카메라·마이크 카드가 따로 있던 것을 거실 카드·현관 카드 안에 각각 카메라·마이크를 넣고, 카드를 고르면 거실/현관 모드, 경비는 켜짐/꺼짐 가능하게. 시안을 먼저 확인받고(낙상 감지 중 같은 보조 문구는 제거) 적용.
- 수정: `web/src/screens/HomeScreen.jsx`만. 기존 카메라·마이크 카드와 카메라 카드 안의 [거실][현관]·경비 버튼을 없애고 ① "현재 모드" 표시줄 ② 거실/현관 카드(라디오, 키보드 조작 가능) ③ 경비 스위치 ④ 오늘 이벤트·위험 알림 두 칸으로 교체. `changeMode`, `setDeviceMode`, `api.devices.setMode`는 그대로 재사용.
- 결정: 기기가 Pi 1세트라 카메라·마이크 상태를 공간별로 따로 알 수 없음 → 선택된 공간에만 실제 상태(켜짐/꺼짐/미등록)를 보이고 선택 안 된 공간은 "대기"로 표시. 경비는 공간별이 아니라 전체 하나(서버 `devices.security_armed`가 하나). "현재 화면 보기"는 시안에서 빠졌지만 기능이 사라지지 않게 선택된 카드의 카메라 칸에 작은 링크로 유지.
- 검증: `npm run build` 성공, `npm run lint` 새 경고 없음(기존 Context 파일 경고 4건). 브라우저/모바일 폭 육안 확인과 실제 모드 전환·경비 저장은 **확인 필요**.
- 추가 수정(같은 날): 사용자가 시안 모양이 더 낫다고 해서 로컬 화면을 시안에 맞춤. 헤더를 둥근 카드(그라데이션)로, 공간 카드에 "모니터링 중" 뱃지·체크 원, 마이크 소리 막대(고정 모양 장식, 실제 음량 아님), 요약 카드는 아이콘 없이 숫자 중심. 마이크 켜짐은 "수신 중"으로 표기. 이모티콘은 `web/src/components/Icon.jsx`(SVG 모음)로 교체 — 아이콘을 바꾸려면 이 파일의 `PATHS`만 고치면 됨. 홈 화면(`HomeScreen.jsx`)의 이모티콘은 모두 제거. 이벤트 목록 아이콘(`web/src/lib/eventDisplay.js` `EVENT_ICON`)과 다른 화면의 이모티콘은 아직 그대로(다음 단계 후보).

### vision 점검에서 발견한 네 가지 수정
- ~~녹화 중 후속 침입·낙상이 저장되지 않거나 소리 녹화의 첫 보류 이벤트에 가려짐~~ → 코드 수정됨. `vision_pipeline.py`에서 종류별 보류 목록을 유지하고 저장 완료 시 원본 삭제/마이크 전달 전에 각각 전송한다. 같은 종류는 클립당 첫 감지만 유지해 메모리를 제한하며 기존 전송 쿨다운은 유지한다. 동시 감지도 우선순위 순으로 모두 처리한다.
- ~~원래 높이로 돌아온 뒤에도 낙상 후보가 남아 오탐~~ → 코드 수정됨. `fall_detector.py`가 후보 시작 전 중심 높이를 보관하고, 하강량이 임계값 이하로 회복되면 후보와 이력을 초기화한다.
- ~~거실에서 소모한 방문자 상태 때문에 현관 전환 후 감지 누락~~ → 코드 수정됨. 프레임별 모드를 고정하고 전환 시 낙상·방문자·택배 감지기를 초기화한다. 택배 배경도 새 장면에서 다시 수집한다.
- ~~`history_frames`와 무관하게 4프레임으로 고정 검사~~ → 코드 수정됨. 설정한 이력 길이를 사용하고 이전 프레임 비교에 필요한 최소 2프레임을 검증한다.
- 테스트: 기존 미커밋 침입 연결 테스트를 유지·보강하고 정상 자세 복귀, 이력 길이 2/3/6, 후보 초기화, 일반/소리 녹화 중 후속 위험 감지, 거실→현관 전환을 검증하는 회귀 테스트 추가. `git diff --check` 통과. Python 테스트는 WindowsApps 실행 별칭 문제로 일반/권한 확장 실행 모두 시작 실패했으며 **통과 여부 확인 필요**. 새 의존성 설치·외부 서비스 접근·배포 없음.
- 결정과 이유: 위험 이벤트를 우선순위로 하나만 남기면 낙상이 침입에 가려질 수 있어 종류별로 보관한다. 녹화기는 하나로 유지하고 같은 클립을 공유하여 범위를 제한한다. Pi 실기 및 사용 가능한 Python 환경에서 전체 vision 테스트 재실행 필요.

### 원격 main과 로컬 vision 수정 병합
- 한 일: 로컬 미커밋 작업(미추적 파일 포함)을 stash로 백업한 뒤, 이미 fetch된 origin/main(d12fff4)으로 fast-forward하고 로컬 작업을 복원했다. 충돌 3곳(인수인계, 진행일지, vision_pipeline.py)을 해결했다.
- 결정과 이유: 원격의 WaitingSoundRequests와 로컬의 종류별 deferred_vision_events를 함께 유지한다. 소리 요청용 영상 복사와 후속 영상 이벤트 첨부 처리가 원본 삭제/전달 전에 이루어지도록 기존 양쪽 순서를 보존했다. 문서도 양쪽 기록을 유지하고 침입 감지 연결 상태를 갱신했다.
- 검증: git diff --check 및 충돌 표식 검사 통과. Python은 일반/권한 확장 실행 모두 시작 실패, npm test -- --runInBand는 Jest 미설치로 시작 실패하여 테스트 통과 여부는 확인 필요.
- 상태: 로컬 변경은 미커밋으로 유지하고 merge-backup-2026-10-09 stash는 복구용으로 남긴다. 외부 접근·push·배포·의존성 설치 없음.
- 추가 수정(같은 날): 채팅·이벤트·설정을 홈과 같은 디자인으로 통일. 요청: 남색 배경 글씨가 잘리지 않게 가로를 키우고, 이벤트·설정 배경 폭·크기를 통일.
  - 남색 헤더를 `web/src/components/ScreenHeader.jsx` 하나로 만들어 홈·채팅·이벤트·설정이 같은 폭(좌우 14px 여백, 본문 카드보다 약간 넓음)·높이(최소 84px)·글자 크기를 쓴다. 제목·부제는 `truncate` 대신 줄바꿈이라 긴 이메일도 안 잘린다. 헤더 안 버튼은 같은 파일의 `HeaderButton`. 채팅 헤더는 흰 줄에서 남색 카드(스크롤 시 위에 고정)로 바뀜.
  - 이모티콘 제거: `Icon.jsx`에 아이콘 약 40개로 확장. 하단 메뉴, 이벤트 필터·카드·삭제 버튼, 설정 항목·섹션·모달, 채팅 헤더·빠른 질문·전송 버튼·AI 아바타, 장치/경고/이벤트 카드, 카메라·이벤트 팝업, 채팅 서랍이 모두 아이콘으로 바뀜. `eventDisplay.js`의 `EVENT_ICON`은 이제 이모티콘 대신 아이콘 이름(`icon`)과 색(`fg`)을 가짐.
  - 카드 모양 통일: 이벤트·설정 카드도 홈과 같은 둥근 모서리(20px)·1.5px 테두리·그림자. 이벤트 카드의 왼쪽 위험도 띠는 없애고 높음은 빨간 테두리, 위험도는 배지로 표시. 설정 토글을 홈 경비 스위치와 같은 모양으로(`role=switch`).
  - 일부러 안 건드린 것: 로그인·비밀번호 재설정 화면의 이모티콘, AI 답변 문장 속 이모티콘(`chatBlocks.js`·`MarkdownText.jsx`가 상태 배지로 해석하는 용도).
  - 검증: `npm run build` 성공, `npm run lint` 새 경고 없음. 모바일 폭 육안 확인은 **확인 필요**(채팅 헤더 sticky 동작, 이벤트 필터 줄 겹침 여부).

### 팀원 점검 3건 반영 — 모드 조회 실패 구분 / 쿨다운 복원 / 첨부 복사본 정리
- 배경: 팀원이 vision 밖에서 고쳐야 할 곳 3건을 공유. 세 건 모두 코드로 재확인함.
- 수정 1 (백엔드): `getDeviceMode()`가 DB 조회 실패 시 기본값(경비 OFF) 대신 `null`을 반환. 하트비트는 `null`이면 `mode`/`securityArmed` 필드를 생략(엣지는 마지막 정상 설정 유지), `GET /security-mode`는 503, 침입 푸시(`notification.service.js`)는 조회 실패 시 경비 ON으로 간주해 발송. 기기 행이 없을 때는 기존 기본값 유지.
- 수정 2 (`edge/transport/emit.py`, `cooldown.py`): `Cooldown.claim()/restore()` 추가. `emit()`이 큐 저장에 실패하면 쿨다운을 claim 이전 상태로 되돌림. 확인+기록을 한 번에 하던 원자성은 유지(검사 후 따로 기록하는 방식은 동시 emit 틈이 생겨 채택 안 함).
- 수정 3 (`edge/transport/outbox.py`): `enqueue()` 실패 시 이번 호출에서 새로 만든 복사본만 삭제(원본·이미 있던 같은 uid 복사본은 보존).
- 결정: 침입 푸시는 조회 실패 시 "발송" — 침입 알림을 놓치는 쪽이 더 위험. 4번(보존 영상 자동 복구)은 이벤트 종류·시각 등을 함께 보존하는 별도 설계가 필요해 이번 범위에서 제외.
- 테스트: Jest 신규 `tests/device-service-mode.test.js` 5건 + `device-mode.test.js` 3건 추가, 해당 2개 파일 통과. 전체 Jest 실패 5건은 `app.test.js`/`chat.test.js`의 기존 실패와 같은 위치. Python은 프로젝트 밖 임시 venv(requests·numpy·scipy·opencv-python-headless만 설치, 사용자 승인)에서 `edge/tests` 66건(신규 5건 포함), `vision/tests` 65건 전부 통과. 처음엔 `requests` 스텁으로 `test_edge.py` 30건만 확인했으나 이후 실제 패키지로 전체 재실행. Pi 실기는 미검증.

### 초인종·노크(소리)와 방문자 감지(영상) 이벤트 분리
- 한 일: `door_visitor`를 소리와 카메라가 같이 쓰던 것을 분리. 소리 = `door_visitor`(라벨 "초인종/노크 소리"), 카메라 = 새 `visitor_detected`("방문자 감지"). `event_mapper.py`에 항목 추가, `modes.py` 현관 모드 목록에 추가, `vision_pipeline.py`·`backup_pipe.py`가 새 ID로 전송, vision 테스트 3개 갱신.
- 결정과 이유: DB `type`은 둘 다 `visitor` 유지. `sound`로 바꾸면 "방문자 알림" 설정과 채팅 방문자 조회(`get_visitor_log`)에서 초인종이 빠진다. 구분은 `metadata.category_id`/description. 백엔드 변경 없음. YAMNet 규칙은 이미 노크(353)를 포함해 그대로 둠.
- 테스트: `edge/tests` 66건, `vision/tests` 80건 통과. Pi 실기 미검증, 카메라 서비스 재시작 필요.
- 남은 일: 웹 이벤트 화면의 아이콘·필터 구분, 기존 DB의 `door_visitor` 중 카메라 유래 이벤트는 정리하지 않음(`source`로만 구분 가능).
