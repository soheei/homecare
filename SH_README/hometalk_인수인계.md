# HomeCare 서버 배포/인프라 인수인계 문서

> 작성일시: 2026-08-30
> 최근 수정일시: 2026-09-20 (Pi 초기화 → 백엔드 Render 이전, 엣지 전송 경로 구축 반영. 옛 Pi/Docker/Tailscale Funnel 내용 삭제)
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
| 엣지 | 라즈베리파이 (`edge/` 코드) | `POST /api/events`로 이벤트 전송, 실전송 검증 완료. 마이크→YAMNet 실시간 파이프라인은 미구현 |

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

`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EDGE_DEVICE_SECRET`, `ALLOWED_ORIGINS`(프론트 주소, 끝에 `/` 없이), `LOG_LEVEL=info`.

- `PORT`는 넣지 않는다(Render가 주입, 앱이 `process.env.PORT`를 읽음).
- `NODE_ENV`는 `production`이어야 한다(Dockerfile 기본값). **`development`로 덮어쓰면 인증이 우회된다** — 로컬 `.env` 통째 붙여넣기 주의.

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

- `edge/.env`의 `HOMECARE_DEVICE_ID`는 Supabase **`devices`** 테이블 행의 id여야 한다(`events` id 아님). 현재 등록된 기기 행 이름은 `raspberry-pi-5`.
- 전송 실패 이벤트는 `edge/data/`의 SQLite 큐에 남아 다음 실행 때 재시도된다.
- 상세는 [`../edge/README.md`](../edge/README.md).

## 알려진 이슈 / 남은 일

- **Anthropic API 크레딧 부족으로 채팅 실패(400)가 확인됨** — 충전 여부와 채팅 응답 **확인 필요**
- Render 플랜 결정(무료 플랜 유휴 지연 22초대)
- 엣지: 마이크→YAMNet→`emit()` 파이프라인(`edge/stream_pipeline.py`) 미구현. Pi에서 TensorFlow 설치 가능 여부·TFLite 대안 **확인 필요**, 부팅 자동 실행(systemd), YOLO 연동(미완성), heartbeat 미구현(`devices.status`가 계속 `offline`)
- 엣지 `event_mapper.py` 변환표는 기본안 — 팀 확정 필요
- DB 정리 필요: `schema.sql` 샘플 데이터가 운영 `events`/`devices`에 섞여 있음, 테스트 이벤트(`[테스트] 엣지 전송 확인`) 2건
- GCP(Cloud Run 시도)에 만들어 둔 리소스/결제 계정 정리 여부 **확인 필요**
- `npm test` 기존 5건 실패(인증 401로 보임) 원인 미확인
- `docker-compose.yml`의 `version` 속성 obsolete 경고 (현재 배포 경로 아님, 정리는 선택)
- MCP stdio 서버(`src/mcp/server.js`)는 구조상 실사용 안 됨. 외부 MCP 클라이언트 연동이 필요해지면 별도 검토
