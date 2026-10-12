# HomeCare vision 실행·배포 — TH

> 작성 / 최근 수정: 2026-10-12
> 명령어 참고 문서다. 아래 명령을 이번 문서 작업에서 실행하거나 배포하지 않았다.

## 1. 실행 환경

- 실행 위치: 라즈베리파이의 저장소 루트. 카메라는 Picamera2를 사용한다.
- Python 가상환경에서 `vision/requirements.txt`와 `edge/requirements.txt`에 해당하는 의존성이 준비되어야 한다. Picamera2가 가상환경에서 import 가능한지 별도 확인한다.
- 설정 파일은 Pi의 `edge/.env`. 값을 문서·로그·커밋에 복사하지 않는다.
- 카메라는 한 프로세스만 사용한다. 서비스 실행과 직접 실행을 동시에 하지 않는다.

기존 가상환경을 활성화한 뒤 실행한다.

```bash
# 저장소 루트에서
source .venv/bin/activate
python -c "import cv2, ultralytics, picamera2; print('OK')"
python -m vision.vision_pipeline
```

새 의존성 설치나 환경 재구성이 필요하면 팀과 먼저 범위를 확인한다.

## 2. 카메라 서비스

등록 파일: `edge/systemd/homecare-camera.service`. systemd는 Pi에서 프로그램을 서비스로 실행·관리하는 기능이다. 해당 파일의 사용자와 실행 경로가 실제 Pi 환경과 일치하는지 확인 후 사용한다.

```bash
sudo systemctl start homecare-camera.service
sudo systemctl stop homecare-camera.service
systemctl status homecare-camera.service
journalctl -u homecare-camera.service -f
```

필요할 때 켜고 끄는 운영 방식을 따른다. 부팅 시 자동 시작을 위한 `enable`은 기본 절차에 포함하지 않는다.

현재 화면 캡처 요청은 vision 서비스가 실행 중일 때 처리한다. 별도 사진 촬영 도구 `python -m edge.apps.capture_photo`는 카메라 서비스를 중지한 상태에서 사용한다.

## 3. 환경변수 이름

| 이름 | 용도 |
|---|---|
| `HOMECARE_BACKEND_URL` | 엣지가 전송할 백엔드 주소 |
| `HOMECARE_DEVICE_ID` | 기본 엣지 설정에 필요한 기기 ID |
| `HOMECARE_CAMERA_DEVICE_ID` | 카메라 이벤트·하트비트·경비 조회에 사용할 기기 ID |
| `EDGE_DEVICE_SECRET` | 기기 인증 비밀값 |
| `HOMECARE_EVENT_DIR` | 녹화 원본 저장 폴더; 상대 경로는 저장소 루트 기준 |
| `HOMECARE_CAMERA_ID` | 영상 메타데이터의 카메라 이름 |
| `HOMECARE_CAMERA_CHECK_INTERVAL_SEC` | 카메라 하트비트 간격 |

`HOMECARE_CAMERA_DEVICE_ID`는 DB의 **devices 행 ID**다. events 행 ID와 혼동하지 않는다. 저장 폴더 기본값은 `/mnt/ssd/events`이므로 해당 디스크가 없는 환경에서는 실제 쓰기 가능한 위치로 설정해야 한다.

## 4. 테스트

```bash
python -m unittest vision.tests.test_fall_detector vision.tests.test_fall_person_tracker vision.tests.test_delivery vision.tests.test_intrusion_wiring
python -m unittest discover -s vision/tests -t .
python -m unittest discover -s edge/tests -t .
```

vision 테스트는 하드웨어 연동 일부를 대체하므로 통과해도 실제 YOLO 추론·카메라·서버 전송 성공을 보장하지 않는다. 자세한 절차는 [테스트 TODO](hometalk_테스트_TODO.md)를 따른다.

2026-10-10 관련 낙상 테스트도 현재 PC의 일반·권한 확장 실행 모두 Python 시작 실패로 실행하지 못했다. 실행 가능한 환경에서 관련 테스트부터 검증하고 전체 vision 테스트를 진행한다.

### 낙상 설정 위치와 적용 전 확인

- `vision/vision_pipeline.py`: `FALL_DROP_WINDOW_SEC=0.8`, `FALL_DROP_RATIO=0.25`, `FALL_STABLE_SEC=0.8`, `FALL_CANDIDATE_TIMEOUT_SEC=2.5`.
- 박스 형태, 최소 하강 속도, 최소 관측 횟수, `max_gap_sec=0.6`, `missing_grace_sec=1.0`은 `vision/fall_detector.py` 기본값이다. 안정 반경은 판정에서 제거했다. 새 환경변수나 edge 변경은 필요하지 않다.
- 기존 픽셀·프레임 인자(`history_frames`, `drop_threshold`, `candidate_frames`, `movement_threshold`)는 새 감지기에서 사용하지 않는다. `backup_pipe.py`는 새 기본 생성 호출에 맞췄으며 실제 실행 진입점은 `vision.vision_pipeline`이다.
- Pi에서 관측 간격을 측정한 뒤 녹화 영상으로 오탐·미탐·알림 지연을 비교한다. 0.6초 초과 구간은 낮은 자세 관측 시간에서 제외하고 1초 초과 시 이력을 끊는다. 정면 낙상·가림과 의도적으로 눕기 구분은 보장하지 않는다.
- 택배는 `DeliveryDetector(confirm_sec=2.0, watch_sec=10.0, max_gap_sec=1.0)` 기본값과 파이프라인 `DELIVERY_REQUIRED_FRAMES=3`을 함께 사용한다. 실제 바닥에 맞게 `DELIVERY_OBJECT_ROI`를 조정한다. 점수는 밝기 차이 지표이며 택배일 확률이 아니다.
- 2026-10-12 Windows Python은 시작 실패. 기존 Ubuntu WSL Python 3.14에서 낙상/추적 35개 통과. 택배/파이프라인 테스트는 NumPy 미설치로 import 실패. 기존 `vision/requirements.txt` 의존성이 갖춰진 환경에서 나머지를 검증해야 하며 Pi 실기 확인 전 운영 준비 완료로 간주하지 않는다.
- 이 설정은 초기값이며 실기 검증이나 운영 반영 완료를 의미하지 않는다.

## 5. 코드 반영과 서버 연결

- PC에서 검토·테스트·커밋 후 승인된 push를 진행하고, Pi에서는 승인된 코드 받기 후 카메라 서비스를 재시작한다. Pi에서 별도 커밋하지 않는다.
- Pi 코드 반영과 Render 배포는 별개다. `main` push는 백엔드 Render 자동 배포도 유발한다.
- 백엔드: https://homecare-9kcu.onrender.com
- 프론트: https://homecare-9sr8.vercel.app/
- 외부 서비스 접근·push·운영 변경은 프로젝트 규칙에 따라 먼저 확인한다. 위 주소는 프로젝트 문서 기준이며 이번 작업에서 접속하지 않았다.
- 운영 DB 전체 스키마 실행, 인증 우회, 비밀값 출력은 하지 않는다.
