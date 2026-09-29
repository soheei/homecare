# HomeCare 실기 테스트 TODO + 남은 수정사항

> 작성일시: 2026-09-28
> 최근 수정일시: 2026-09-28 (카메라 서비스를 vision으로 통합 — 3-1·3-5·5번 갱신 / 최초 작성 — 엣지 폴더 재구성, 서명 URL, 소리 반복 전송 수정, 방문자·택배 감지 재설계 이후 실기 확인 목록)
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
- [ ] Pi 원본 정리: 이벤트 전송 로그(`전송 완료 uid=…`) 뒤 `ls -R ~/homecare/edge/data/events`에 그 영상·썸네일이 **없어야** 함. 전송 대기 중(`edge/data/vision/`)엔 남아 있음
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
