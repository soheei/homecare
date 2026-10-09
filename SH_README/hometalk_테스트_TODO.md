# HomeCare 실기 테스트 TODO + 남은 수정사항

> 작성일시: 2026-09-28
> 최근 수정일시: 2026-10-09 (6번 단계 3 거실/현관 모드·경비 모드 코드 완료 — 실기 확인 항목으로 재작성, 경비 상태 저장 위치를 devices로 정정 / 이전 2026-10-05: 6번 "앱 TODO 9개" 추가 — 단계 1 코드 완료·배포/실기 확인 대기, 단계 2·3 미착수 / 이전 2026-09-29: vision 영상 Pi 원본 즉시 삭제 — 3-5·5번 갱신 / 이전 2026-09-28: 카메라 서비스를 vision으로 통합 — 3-1·3-5·5번 갱신 / 최초 작성 — 엣지 폴더 재구성, 서명 URL, 소리 반복 전송 수정, 방문자·택배 감지 재설계 이후 실기 확인 목록)
> 이 문서의 역할: **코드로는 검증했지만 실제 Pi / Render / Supabase에서 아직 확인 안 한 것**의 체크리스트와 확인 방법,
> 그리고 **소리·영상 융합 계획에서 남은 수정사항**. 확인이 끝난 항목은 `[x]`로 체크하고 결과를 한 줄 적는다.
> 날짜별 작업 기록은 `hometalk_진행일지.md`, 현재 운영 상태는 `hometalk_인수인계.md`.

---

## 0. 테스트 전 준비

- [x] **변경사항 커밋·push** (현재 로컬에만 있음: 서명 URL 백엔드, 소리 반복 전송 수정, 방문자·택배 감지, 카메라 서비스 통합)
  - push하면 Render가 백엔드를 자동 재배포한다.
- [x] **Pi 코드 받기 + 서비스 파일 재설치** (2026-09-28 완료, 카메라=`vision.vision_pipeline`, `HOMECARE_EVENT_DIR=edge/data/events` 추가) (엣지 폴더 재구성으로 실행 명령이 바뀜)
  ```bash
  cd ~/homecare && git pull
  git sparse-checkout list          # vision 이 없으면 ↓ (카메라 서비스 = vision)
  git sparse-checkout add vision
  sudo cp edge/systemd/*.service /etc/systemd/system/ && sudo systemctl daemon-reload
  ```
  - 확인: `grep ExecStart /etc/systemd/system/homecare-*.service` → 마이크는 `edge.apps.stream_pipeline`, 카메라는 `vision.vision_pipeline`
- [x] **Pi에서 단위 테스트** (2026-09-28: 엣지 25·vision 20 OK) (Pi 환경에서도 코드가 도는지)
  ```bash
  source .venv/bin/activate
  python -m unittest discover -s edge/tests -t .     # 기대: 25개 OK
  python -m unittest discover -s vision/tests -t .   # 기대: 24개 OK (cv2, numpy 필요)
  ```

---

## 1. 백엔드 (Render / Supabase)

- [ ] **배포 상태** — `curl https://homecare-9kcu.onrender.com/health`
  - 기대: `"environment":"production"` (development면 인증이 통째로 꺼짐 — CLAUDE.md 실수 기록)
