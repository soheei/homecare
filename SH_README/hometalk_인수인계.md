# HomeCare 서버 배포/인프라 인수인계 문서

> 작성일시: 2026-08-30
> 최근 수정일시: 2026-09-27 밤 (홈 카메라 카드·채팅 "현재 화면 보여줘" 실시간 캡처 추가 — Pi 롱폴링·메모리 임시 보관, 카메라 사진 촬영 `edge.capture_photo`, 마이크/카메라 systemd 명령 정리 / 이전: 홈 브리핑 서버 저장, Claude Desktop MCP 연결 방법)
> #가장 최근 일시의 md를 우선시 할것.
> 작성자: 양소희
> 프로젝트: HomeCare — 백엔드(Render) / 프론트(Vercel) / 엣지(라즈베리파이) 배포·인프라

> **기록 원칙**: 이 문서는 배포 상태·접근 정보·운영 절차 등 **구조적인 내용 전용**. 날짜별 작업 로그(무엇을 했고
> 무엇을 검증했는지)는 새 문서를 또 만들지 말고 같은 폴더의 `hometalk_진행일지.md`에 계속 이어서 기록할 것.
> 이 문서 자체는 배포 상태가 바뀌거나 인계 항목이 갱신될 때만 수정하고, 수정 시 위 "최근 수정일시"를 갱신한다.
> 더이상 유효하지 않은 내용은 삭제한다.

---

배포 구성과 운영 방법 인수인계 문서입니다. 최신 상세 이력은 [`hometalk_진행일지.md`](./hometalk_진행일지.md), 명령어·URL·환경변수 이름 참조는 [`DEPLOYMENT.md`](./DEPLOYMENT.md)를 참고하세요.

## 현재 배포 상태 (2026-09-20 기준)

| 구성 | 위치 | 비고 |
|---|---|---|
| 프론트엔드 | Vercel — https://homecare-9sr8.vercel.app/ | 로컬: http://localhost:5173/. `VITE_API_URL`이 Render 주소로 설정·재배포됨(번들에서 확인) |
| 백엔드 | Render Web Service (Docker 런타임) — https://homecare-9kcu.onrender.com | GitHub `main` push 시 자동 배포, `/health`로 상태 확인 |
| DB / Storage | Supabase | `events` 테이블에 `video_url` 컬럼 추가됨(2026-09-20) |
| 엣지 | 라즈베리파이 (`edge/` 코드) | `POST /api/events`로 이벤트 전송, 실전송 검증 완료. 마이크(ReSpeaker 2-Mic HAT)→YAMNet 실시간 파이프라인(`edge/stream_pipeline.py`) 실제 가동 중(실제 "문 소리 감지" 등 이벤트 저장 확인됨, 문서상 "미구현"이던 옛 기록은 삭제). 카메라(Camera Module V3)는 하드웨어 감지만 가능, 영상 분석(YOLO 등)은 미구현 |

- 백엔드는 예전에 Pi의 Docker Compose + Tailscale Funnel로 운영했으나, **Pi 초기화(2026-09-20)로 사라졌고 Render로 이전**했다. `docker-compose.yml`은 남아 있지만 현재 배포 경로가 아니다.
- MCP 서버는 백엔드와 같은 Render 서비스의 `/mcp` 엔드포인트(Streamable HTTP)로 동작한다(2026-09-27~). 아래 "MCP 서버" 참고. stdio 버전(`src/mcp/server.js`, `npm run mcp`)은 로컬 외부 클라이언트용으로만 남아 있고 배포하지 않는다.
- Render **무료 플랜은 유휴 시 잠들어** 첫 응답이 20초대로 느려짐(관측 22.7초). 플랜은 아직 미결정.

## 접근 / 계정

