# edge/ — 라즈베리파이 이벤트 전송 코드

> 최근 수정일시: 2026-09-22 (`stream_pipeline.py` 작성 — 마이크/파일 → YAMNet → 판정 → emit() 연결, Pi 실기 미검증)

라즈베리파이(엣지)에서 감지한 이벤트(소리, 이후 영상)를 **HomeCare 백엔드(`POST /api/events`)로 안전하게 보내는** 코드입니다.
소리 감지(`stream_pipeline.py` + `yamnet/core/`)는 이 폴더 안에 있고, YOLO 등 영상 감지기는 아직 없습니다. 감지기가 `emitter.emit()`만 호출하면 나머지(변환/쿨다운/큐/재시도)는 이 폴더가 담당합니다.

## 동작 방식

```
감지기
  ├─ stream_pipeline.py (완료) — 마이크/파일 → YAMNet 추론 → event_rules 판정
  └─ YOLO 등 (미구현)
   │  emitter.emit("glass_impact", source="yamnet", score=0.87, audio_path=...)
   ▼
event_mapper  ── category_id → 백엔드 type / dangerLevel 변환
cooldown      ── 같은 이벤트 연속 억제
outbox        ── SQLite 큐에 먼저 저장 (edge/data/, git 제외)
   ▼
sender (백그라운드 스레드) ── POST /api/events, 실패 시 지수 백오프 재시도
   ▼
Render 백엔드 → Supabase events 테이블
```

이벤트를 큐에 먼저 적어 두기 때문에 인터넷 단절, Render 유휴 지연(무료 플랜 첫 요청 20초대), Pi 재부팅이 있어도 이벤트를 잃지 않습니다.
`emit()`은 네트워크를 기다리지 않고 바로 반환합니다.

## 파일 구성

| 파일 | 역할 |
|---|---|
| `stream_pipeline.py` | 마이크(또는 wav 파일) → `yamnet/core/` 추론 → `event_rules` 판정 → 트리거되면 `emit()` 호출까지 연결하는 엔드투엔드 스크립트 (Pi 실기 미검증) |
| `emit.py` | 공통 진입점 `EventEmitter`. 감지기는 `emit()`만 호출하면 됨 |
| `event_mapper.py` | 카테고리 → 백엔드 `type`/`dangerLevel`/쿨다운 변환표 (수정은 `SPECS`만) |
| `cooldown.py` | 같은 `(source, category)` 재전송 억제 (메모리, 재시작 시 초기화) |
| `outbox.py` | SQLite 전송 대기 큐 + 첨부 파일 복사본 보관 |
| `sender.py` | 큐 → 백엔드 전송, 응답 코드별 재시도/폐기 처리 |
| `config.py` | `edge/.env` 또는 환경변수 로드 (시크릿은 출력되지 않음) |
| `send_test_event.py` | 가짜 이벤트 1건을 보내 전송 경로를 점검하는 스크립트 |
| `tests/` | 단위 테스트 (18개) |
| `.env.example`, `requirements.txt` | 설정 예시, 의존성(`requests`, `stream_pipeline.py`용 `sounddevice`/`tensorflow` 등) |

## Pi에서 사용하기

```bash
# 1) 코드 받기 (최초 1회, 필요한 폴더만)
git clone --filter=blob:none --no-checkout https://github.com/soheei/homecare.git
cd homecare && git sparse-checkout set edge yamnet/core && git checkout main
# 업데이트: git pull

# 2) 가상환경 + 의존성 (시스템 pip은 PEP 668로 막혀 있음)
python3 -m venv .venv
source .venv/bin/activate
pip install -r edge/requirements.txt

# 3) 설정
cp edge/.env.example edge/.env
nano edge/.env

# 4) 전송 경로 점검
python -m edge.send_test_event

# 5) 마이크 인식 확인 후 (arecord -l), 실시간 파이프라인 실행
python -m edge.stream_pipeline --list-devices
python -m edge.stream_pipeline --device <번호>
```

| 환경변수 | 설명 |
|---|---|
| `HOMECARE_BACKEND_URL` | 백엔드 주소 (끝에 `/` 없이) |
| `HOMECARE_DEVICE_ID` | Supabase **`devices`** 테이블 행의 id(UUID). `events` 행의 id가 아님 |
| `EDGE_DEVICE_SECRET` | 백엔드(Render)의 `EDGE_DEVICE_SECRET`과 같은 값 |
| `EDGE_REQUEST_TIMEOUT` | (선택) 전송 타임아웃 초, 기본 60 |
| `EDGE_OUTBOX_DIR` | (선택) 큐 저장 폴더, 기본 `edge/data` |

