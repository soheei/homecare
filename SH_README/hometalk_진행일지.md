# HomeCare 서버 배포/인프라 진행일지

> 최근 수정일시: 2026-08-30 (GitHub 접근 환경 구성 + 백엔드 Docker 최초 배포 + 발견한 문제 4건 해결 + Tailscale Funnel로 백엔드 외부 공개 + DEPLOYMENT.md 작성)
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
- `docker-compose.yml`의 `version: '3.8'` 속성이 obsolete 경고 발생 중 — 동작엔 문제없지만 정리하면 좋음
- Node.js 18 deprecated 경고 (`@supabase/supabase-js`가 Node 20+ 요구) — Dockerfile의 base 이미지를 `node:20-alpine`으로 올리는 것 고려
- `docker` 그룹 권한이 현재 쉘 세션에 반영 안 됨 — 재로그인하면 `sg docker` 없이 `docker` 명령 바로 사용 가능
- Tailscale Funnel은 라즈베리파이 재부팅/네트워크 단절 시 꺼질 수 있음 — 부팅 시 자동 재시작되도록 systemd 서비스화하는 것 고려 필요
- Vercel 프론트엔드의 API base URL을 `https://alarmi.tail3c4e8f.ts.net`로 실제 연결했는지 아직 미확인 — 프론트 쪽 `.env`/설정 확인 필요