- [ ] **인증 유지** — 토큰 없이 `curl -i https://homecare-9kcu.onrender.com/api/chat/history` → 기대: `401`
- [ ] **이벤트 사진/영상 서명 URL** (private 버킷)
  - 방법:
    1. 웹(https://homecare-9sr8.vercel.app/)에 로그인 → 브라우저 개발자도구(F12) → Network 탭 → 아무 `/api/...` 요청의 `Authorization: Bearer …` 값 복사
    2. `curl -H "Authorization: Bearer <토큰>" "https://homecare-9kcu.onrender.com/api/events?limit=10"`
  - 기대:
    - 사진/영상이 있는 이벤트의 `image_url`/`video_url`에 `/object/sign/events/…?token=` 이 들어 있음
    - 그 주소를 브라우저에 붙여 넣으면 사진이 보이거나 영상이 재생됨
    - `/object/public/…` 이 그대로 나오거나 `null`이면 → Render Logs에서 `[Storage] Signed URL error` 확인
  - (선택) 1시간 뒤 같은 주소를 다시 열면 만료되어 열리지 않아야 함
- [ ] **중복 이벤트 확인** (소리 반복 전송 버그 수정 전에 쌓였을 수 있음)
  - Supabase SQL Editor(조회만):
    ```sql
    select metadata->>'category_id' as category, description, count(*) as n,
           min(timestamp) as first_at, max(timestamp) as last_at
    from events
    where metadata->>'source' = 'yamnet'
    group by 1, 2
    order by n desc;
    ```
  - 기대: 같은 설명이 쿨다운 간격(10초/30초/5분)으로 수십 건 반복돼 있으면 버그 흔적 → 정리(삭제) 여부는 팀 결정
- [ ] **npm test** — 로컬에서 `npm test` → 기대: 52 통과 / 5 실패(기존 낡은 테스트 5건)

---

## 2. 마이크 — 소리 이벤트 (반복 전송 수정 확인)

준비: `sudo systemctl start homecare-mic.service` → `journalctl -u homecare-mic.service -f`로 로그를 띄워 둔다.
소리는 휴대폰으로 유튜브 효과음(초인종, 유리 깨지는 소리 등)을 마이크 가까이에서 재생.

- [ ] **초인종 소리 1번 → 이벤트 1건, 반복 없음**
  - 방법: 초인종 효과음 1번 재생 → **10분 이상** 그대로 둔다
  - 기대: 로그 `이벤트 판정 category=door_visitor` **1번**, 웹 "최근 이벤트"에 **1건**. 5분 뒤, 10분 뒤에도 새로 생기지 않음
  - (수정 전: 5분마다 같은 이벤트가 계속 생김)
- [ ] **유리 깨지는 소리 1번 → 1건, 신뢰도가 정상**
  - 기대: 1건만, 설명의 신뢰도가 `0.3` 이상 (수정 전엔 두 번째부터 `0.01` 같은 값으로 10초마다 반복)
- [ ] **조용한 상태 유지 → 이벤트 없음** (5분)
- [ ] **장시간 실행 시 처리 지연** (판정이 히스토리 3시간 분량에서 느려지는지)
  - 방법: 서비스를 **3시간 이상** 켜 둔 뒤, 초인종 소리를 재생하고 재생한 시각을 기록 → 로그의 `이벤트 판정` 시각과 비교. 같은 방법으로 켠 직후에도 한 번 측정
  - 기대: 지연 수 초 이내. 수십 초 이상으로 벌어지면 → "남은 수정사항 B-성능" 착수
  - 추가로 `top`에서 python CPU 사용률 기록
- [ ] **임계값 체감 확인** — TV/대화 소리를 틀어 두고 5분 → 오탐이 몇 건 나오는지 기록 (튜닝 근거)

---

## 3. 카메라 — vision 파이프라인 (방문자·택배)

### 3-1. 실행 환경 (먼저 확인)

- [x] **vision 의존성 설치 여부** — 2026-09-28 Pi 확인 결과: venv(Python 3.13.5, numpy 2.5.3)에 `cv2`·`torch`·`ultralytics`·`picamera2` **전부 없음**. picamera2는 apt(`python3-picamera2`)로 시스템에만 설치됨, venv는 `include-system-site-packages = false`. sparse-checkout에 vision 포함, `HOMECARE_CAMERA_DEVICE_ID` 설정됨, `/mnt/ssd` **없음**
  - [x] 조치 완료(2026-09-28): `include-system-site-packages = true` + `pip install ultralytics` → cv2·torch·ultralytics·picamera2·tensorflow·sounddevice 모두 import OK, numpy 2.5.3·tensorflow 2.21.0 그대로. 버전은 `vision/requirements.txt`에 기록
  - 원래 메모: 어느 requirements 파일에도 없음
  ```bash
  python -c "import cv2, ultralytics, picamera2; print('OK')"
  ```
  - `picamera2`는 apt(`python3-picamera2`)로 설치되는 패키지라, venv를 `--system-site-packages` 없이 만들었다면 venv 안에서 import가 안 될 수 있음 → 안 되면 설치 방법 결정 필요
- [x] **영상이 브라우저에서 재생 가능한 H.264로 저장되는지** — 2026-09-28 결과: **불가**. OpenCV(pip)가 하드웨어 인코더 `h264_v4l2m2m`만 시도하다 실패(Pi 5엔 H.264 하드웨어 인코더 없음) → `mp4v`로 저장돼 브라우저 재생 불가. → Pi에 ffmpeg libx264·PyAV libx264 있음 확인, `event_recorder.py`에 저장 후 ffmpeg H.264 변환 추가(2026-09-28). **확인**: 이벤트 저장 로그에 `[EVENT VIDEO] converted to H.264`가 나오고, 서명 URL 영상이 휴대폰 브라우저에서 재생되는지
  ```bash
  python -c "import cv2; w=cv2.VideoWriter('/tmp/t.mp4', cv2.VideoWriter_fourcc(*'avc1'), 5, (640,480)); print('H.264 가능' if w.isOpened() else 'H.264 불가 → mp4v로 저장됨(브라우저 재생 불가)')"
  ```
- [x] **영상 저장 폴더** — 기본 `/mnt/ssd/events`인데 Pi에 `/mnt/ssd` 없음(2026-09-28). `edge/.env`에 `HOMECARE_EVENT_DIR=edge/data/events` 추가 (코드 수정 A안 반영됨 2026-09-28 — `.env` 값이 적용됨, 상대 경로는 저장소 루트 기준). 서비스 시작 로그 `[EVENT DIR] /home/alarmi/homecare/edge/data/events` 확인
- [ ] **`edge/.env`에 `HOMECARE_CAMERA_DEVICE_ID`** 가 있는지 (없으면 vision이 "설정 오류"로 바로 종료)

실행: `sudo systemctl start homecare-camera.service` → `journalctl -u homecare-camera.service -f`
(서비스 없이 직접 돌릴 땐 저장소 루트에서 `python -m vision.vision_pipeline`)

### 3-1b. 카메라 서비스 통합 확인 (2026-09-28: 카메라 서비스 = vision)

| # | 방법 | 기대 결과 | 결과 |
|---|---|---|---|
| [ ] | 서비스 시작 후 로그 확인 | `HomeCare Vision Pipeline`, `[CAMERA STARTED]`, 에러 없음 | |
| [ ] | 시작 후 약 30초 뒤 웹 홈 화면 | 카메라 카드 **"켜짐"** | |
| [ ] | 홈 카메라 카드 누르기 / 채팅 "현재 화면 보여줘" | **바로(1~2초)** 640×480 사진 표시. 로그 `현재 화면 캡처 전송 request=…` | |
| [ ] | `sudo systemctl stop homecare-camera.service` 후 1~2분 | 카메라 카드 **"꺼짐"**, 현재 화면 보기는 "카메라가 꺼져 있어…" 안내 | |
| [ ] | 서비스 켠 상태에서 `python -m edge.apps.capture_photo --no-send` | 카메라를 못 열어 실패(예상 동작 — capture_photo는 서비스를 끄고 사용) | |

### 3-2. 방문자 (3초 머무름 규칙)

| # | 방법 | 기대 결과 | 결과 |
|---|---|---|---|
| [ ] | 카메라 앞에 **3초 이상** 서 있기 | `[VISITOR DETECTED]` 1번, 웹에 방문자 이벤트 1건 | |
| [ ] | 카메라 앞을 **그냥 지나가기** (1~2초) | `[VISITOR] passed by (ignored)`, 이벤트 없음 | |
| [ ] | **30초 이상** 계속 서 있기 | 여전히 1번만 | |
| [ ] | 떠났다가(2초 이상 화면 밖) 다시 와서 3초 서 있기 | 새로 1번 더 (단, 전송 쿨다운 5분 안이면 큐에 안 들어감 — 로그로 판단) | |

### 3-3. 택배 (두고 간 물체)

| # | 방법 | 기대 결과 | 결과 |
|---|---|---|---|
| [ ] | 상자를 들고 와서 **발밑에 두고 떠나기** | 떠난 뒤 약 3~5초 안에 `[DELIVERY DETECTED] score=…`, 웹에 택배 이벤트 + 사진/영상 | |
| [ ] | 아무것도 안 두고 떠나기 | 이벤트 없음 | |
| [ ] | 상자를 두고 떠난 뒤 **그대로 1분** | 택배 1번만 (반복 없음) | |
| [ ] | 상자를 두고 나갔다가 **바로 돌아와서 들고 가기** | 이벤트 없음 | |
| [ ] | 아무것도 안 두고 떠난 직후 **방 불 켜기/끄기** | `[DELIVERY] large scene change … ignored`, 이벤트 없음 | |
| [ ] | **바닥과 비슷한 색**의 상자/봉투로 반복 | 감지되는지 기록 → 안 되면 `DIFF_THRESHOLD`(35) 낮추기 | |
| [ ] | 사람이 들어오고 나갈 때 **화면 밝기가 확 바뀌는지** (카메라 자동 노출) | 바뀌어서 택배를 놓치면 `large scene change` 로그가 뜸 → 기록 | |

### 3-4. 낙상 (수정 전 기준선 측정 — 0-3 수정 후 비교용)

| # | 방법 (매트리스 등 안전한 곳에서) | 기록할 것 |
|---|---|---|
| [ ] | 서 있다가 옆으로 쓰러져 누운 채 5초 | `[FALL DETECTED]` 나오는지, 몇 번 나오는지 |
| [ ] | 의자/소파에 털썩 앉기 | 오탐 여부 |
| [ ] | 허리 숙여 물건 줍기 | 오탐 여부 |
| [ ] | 카메라 쪽으로 걸어오기 | 오탐 여부 |

### 3-5. 이벤트 데이터 확인 (Supabase `events` 테이블)

- [ ] vision 이벤트의 `device_id` — **카메라 기기 id**(`HOMECARE_CAMERA_DEVICE_ID`)여야 함 (2026-09-28 통합 때 수정됨)
- [ ] vision 이벤트의 `timestamp` — 실제 시각과 **9시간 어긋나는지** 확인(시간대 누락 의심, 0-5)
- [ ] Pi 원본 정리: 이벤트 저장(`[EDGE EMIT]`) 직후 `ls -R ~/homecare/edge/data/events`에 그 영상·썸네일이 **없어야** 함(2026-09-29부터 전송 성공 여부와 무관). 전송 대기 중에만 `edge/data/vision/attachments/`에 복사본이 있음
- [ ] `video_url`/`image_url`이 채워졌는지 → 1번 섹션 방법으로 서명 URL을 받아 **휴대폰 브라우저에서 영상 재생** 확인

---

## 4. 시연 리허설 (장소별)

같은 Pi·마이크·카메라를 옮겨 가며 진행. 장면 설정 없이 화면 속 행동으로 판단하는지 확인.

| 장소 | 감지돼야 함 | 감지되면 안 됨 (헷갈리는 동작) |
|---|---|---|
| 현관 | 초인종 + 3초 서 있기 → 방문자 / 상자 두고 가기 → 택배 / 노크 | TV 속 초인종 소리, 그냥 지나가기, 가방 멘 사람 |
| 거실 | 쓰러지며 신음 → 낙상 / 유리 깨지는 소리 / 아기 울음 소리 | 소파에 털썩 앉기, 물건 떨어뜨리기, 가방 내려놓고 나가기(→ 택배 오탐 예상), 가족이 3초 서 있기(→ 방문자 오탐 예상) |

- [ ] 각 동작 5회씩, "감지됨/안 됨"을 표로 기록 → 융합 전후 비교 자료(평가 단계)로 사용

---

## 5. 남은 수정사항 (소리·영상 융합 계획)

결정 사항: Pi·마이크·카메라 각 1대 / 장면 설정 없이 화면 행동으로 판단 / 한쪽 센서만 감지되면 **확신도만 낮춰 전송** / 영상은 private Storage + 서명 URL / 기존 코드는 최대한 유지.

### 0단계 — 기반 정리

- [x] 0-1 소리 반복 전송 버그 (`edge/apps/stream_pipeline.py`) — 2026-09-28
- [x] 0-2 행동 추적기 + 방문자 감지 버그 (`vision/activity_tracker.py`, `visitor_detector.py`) — 2026-09-28
- [x] 0-4 택배: 두고 간 물체 감지 (`vision/delivery_detector.py`) — 2026-09-28
- [ ] **0-3 낙상 판정 강화** (`vision/fall_detector.py`만) — 내려간 거리를 사람 키 대비 비율로, 쓰러진 뒤 2~3초 누운 모양 유지 시에만 확정. `update(person)` 입출력 유지
- [ ] **0-5 vision 전용 설정** (`vision/vision_pipeline.py`, `event_recorder.py`)
  - 이벤트 시각에 한국 시간대 붙이기 (`datetime.now()` → 시간대 포함)
  - [x] H.264: 저장 후 ffmpeg(libx264)로 변환 (`event_recorder.py`, 2026-09-28) — 실패해도 원본 mp4v로 전송
  - [x] Pi 로컬 영상 정리: 전송 성공하면 원본(영상·썸네일) 삭제, 최종 실패하면 남김 (`edge/transport/outbox.py` `delete_originals_on_sent`, 2026-09-28)
  - [x] → 2026-09-29 변경: 큐에 넣은 직후 원본 삭제, 최종 실패·쿨다운분도 Pi에 남기지 않음 (`vision_pipeline.py` `emit_saved_event`)
- [x] 0-6 카메라 서비스를 vision으로 통합 — vision이 하트비트 + "현재 화면 보기"(메모리 최신 프레임) 처리, `homecare-camera.service`가 `vision.vision_pipeline` 실행, 이벤트는 카메라 기기 id + `edge/data/vision/` 큐 (`vision/camera_service.py`) — 2026-09-28
- [ ] **vision 의존성 정리** — `ultralytics`, `opencv`, `picamera2` 설치 방법을 문서/requirements에 반영 (3-1 결과에 따라)

### 1~4단계 — 융합

- [ ] **1. 신호 버스** — 소리·영상 감지기가 판정 전 후보 신호를 `edge/data/signals.db`에 기록 (전송 방식은 그대로 두고 기록만 = 섀도 모드)
- [ ] **2. 평가 도구** — 4번 시연 리허설을 녹화·라벨링 → 신호 재생으로 "소리만 / 영상만 / 융합" 정밀도·재현율·오탐 건수 비교
- [ ] **3. 융합기** (`edge/fusion/` 신규)
  - 같은 시간창의 소리+영상 증거를 합쳐 이벤트 1건, `metadata.confidence = confirmed | single`
  - 낙상(쿵→신음 + 쓰러짐), 방문자(초인종/노크 + 머무름), 택배(물체 남김 + 노크), 장시간 무활동(소리 + 사람 없음)
  - 경보음은 소리만으로 즉시 전송 (영상 대기 없음)
  - 소리 이벤트에도 vision이 들고 있는 직전 3초 영상 첨부
  - 택배 기사가 3초 이상 머물 때 생기는 방문자+택배 중복을 한 건으로 묶기
- [ ] **4. 튜닝** — YAMNet 임계값(Plan.md §9 실측값, 지금은 전부 0.3), 택배 `DIFF_THRESHOLD`, 방문자 3초 기준, 필요 시 택배 상자 전용 YOLO 추가 학습(B안), 데이터가 쌓이면 규칙 대신 가벼운 학습 모델

### 5단계 — 보기 화면

- [ ] **웹 이벤트 사진/영상 표시** — 지금 웹에는 이벤트 사진·영상을 보여주는 화면이 없음(서명 URL은 API로만 받을 수 있음)
- [ ] **보관 기간 정책** — Supabase Storage 무료 1GB(요금제 확인 필요), 클립당 약 0.5~1.5MB → 예: 30일 뒤 삭제

### 계획 밖에서 발견한 알려진 문제 (아직 착수 안 함)

- [ ] 소리 판정이 히스토리가 길어질수록 느려짐 (3시간 분량에서 PC 기준 1회 210ms, Pi는 더 느림) — 2번 섹션 측정 결과에 따라 규칙별로 필요한 구간만 판정하도록 개선
- [ ] `health_signal`(기침 횟수), 생활 소음 로그는 판정만 하고 어디에도 기록되지 않음 ("일일 브리핑 반영" 미구현)
- [ ] 마이크 콜백이 멈춰도 하트비트는 계속 "켜짐"을 보냄
- [ ] `glass_impact` 신뢰도 계산에 판정 규칙엔 없는 Thud(454)가 포함됨
- [ ] 채팅(MCP)·일별/주간 요약은 사진·영상 URL을 서명하지 않음(의도된 결정 — 대화 기록에 만료 링크가 남지 않게). 채팅에서 이벤트 사진을 보여줘야 하면 별도 설계 필요
- [ ] 이벤트 목록 API가 사용자별로 나뉘지 않음(전체 이벤트 반환 — 기존 구조, 단일 가구 전제)
- [ ] `storage.service.js` `uploadFile`의 기존 eslint 들여쓰기 에러 2건, 낡은 Jest 테스트 5건(`chat.test.js` 4, `app.test.js` 1)

---

## 6. 앱 TODO 9개 (2026-10-05, 단계 1→2→3 순서로 진행)

> 구현 방향·결정은 `hometalk_진행일지.md` 2026-10-05, 현재 상태는 `hometalk_인수인계.md` "알려진 이슈 / 남은 일".
> 체크 규칙: 코드 구현·단위 테스트가 끝나면 항목 앞에 "(코드 완료)"를 적고, **배포/실기 확인까지 끝나면** `[x]`로 체크한다.

### 단계 1 — 앱·백엔드 단독 (코드 완료, 배포 후 확인 대기)

- [ ] (코드 완료) **홈 위험 알림 수집 기준** — `type=danger`(낙상·화재경보·파손)만 집계
  - 확인: 홈 "위험 알림" 건수가 비명·울음(sound/warning)을 제외하고 세어지는지, 카드에 "낙상·화재경보·파손 기준" 문구가 보이는지
- [ ] (코드 완료) **채팅 목록 채팅방 이름 변경** — `PATCH /api/chat/history/:id`, 서랍 ✏️
  - 확인: 이름 변경 후 새로고침해도 유지, 40자 초과는 잘림, 빈 값은 저장 안 됨
- [ ] (코드 완료) **앱 전체 새로고침** — 아래로 당기기 + 홈 ↻ 버튼
  - 확인(모바일 실기기): 홈·이벤트·설정 탭 맨 위에서 당기면 갱신, 채팅 탭·모달·영상 위에서는 동작 안 함
- [ ] (코드 완료) **설정·홈화면 배경 높이 맞추기** — 두 헤더 `min-h-[112px]`
  - 확인: 모바일 폭에서 탭을 오갈 때 헤더 높이가 같은지 육안 확인
- [ ] (코드 완료) **영상만 볼 수 있게** — 영상이 있으면 소리 플레이어·🔊 뱃지 숨김
  - 확인: 영상 있는 이벤트(이벤트 탭 모달·채팅 카드)에 소리 플레이어가 없고 영상에서 소리가 나는지 / 영상 없는 옛 이벤트는 소리 재생 가능
- [ ] (코드 완료) **토큰 아끼기** — 히스토리 20개, 도구 루프 3회, 프롬프트 캐싱, `usage` 로그
  - 확인: Render Logs `[Claude] usage(chat) input=… cache_read=…` — `cache_read`가 0보다 큰 호출이 있는지(Haiku 최소 캐시 길이에 못 미치면 계속 0 — 그러면 캐싱은 효과 없음, 히스토리·루프 축소만 효과)
  - 확인: 도구가 필요한 질문("이번 주 요약")이 루프 3회 안에 정상 답변되는지

### 단계 2 — 이벤트 구분 + 영상 동봉 (미착수, 엣지/Pi 코드 변경)

- [ ] (코드 완료, 2026-10-09) **초인종·노크(소리) / 방문자 감지(영상) 따로 구분하기**
  - 소리 = `door_visitor`("초인종/노크 소리", YAMNet 초인종·딩동·노크), 영상 = `visitor_detected`("방문자 감지", YOLO). 둘 다 DB `type=visitor`(5종 CHECK라 추가 안 함)이고 `metadata.category_id`/`source`로 구분. 노크(353)는 원래 `door_visitor`에 포함돼 있었음
  - 확인(Pi): 현관 모드에서 초인종 → 이벤트 `초인종/노크 소리` 1건, 사람이 카메라 앞에 등장 → `방문자 감지` 1건(서로 쿨다운 독립). 카메라 서비스는 재시작해야 새 ID로 전송
  - 미착수: 앱 이벤트 라벨·아이콘·필터 구분(`web/src/lib/eventDisplay.js`가 지금은 `type`만 봄). 이전 DB의 `door_visitor` 이벤트에는 카메라 것도 섞여 있음
- [ ] (코드 완료, 2026-10-09: 녹화 중 요청 거절 → 진행 중인 영상 공유 `vision/sound_clip_share.py`) **소리 이벤트를 영상과 함께 전송** (현재 소리만 가는 경우 있음)
  - 확인(Pi): 낙상 녹화 중 비명 → 로그 `[SOUND REQUEST WAITING]` → `[SOUND CLIP SHARED]`, 두 이벤트 모두 `video_url` 채워짐 / 소리 이벤트 연달아 2건. 로그에 `(too old)`가 자주 보이면 `SOUND_REQUEST_MAX_AGE_SEC` 완화 검토, 카메라 서비스가 꺼져 있으면 영상 없음(정상)
  - 원인 후보: ① 카메라 프로세스가 꺼져 있음 ② 영상 요청이 3초 넘게 늦어 거절(`SOUND_REQUEST_MAX_AGE_SEC`) ③ 녹화 중이라 거절
  - 대응안: 요청 유효시간 완화, 녹화 중이면 거절 대신 진행 중 클립 공유, 둘 다 실패할 때만 wav 폴백
  - 실기: 소리 이벤트 발생 후 `events.video_url`이 채워지는지, 영상 없이 wav만 간 비율

### 단계 3 — 모드 + 경비 (2026-10-09 코드 완료, Pi/앱 실기 확인 대기)

구현 내용은 `hometalk_인수인계.md` "거실/현관 감지 모드 + 경비 모드". 경비 상태는 `notification_preferences`가 아니라 **`devices.security_armed`**에 저장한다(엣지가 하트비트로 읽어야 해서).

- [x] 수동 작업: Supabase `devices.mode`·`devices.security_armed` ALTER 실행 완료(사용자, 2026-10-09)
- [ ] (코드 완료) **거실 / 현관 모드** — 거실: 비명·고함·반려동물·아기 울음·화재경보·낙상 / 현관: 초인종·노크·문 열고 닫힘·택배·방문자 / 화재경보·유리 깨짐은 항상
  - 사전: 푸시·배포 후 Pi `git pull` + `sudo systemctl restart homecare-mic.service homecare-camera.service`
  - 확인(앱): 홈 카메라 카드 [거실][현관] 버튼이 눌리고 새로고침 후에도 유지되는지, 서버 오류 시 되돌아가고 안내 문구가 뜨는지. 모바일 폭에서 카드 높이·배치
  - 확인(Pi): 모드 전환 후 **20초 안에** 로그 `감지 모드 변경: living → entrance`. 현관 모드에서 초인종은 이벤트가 되고 비명·낙상은 안 생김, 거실 모드는 반대. 화재경보·유리는 두 모드 모두 감지
  - 확인(경계): 전환 직전에 서 있던 사람의 방문자 판정이 모드 전환 시점에 어떻게 되는지(카메라 감지기는 계속 돌고 이벤트만 거름)
  - 확인(장애): Render를 끄거나 네트워크를 끊어도 마지막 모드로 계속 감지하는지, 서비스 재시작 직후(첫 응답 전)에는 거실로 동작하는지
- [ ] (코드 완료) **경비 모드 푸시** — 경비 ON이면 `intrusion_suspect`·`door_left_open` 이벤트를 알림 토글과 무관하게 "🚨 침입 의심"으로 발송, OFF면 발송 안 함
  - 확인: 경비 ON 상태에서 해당 이벤트(실제 또는 `send_test_event`류로 `metadata.category_id` 지정) 후 푸시 수신, 위험 알림 토글이 꺼져 있어도 옴. 경비 OFF면 안 옴
  - 전제: 웹 푸시 설정(Supabase 테이블 + VAPID 환경변수, 인수인계 "웹 푸시 알림")이 끝나 있어야 함
- [ ] **경비+거실: 방 안 사람 감지 → 위급 알림** — 팀원 `vision/intrusion_detector.py`(`IntrusionDetector`, 이벤트 `intrusion_suspect`)가 `vision_pipeline.py`에 **아직 연결 안 됨**. 연결 시 거실 모드에서만 동작하도록 `guard_mode_client.is_armed() and mode_state.mode == "living"` 전달 필요
  - 확인: 경비 ON·거실에서 사람이 3프레임 이상 보이면 이벤트 1건 + 푸시, 같은 사람이 계속 있어도 중복 없음, 경비 OFF면 이벤트 없음
- [ ] **경비+현관: 문이 5분간 열려 있음 → 위급 알림** — 영상팀 담당, 미구현. 이벤트 `category_id`는 `door_left_open`
  - 확인: 문을 열어 두고 5분 뒤 푸시, 닫으면 타이머가 초기화되는지, 사람이 문 앞을 가려도 오탐이 없는지
- [ ] **vision 테스트 6건 수리** — `test_fall_detector.py` 5건(`FallDetector` 인자 변경), `test_pipeline_emit.py` 1건(`detected_vision_event`에 `intrusion_detected` 인자 추가)이 팀원 변경 이후 옛 시그니처로 에러