- GitHub 계정: `soheei`, 저장소 `soheei/homecare` (`main`이 배포 브랜치)
- Render: 대시보드에서 서비스 로그(Logs), 환경변수(Environment) 관리. 백엔드 환경변수의 유일한 저장 위치 (`.env`는 서버에 올리지 않는다)
- Vercel: 프로젝트 Settings → Environment Variables (`VITE_API_URL` 등, 변경 시 Redeploy 필요)
- Supabase: SQL Editor(스키마 변경), Table Editor(`devices`/`events` 확인)
- 엣지(Pi): 호스트명 `alarmi`, 계정 `alarmi`, 저장소 `~/homecare`(sparse-checkout로 `edge`, `yamnet/core`만), 가상환경 `~/homecare/.venv`, 설정 `edge/.env`(git 제외)
- Pi의 Tailscale(SSH 접속용)은 초기화 이후 재설정 여부 **확인 필요**
- 비밀값(`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EDGE_DEVICE_SECRET` 등)은 이 문서·git·채팅에 적지 않는다. 값이 필요하면 각 서비스 콘솔에서 확인/재발급.

## 백엔드 환경변수 (Render, 이름만)

`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EDGE_DEVICE_SECRET`, `ALLOWED_ORIGINS`(프론트 주소, 끝에 `/` 없이), `LOG_LEVEL=info`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`(2026-09-22 웹 푸시 추가, 아래 "웹 푸시 알림" 참고), `MCP_AUTH_TOKEN`(2026-09-27 추가, 선택 — 아래 "MCP 서버" 참고).

- `PORT`는 넣지 않는다(Render가 주입, 앱이 `process.env.PORT`를 읽음).
- `NODE_ENV`는 `production`이어야 한다(Dockerfile 기본값). **`development`로 덮어쓰면 인증이 우회된다** — 로컬 `.env` 통째 붙여넣기 주의.

## MCP 서버 (2026-09-27 전환)

웹 채팅이 Supabase 데이터를 조회할 때 **실제 MCP 프로토콜을 거친다**. 백엔드 안에 MCP 서버(`/mcp`)를 열고, 채팅은 MCP 클라이언트로 그 서버에 접속한다.

```
웹 채팅 → claude.service.js ─(Claude API: 질문 + tools)→ Claude
               │  ← tool_use 요청
               └→ mcp.service.js (MCP 클라이언트) ─ tools/list, tools/call ─→ POST /mcp (MCP 서버) → Supabase