테스트: 저장소 루트에서 `python -m unittest discover -s edge/tests -t .`

## 전송 규칙

| 백엔드 응답 | 처리 |
|---|---|
| 200/201 | 성공, 큐에서 삭제 (응답 id가 `temp_`로 시작하면 저장 안 된 것으로 보고 재시도) |
| 401/403 | 큐에 유지하고 재시도 (`HOMECARE_DEVICE_ID` / `EDGE_DEVICE_SECRET` 확인) |
| 408/429/5xx/네트워크 오류 | 지수 백오프(5초→최대 15분) 재시도, 최대 50회 후 dead |
| 그 외 4xx (400, 413 등) | dead 처리 (payload 자체가 잘못됨) |

- 이벤트마다 `metadata.event_uid`를 넣습니다. 응답이 유실된 뒤 재시도하면 **같은 이벤트가 두 번 저장될 수 있는데**(백엔드에 중복 제거 없음), 이 값으로 걸러낼 수 있습니다.
- 첨부(`image`/`audio`/`video`)는 multipart로 전송되며 백엔드가 Supabase Storage `events` 버킷에 올립니다. 버킷 존재 여부는 **확인 필요**.

## TODO

### 완료
- [x] 전송 모듈: `emit`, `event_mapper`, `cooldown`, `outbox`, `sender`, `config`
- [x] 단위 테스트 15개, 로컬 임시 서버로 JSON/multipart 실제 전송 확인
- [x] Pi → Render 백엔드 실전송 검증 (`send_test_event`, 실제 UUID로 저장 확인, 2026-09-20)

### 다음 (엣지 2단계)
- [x] **마이크 → YAMNet → 판정 → `emit()` 파이프라인** (`edge/stream_pipeline.py`, 2026-09-22)
  - 오디오 캡처: `sounddevice` 채택 (사용자 승인). 추론 런타임: TensorFlow 유지(Pi 설치 실패 시 TFLite 검토)
  - `edge/tests/test_stream_pipeline.py`로 버퍼링·판정·emit 연결 로직 검증(가짜 추론 함수 주입, TF/sounddevice 불필요)
  - **Pi에서 확인 필요**: 마이크 인식(`arecord -l`), TensorFlow 설치 가능 여부, 기본 샘플레이트가 16kHz가 아니면 `--samplerate`로 조정, 실제 소리로 이벤트가 잡히는지
- [ ] `yamnet/core/event_rules.py`에 threshold 튜닝값 반영 (Plan.md §9: 실측값은 나왔지만 `CATEGORY_RULE_CONFIG`엔 아직 미반영)
- [ ] 판정 전후 3~5초 오디오 클립을 저장해 `audio_path`로 첨부 (Storage `events` 버킷 확인 후)
- [ ] 부팅 시 자동 실행 (systemd 서비스, 실행 경로는 `.venv/bin/python`)
- [ ] Pi 실측: 처리 속도(RTF)와 전력 (Plan.md 7단계)

### 이후
- [ ] YOLO 연동 — 감지기 완성 후 `event_mapper.SPECS`에 category 추가하고 `emit(..., image_path=...)` 호출 (YOLO는 현재 미완성)
- [ ] heartbeat 전송 (`POST /api/devices/:id/heartbeat`) — 지금은 `devices.status`가 계속 `offline`
- [ ] 알림 정책 가드 (Plan.md 5단계): locked 카테고리 무음 방지 등. 쿨다운 일부는 `cooldown.py`에서 이미 처리
- [ ] `dead` 이벤트 확인/정리 도구, 큐·첨부 디스크 용량 상한
- [ ] 중복 이벤트(`event_uid`) 처리를 조회 쪽(백엔드/웹)에 반영할지 결정

### 팀 결정 필요
- [ ] `event_mapper.py` 변환표 확정 (카테고리별 `type`/`dangerLevel`/쿨다운). 지금 값은 기본안이며 `fall_suspect`·`baby_person_distress`는 Plan.md §9 확정값(높음)을 따름
- [ ] DB에 남아 있는 테스트 이벤트(`[테스트] 엣지 전송 확인`)와 `schema.sql` 샘플 데이터 정리
