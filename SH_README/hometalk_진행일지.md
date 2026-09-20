# HomeCare 서버 배포/인프라 진행일지

> 최근 수정일시: 2026-09-20 (Pi 초기화 → 백엔드 Render 이전, 엣지 전송 모듈 추가 및 Pi→백엔드 저장 검증)
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
- 엣지 2단계: 마이크 입력 → YAMNet → 판정 규칙 → `emit()` 파이프라인 (Pi의 Python 버전에서 TensorFlow 설치 가능 여부 **확인 필요**, TFLite 대안 검토), 부팅 시 자동 실행(systemd, `.venv/bin/python` 사용), YOLO 연동(미완성)
- 엣지 heartbeat(`POST /api/devices/:id/heartbeat`) 미구현 — `devices.status`가 계속 `offline`
- `npm test` 기존 5건 실패(인증 401로 보임) 원인 미확인
- Pi의 Tailscale 상태(초기화 후 재설치 여부) **확인 필요**