```

- 주소: `https://homecare-9kcu.onrender.com/mcp` (Streamable HTTP, stateless — 요청마다 서버 인스턴스를 새로 만들어 세션 상태 없음. `POST`만 지원, `GET`/`DELETE`는 405)
- 인증: `Authorization: Bearer <MCP_AUTH_TOKEN>` 필수(없거나 틀리면 401). 도구가 전체 이벤트/기기를 조회하므로 **토큰이 곧 집 데이터 접근 권한** — 채팅/깃/문서에 값을 적지 말 것.
- `MCP_AUTH_TOKEN` 미설정 시: 서버 시작마다 임의 토큰을 생성해 내부 채팅만 사용(웹 채팅은 정상, 외부 클라이언트는 접속 불가). 외부 클라이언트(Claude Desktop 등)를 붙이려면 Render 환경변수에 직접 생성한 값을 등록. 생성: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- 채팅은 기본적으로 같은 프로세스의 `http://127.0.0.1:${PORT}/mcp`로 접속한다(`MCP_SERVER_URL`로 변경 가능, 보통 설정 불필요).
- 도구 추가 방법: `src/mcp/tools/`에 정의+핸들러를 추가하면 `src/mcp/createServer.js`가 등록 → 채팅은 `tools/list`로 자동 인식(예전처럼 `claude.service.js`를 따로 고칠 필요 없음). stdio(`server.js`)와 HTTP가 같은 `createServer.js`를 쓴다.
- 관련 코드: `src/mcp/createServer.js`(서버/도구 등록), `src/controllers/mcp.controller.js` + `src/routes/mcp.routes.js`(`/mcp`), `src/middlewares/auth.middleware.js`의 `authenticateMcp`, `src/services/mcp.service.js`(채팅용 클라이언트), 테스트 `tests/mcp.test.js`.
- 로그로 MCP 경유 확인: Render Logs에 `[MCP Client] tools/list → 10 tools`, `[MCP Client] tools/call get_weekly_summary`, `[MCP] Tool called: get_weekly_summary {인자}`가 찍힌다(도구 10개, 2026-09-27 `get_weekly_summary` 추가).
- **Claude Desktop 연결(외부 클라이언트 시연)**: 원격 `/mcp`를 `mcp-remote` 브리지로 연결한다. 설정 예시는 [README.md](../README.md)의 "MCP 서버 테스트 (Claude Desktop)".
  - 전제: Render에 `MCP_AUTH_TOKEN`이 설정돼 있어야 함(미설정이면 기동마다 임의 토큰이라 외부 접속 불가). 현재 Render에 설정됐는지 **확인 필요**.
  - Claude Desktop 설정 파일(`claude_desktop_config.json`)에 토큰이 평문으로 들어가므로 공유·커밋 금지.
  - `mcp-remote`는 `npx`가 아니라 **전역 설치(`npm install -g mcp-remote`)**해서 쓴다 — Windows Claude Desktop이 서버를 동시에 두 번 띄워 npx 캐시가 깨짐(2026-09-27 실측).
  - `/.well-known/*`는 404 JSON이어야 한다(mcp-remote의 OAuth 탐색). `app.js`의 SPA 폴백이 여기에 HTML을 주면 연결이 `"<!DOCTYPE"... is not valid JSON`으로 실패 — 2026-09-27 제외 처리함. **2026-09-27 운영(Render)에서 Claude Desktop 연결·도구 호출 성공 확인.** Claude Desktop 로그는 Settings → Developer에서 서버별로 확인.
  - `AUTH_HEADER` 값은 반드시 `Bearer <토큰>`(접두사 포함). 접두사가 빠지면 401 → 로그에 `Dynamic Client Registration rejected (404) /register`, `SSE ... (405)`가 찍힌다(OAuth/SSE 문제처럼 보이지만 원인은 헤더).
  - claude.ai 웹의 커스텀 커넥터는 헤더 지정 없이 OAuth를 쓰는 방식이라 현재 Bearer 방식으로는 바로 못 붙는 것으로 보임 — **확인 필요**.
- **stdio 버전(`npm run mcp`)을 Claude Desktop에 직접 붙이지 말 것** (2026-09-27 확인): ① `server.js`가 `.env`를 로드하지 않아 Supabase 환경변수가 비고(`index.js`만 `dotenv` 호출), ② winston 로거가 stdout에 로그를 써서 MCP JSON-RPC 메시지와 섞인다(`initialize` 응답 앞에 `info: MCP Server ... is running` 줄이 붙는 것 확인). 고치려면 stdio 모드에서 로그를 stderr로 보내고 dotenv를 로드해야 함 — 미수정.

## 홈 "오늘의 브리핑" 저장 (2026-09-27 추가)

- 브리핑(`POST /api/chat/summary`)을 만들면 `briefings` 테이블에 **사용자당 1행**으로 저장(upsert, `user_id UNIQUE` — 새로 만들면 덮어씀). 앱을 열거나 새로고침하면 `GET /api/chat/summary/latest`로 복원해서 다시 만들 필요 없음. 다른 기기에서도 같은 브리핑이 보임.
- **배포에 필요한 수동 작업**: Supabase SQL Editor에서 `database/schema.sql`의 "7-1. Briefings 테이블" 블록만 실행. 테이블(또는 `UNIQUE`)이 없으면 브리핑은 화면에 나오지만 저장이 안 되고, 로그에 `[Briefing] Failed to save briefing` 경고만 남는다(응답은 정상). 운영 DB에 생성됐는지 **확인 필요**.
- 브리핑 본문은 Markdown(한 줄 요약 → `## 이모지 섹션` → `- **오후 2:55** 내용`, 위험은 `⚠️ 제목: 내용`)으로 생성되고, 홈 카드가 채팅과 같은 파서(`web/src/lib/chatBlocks.js`)로 제목·목록·경고 카드를 그린다. 이벤트 시각은 한국 시간으로 모델에 전달.
- 관련 코드: `src/services/briefing.service.js`, `chat.controller.js`의 `getDailySummary`/`getLatestSummary`, `claude.service.js`의 `BRIEFING_SYSTEM_PROMPT`, 프론트 `AppDataContext.jsx`(복원), `HomeScreen.jsx`, `components/chat/AiMessage.jsx`의 `MarkdownBlocks`.

