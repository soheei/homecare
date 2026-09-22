# HomeCare 서버 배포/인프라 인수인계 문서

> 작성일시: 2026-08-30
> 최근 수정일시: 2026-09-22 (카메라/마이크 온·오프 상태 하트비트 연동 — devices 기기 행 정정, online/offline 판단 로직 수정, 엣지 heartbeat 코드 추가)
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
- MCP stdio 서버(`src/mcp/server.js`)는 배포하지 않는다(런타임에 필요 없음, 상시 데몬으로 불가).
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

`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EDGE_DEVICE_SECRET`, `ALLOWED_ORIGINS`(프론트 주소, 끝에 `/` 없이), `LOG_LEVEL=info`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`(2026-09-22 웹 푸시 추가, 아래 "웹 푸시 알림" 참고).

- `PORT`는 넣지 않는다(Render가 주입, 앱이 `process.env.PORT`를 읽음).
- `NODE_ENV`는 `production`이어야 한다(Dockerfile 기본값). **`development`로 덮어쓰면 인증이 우회된다** — 로컬 `.env` 통째 붙여넣기 주의.

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
- **카메라**: 아직 영상 분석 코드가 없어서, [edge/camera_monitor.py](../edge/camera_monitor.py)라는 별도 스크립트가 `rpicam-hello --list-cameras`(또는 `libcamera-hello`)로 하드웨어 인식 여부만 20초마다 확인해 하트비트를 보낸다. **이 스크립트는 Pi에서 상시 실행되도록 별도로 떠 있어야 한다(예: systemd) — 아직 등록 안 함, 실제 Pi 접속해서 진행 필요.**
  ```bash
  cd ~/homecare && source .venv/bin/activate
  python -m edge.camera_monitor              # 상시 실행 (systemd 서비스화 필요)
  python -m edge.camera_monitor --list-cameras  # 감지 결과만 1회 확인 (디버그용)
  ```
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
- `deleteEvent`(`/api/events/:id` DELETE)가 요청자가 그 이벤트 소유 디바이스의 사용자인지 검사하지 않는다 — 로그인한 사용자면 누구나 다른 사용자의 이벤트를 삭제할 수 있는 상태. **확인 필요**
- **카메라 하트비트(`edge/camera_monitor.py`)가 Pi에서 아직 상시 실행되도록 등록 안 됨** — systemd 서비스화 필요(위 "카메라/마이크 온·오프 상태" 참고). 등록 전까지는 카메라 카드가 계속 "꺼짐"으로 보임.
- **Anthropic API 크레딧 부족으로 채팅 실패(400)가 확인됨** — 충전 여부와 채팅 응답 **확인 필요**
- Render 플랜 결정(무료 플랜 유휴 지연 22초대)
- 카메라 영상 분석(YOLO 등) 파이프라인 자체가 아직 없음 — 현재는 하드웨어 인식 여부만 확인
- 엣지 `event_mapper.py` 변환표는 기본안 — 팀 확정 필요
- DB 정리 필요: `schema.sql` 샘플 데이터가 운영 `events`에 아직 섞여 있음(가짜 기기 2개는 2026-09-22 삭제했으나 그 기기를 참조하던 샘플 이벤트 3건은 device_id가 null로 남아있을 수 있음), 테스트 이벤트(`[테스트] 엣지 전송 확인`) 2건
- GCP(Cloud Run 시도)에 만들어 둔 리소스/결제 계정 정리 여부 **확인 필요**
- `npm test` 기존 5건 실패(인증 401로 보임) 원인 미확인
- `docker-compose.yml`의 `version` 속성 obsolete 경고 (현재 배포 경로 아님, 정리는 선택)
- MCP stdio 서버(`src/mcp/server.js`)는 구조상 실사용 안 됨. 외부 MCP 클라이언트 연동이 필요해지면 별도 검토