## 웹 푸시 알림 (2026-09-22 추가)

설정 화면의 위험/방문자/움직임/소리 알림 토글을 실제 브라우저 푸시로 발송하는 기능(`web-push`/VAPID 방식). 일일 브리핑 자동 발송은 아직 미구현(토글 저장만 됨).

- **배포에 필요한 수동 작업 (아직 안 돼 있으면 알림이 조용히 발송 안 됨 — 에러는 안 남):**
  1. Supabase SQL Editor에서 `database/schema.sql`의 `push_subscriptions`/`notification_preferences` 테이블 생성 블록만 실행 (파일 전체 실행 금지 — 샘플 데이터 섞임)
  2. Render 환경변수에 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`(`mailto:...`) 등록. 키가 없으면 백엔드가 로그에 경고만 남기고 발송을 건너뛴다.
  3. Vercel 환경변수에 `VITE_VAPID_PUBLIC_KEY`(위 `VAPID_PUBLIC_KEY`와 동일 값) 등록 후 Redeploy. 새 VAPID 키 쌍이 필요하면 `npx web-push generate-vapid-keys`로 생성.
- 관련 코드: `src/services/push.service.js`(발송), `src/services/notification.service.js`(구독/설정 관리 + 이벤트 발생 시 발송 판단), `src/routes/notification.routes.js`, `web/public/sw.js`(서비스워커), `web/src/lib/push.js`(구독 헬퍼).
- 동작 방식: 이벤트 생성(`event.controller.js`) 성공 시 `notifyEvent()`가 해당 이벤트를 만든 디바이스의 소유자(`devices.user_id`)를 찾아, 그 사용자의 `notification_preferences`에서 이벤트 타입에 해당하는 토글이 켜져 있으면 등록된 모든 구독으로 발송한다.

## 카메라/마이크 온·오프 상태 (2026-09-22 추가)

홈 화면의 "카메라"/"마이크" 카드가 실제 하드웨어 온·오프를 반영하도록 연동했다. 이전엔 `schema.sql`의 가짜 샘플 기기(거실/현관 카메라, `status: online` 하드코딩) 때문에 "카메라 2대 온라인"으로 잘못 표시되고 있었음 — 해당 샘플 기기 2개는 Supabase에서 삭제했다.

- **devices 테이블 실제 구성 (2026-09-22 정정)**: 기존 `raspberry-pi-5`(id 그대로 유지) 행을 실제 역할에 맞게 `type: microphone`, 이름 `ReSpeaker 2-Mic HAT`로 정정. `Camera Module V3`용 기기 행을 새로 등록(`type: camera`). `edge/.env`의 `HOMECARE_DEVICE_ID`(이벤트 전송용, 기존 값 그대로)는 마이크 기기를 가리키고, 새로 추가된 `HOMECARE_CAMERA_DEVICE_ID`는 카메라 기기를 가리킨다.
- **online/offline 판단**: `devices.status` 컬럼을 그대로 믿지 않고, [device.service.js](../src/services/device.service.js)의 `withComputedStatus()`가 `last_heartbeat`가 60초(`HEARTBEAT_STALE_MS`) 이내인지로 매번 다시 계산한다(하트비트가 끊겨도 `status`가 `online`으로 남아있던 문제 수정).
- **마이크**: [edge/stream_pipeline.py](../edge/stream_pipeline.py)가 실행되는 동안(`--wav-file` 테스트 모드 제외) 20초 간격으로 자동으로 `POST /api/devices/:id/heartbeat`를 보낸다([edge/heartbeat.py](../edge/heartbeat.py) 공용 헬퍼). 별도 설정 불필요 — 파이프라인 프로세스가 살아있으면 자동으로 "켜짐".
- **카메라**: 아직 영상 분석 코드가 없어서, [edge/camera_monitor.py](../edge/camera_monitor.py)라는 별도 스크립트가 `rpicam-hello --list-cameras`(또는 `libcamera-hello`)로 하드웨어 인식 여부만 20초마다 확인해 하트비트를 보낸다.
- **사용자 방침(2026-09-22)**: 24시간 상시 감시가 아니라 **필요할 때만 켜고 끄는 방식**을 원함 — 그래서 부팅 시 자동 시작(`systemctl enable`)은 하지 않고, [edge/systemd/](../edge/systemd/)에 unit 파일만 등록해 두고 `systemctl start`/`stop`으로 수동 on/off 하도록 함(터미널을 닫아도 켜둔 동안엔 계속 돎). 상세 절차는 [edge/README.md](../edge/README.md)의 "필요할 때만 켜고 끄기" 참고.
  ```bash
  # 둘 다
  sudo systemctl start homecare-mic.service homecare-camera.service    # 켜기
  sudo systemctl stop  homecare-mic.service homecare-camera.service    # 끄기
  systemctl is-active  homecare-mic.service homecare-camera.service    # 지금 켜져있는지(active)/꺼져있는지(inactive)
  systemctl status     homecare-mic.service homecare-camera.service    # 잘 도는지 상세 확인
  journalctl -u homecare-mic.service -f       # 실시간 로그 (Ctrl+C로 빠져나오기)
  journalctl -u homecare-camera.service -f

  # 마이크만
  sudo systemctl start homecare-mic.service
  sudo systemctl stop  homecare-mic.service
  systemctl is-active  homecare-mic.service

  # 카메라만
  sudo systemctl start homecare-camera.service
  sudo systemctl stop  homecare-camera.service
  systemctl is-active  homecare-camera.service
  ```
  - `homecare-camera.service`(`camera_monitor.py`)는 카메라 **인식 여부 하트비트** + **앱/채팅의 "현재 화면 보기" 요청 대기**(아래 "현재 화면 캡처")를 함께 돌린다. 이 서비스가 꺼져 있으면 현재 화면 보기는 "카메라가 꺼져 있어…"로 안내된다. 이벤트로 DB에 남기는 수동 촬영은 아래 "카메라 사진 촬영"의 1회성 명령으로 따로 실행.

## 현재 화면 캡처 — 홈 카메라 카드 / 채팅 "현재 화면 보여줘" (2026-09-27 추가)

```
홈 📷 카메라 카드 ─ POST /api/devices/:id/capture ─┐
채팅 "현재 화면 보여줘" → Claude → MCP request_capture ─┤→ capture.service.js (메모리)
                                                        │      ↑ 요청 즉시 전달
Pi camera_monitor.py ── GET /api/devices/:id/capture-requests/next (롱폴링, 최대 25초 대기) ─┘
   └ 요청 받으면 rpicam-still 1280x720 촬영 → POST /api/devices/:id/capture-requests/:requestId (JPEG)
→ 백엔드 응답 { captureId, imageUrl: /api/devices/:id/captures/:captureId, capturedAt }
→ 프론트가 토큰을 붙여 이미지를 받아 표시 (CaptureImage.jsx, 누르면 확대)
```

- **통신 방식**: Render에서 Pi로 먼저 접속할 수 없어서(Pi에 공인 주소 없음) Pi가 **HTTP 롱폴링**으로 요청을 기다린다. 기존 기기 인증(`X-Device-Id`/`X-Device-Secret`) 그대로, 새 라이브러리 없음. 폴링은 카메라 기기 id(`HOMECARE_CAMERA_DEVICE_ID`)로만 한다(다른 id면 403).
- **이미지 보관**: Supabase Storage에 **영구 저장하지 않는다**. 백엔드 메모리에 최근 20장, 6시간만 보관(`capture.service.js`의 `settings`). **서버가 재시작하면**(Render 재배포·유휴 후 재기동) 예전 채팅 속 사진은 "사진 보관 시간이 지나 더 이상 볼 수 없어요"로 표시된다. 이미지 조회는 로그인한 **기기 소유자(`devices.user_id`)만** 가능.
- **채팅**: MCP 도구 `request_capture`가 실제 촬영(예전엔 `capture_requests`/`events`에 `[CAPTURE_REQUEST]` 가짜 행을 쓰기만 했음 — 제거). `deviceId`는 생략 가능(켜진 카메라 자동 선택). 사진 링크는 모델이 쓰지 않고 `claude.service.js`가 도구 결과에서 꺼내 답변 맨 앞에 `![현재 카메라 화면](/api/devices/.../captures/...)` 줄로 붙인다 → 대화 기록(`messages.content`)에도 그대로 저장, 앱(`chatBlocks.js`)이 이 경로 형식만 이미지 카드로 그림.
- **판단 순서 / 에러 문구**(사용자에게는 문구만, 원인은 Render 로그 `[Capture]`): 기기 없음/남의 기기 404 → 하트비트 끊김 **409 "카메라가 꺼져 있어 현재 화면을 가져올 수 없습니다."** → Pi 폴링이 40초간 없음 503(카메라 서비스 재시작 안내 — Pi 코드가 구버전일 때도 이것) → Pi가 카메라 장치를 못 찾음 503 / 촬영 실패 502 → 25초 안에 이미지가 안 오면 504.
- **중복 방지**: 같은 카메라에 진행 중인 요청이 있으면 새 요청은 같은 결과를 받는다(촬영 1번). 프론트는 촬영 중 카드 비활성화, 채팅은 기존처럼 답변 대기 중 전송 불가. Pi는 인식 확인과 촬영이 겹치지 않게 lock.
- **전제/제약**: 상태가 메모리에 있어서 **Render 인스턴스가 1개일 때만** 동작한다(여러 개로 늘리면 요청과 폴링이 다른 인스턴스로 갈 수 있음). 카메라 서비스가 켜져 있는 동안은 25초마다 롱폴링 요청이 오므로 Render 무료 플랜이 잠들지 않는다(무료 사용 시간 소모).
- 관련 코드: `src/services/capture.service.js`, `src/controllers/device.controller.js`(`requestCapture`/`getCaptureImage`/`pollCaptureRequest`/`submitCaptureResult`), `src/routes/device.routes.js`, `src/mcp/tools/camera.tools.js`, `src/services/claude.service.js`, `edge/camera_monitor.py`, 프론트 `web/src/screens/HomeScreen.jsx`, `web/src/components/CaptureImage.jsx`, `web/src/lib/chatBlocks.js`, 테스트 `tests/capture.test.js`, `edge/tests/test_edge.py`.
- **반영 방법**: `main` push → Render 자동 배포 + Vercel 자동 빌드, Pi에서 `git pull` 후 `sudo systemctl restart homecare-camera.service`. Pi 로그에서 `카메라 감지 모니터링 + 현재 화면 캡처 대기 시작`이 보이면 새 코드로 돌고 있는 것.

## 카메라 사진 촬영 → DB 저장 (2026-09-27 추가)

```bash
cd ~/homecare && source .venv/bin/activate
python -m edge.capture_photo --no-send               # 촬영만 (edge/data/captures/에 저장, 카메라 점검용)
python -m edge.capture_photo                         # 촬영 + 전송
python -m edge.capture_photo --description "현관 확인"
```

- 흐름: `rpicam-still`(없으면 `libcamera-still`)로 1920×1080 JPG 촬영 → `EventEmitter.emit("camera_capture", image_path=...)` → `POST /api/events` multipart `image` → 백엔드가 Supabase Storage **`events` 버킷**에 업로드하고 `events.image_url`에 공개 URL 저장. 이벤트는 `type: other`, `dangerLevel: normal`. 백엔드는 수정 없음(기존 업로드 기능 사용).
- 이벤트는 **카메라 기기 id(`HOMECARE_CAMERA_DEVICE_ID`)**로 전송하고, 전송 큐도 `edge/data/camera/`로 마이크(`edge/data/`)와 분리한다 — 같은 큐를 쓰면 마이크 파이프라인의 sender가 사진 이벤트를 마이크 id로 보낼 수 있음.
- **주의**: 백엔드 `storage.service.js`는 업로드 실패 시 null을 반환해 **사진 없이 201 저장**된다. 그래서 엣지 sender가 "첨부했는데 응답에 `image_url`이 비었음"이면 경고 로그를 찍는다 — 이 경고가 보이면 Render Logs의 `[Storage]` 오류와 Supabase `events` 버킷(존재·public 여부) 확인. 버킷 상태는 **확인 필요**.
- 원격 촬영(홈 카메라 카드/채팅 "현재 화면 보여줘")은 위 "현재 화면 캡처"로 구현됨(2026-09-27) — 그쪽은 DB에 이벤트로 남기지 않는다.
- 나중에 실제 카메라 영상 분석 파이프라인이 생기면 `camera_monitor.py`의 하트비트를 그 프로세스로 옮길 것(마이크 쪽과 동일한 패턴).

## 운영 절차

```bash
# 백엔드 배포: main에 push하면 Render가 자동 재배포 (별도 명령 없음)
git push origin main

# 상태 확인 — environment가 production 인지 확인
curl https://homecare-9kcu.onrender.com/health
# 인증이 켜져 있는지 확인 — 토큰 없이 401이 나와야 정상
curl -i https://homecare-9kcu.onrender.com/api/chat/history
```

- 문제가 생기면 Render **Logs**를 본다. 이벤트 저장 실패는 `[EventService] Error creating event:` 줄에 원인이 찍힌다(백엔드는 저장 실패 시 500을 반환).
- 프론트 백엔드 주소를 바꾸면 Vercel `VITE_API_URL` 수정 후 **Redeploy**(빌드 시점에 값이 박힘).

### 엣지(Pi) 운영

```bash
cd ~/homecare
git pull                                  # 코드 업데이트
source .venv/bin/activate                 # 새 터미널마다 필요
pip install -r edge/requirements.txt      # 의존성 변경 시
python -m edge.send_test_event            # 전송 경로 점검 (웹 "최근 이벤트"에 [테스트] 이벤트가 보이면 성공)
```

- `edge/.env`의 `HOMECARE_DEVICE_ID`는 Supabase **`devices`** 테이블 행의 id여야 한다(`events` id 아님). 현재 등록된 기기: `ReSpeaker 2-Mic HAT`(마이크, `HOMECARE_DEVICE_ID`), `Camera Module V3`(카메라, `HOMECARE_CAMERA_DEVICE_ID`) — 2026-09-22 정정, 옛 이름 `raspberry-pi-5`는 더 이상 안 씀.
- 전송 실패 이벤트는 `edge/data/`의 SQLite 큐에 남아 다음 실행 때 재시도된다.
- 상세는 [`../edge/README.md`](../edge/README.md).

## 알려진 이슈 / 남은 일

- 웹 푸시: Supabase 테이블 생성 + Render/Vercel 환경변수 등록 전까지는 알림 토글을 켜도 실제 푸시가 오지 않는다(위 "웹 푸시 알림" 참고). 일일 브리핑(매일 21시) 자동 발송은 스케줄러가 없어 미구현.
- 채팅 대화/메시지는 `src/services/conversation.service.js`만 통해 접근한다 — `conversations`/`messages` RLS가 `auth.uid()` 기준이라 서버 anon 클라이언트로는 항상 빈 결과. admin으로 읽되 반드시 `user_id`로 소유자를 확인할 것(2026-09-27 정리). 2026-09-27 이전에 만들어진 대화는 제목이 null이라 채팅 기록 목록에 "제목 없는 대화"로 표시됨.
- `deleteEvent`(`/api/events/:id` DELETE)가 요청자가 그 이벤트 소유 디바이스의 사용자인지 검사하지 않는다 — 로그인한 사용자면 누구나 다른 사용자의 이벤트를 삭제할 수 있는 상태. **확인 필요**
- **`edge/systemd/`의 unit 파일이 아직 Pi에 설치 안 됨** — `sudo cp ... /etc/systemd/system/ && sudo systemctl daemon-reload`까지는 해둬야 `systemctl start`로 켤 수 있음(자동 시작은 원하지 않으므로 `enable`은 하지 않음). 설치 전까지는 카메라/마이크 카드가 계속 "꺼짐"으로 보임.
- 2026-09-27 작업분은 커밋·push됨(`a1559cc`, `cc1ad07`). **Render 배포 후 확인 필요**: `/health`가 `production`, 토큰 없이 `POST /mcp` 401, 웹 채팅 "이번주 요약"이 3건 모두·한국 시간으로 답하는지, 홈 브리핑이 새로고침 후에도 유지되는지(`briefings` 테이블 생성 후).
- 채팅 "이번주 요약"이 3건 중 1건만·UTC 시각("오전 7시")으로 답한 원인은 **미확정**(로컬 프론트→로컬 백엔드, 새 코드로 동작 중이었음을 확인). 후보: 이전 대화 기록 재사용(대화 기록엔 최종 답변 텍스트만 저장, 도구 결과는 저장 안 됨) / 다른 도구 선택. 새 대화에서 재질문 후 로그의 `[MCP] Tool called:` 도구명으로 판별할 것.
- Render 플랜 결정(무료 플랜 유휴 지연 22초대)
- 카메라 영상 분석(YOLO 등) 파이프라인 자체가 아직 없음 — 현재는 하드웨어 인식 여부 + 수동 사진 촬영(`edge.capture_photo`, 2026-09-27)만
- `edge.capture_photo` Pi 실기 검증 **미완료**(로컬 단위 테스트만 통과). Supabase Storage `events` 버킷 존재·public 여부 **확인 필요**
- 현재 화면 캡처(홈/채팅) **실기 검증 미완료** — 로컬 단위/통합 테스트만 통과, Render 배포·Pi `git pull`+카메라 서비스 재시작 후 홈 카드·채팅에서 확인 필요. 홈 화면 마이크 카드가 "미등록"으로 보이는 건 `GET /api/devices`가 로그인 사용자 `user_id`로 거르기 때문으로 추정(마이크 기기의 `user_id`가 다를 가능성) — **확인 필요**
- 엣지 `event_mapper.py` 변환표는 기본안 — 팀 확정 필요
- DB 정리 필요: `schema.sql` 샘플 데이터가 운영 `events`에 아직 섞여 있음(가짜 기기 2개는 2026-09-22 삭제했으나 그 기기를 참조하던 샘플 이벤트 3건은 device_id가 null로 남아있을 수 있음), 테스트 이벤트(`[테스트] 엣지 전송 확인`) 2건
- GCP(Cloud Run 시도)에 만들어 둔 리소스/결제 계정 정리 여부 **확인 필요**
- `npm test` 48 통과 / 5 실패(2026-09-27 밤 기준, `tests/capture.test.js` 13건 추가). 실패 5건은 기존부터: 채팅 테스트 4건은 인증 추가 후 토큰 없이 요청해 401(인증은 정상 동작 — 테스트가 낡음, 고치려면 인증·Claude API·Supabase mock 필요), 404 테스트 1건은 `app.js`의 레거시 `frontend/` SPA 폴백(`app.get('*')`)이 모든 GET에 200을 줘서 실패. 정리 방향 미결정
- `docker-compose.yml`의 `version` 속성 obsolete 경고 (현재 배포 경로 아님, 정리는 선택)
