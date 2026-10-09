# HomeCare vision 실행·배포 — TH

> 작성 / 최근 수정: 2026-10-09
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
python -m unittest discover -s vision/tests -t .
python -m unittest discover -s edge/tests -t .
```

vision 테스트는 하드웨어 연동 일부를 대체하므로 통과해도 실제 YOLO 추론·카메라·서버 전송 성공을 보장하지 않는다. 자세한 절차는 [테스트 TODO](hometalk_테스트_TODO.md)를 따른다.

2026-10-09 현재 PC에서는 Python 실행 실패로 테스트를 시작하지 못했다. 실행 가능한 환경에서 다시 검증해야 한다.

## 5. 코드 반영과 서버 연결

- PC에서 검토·테스트·커밋 후 승인된 push를 진행하고, Pi에서는 승인된 코드 받기 후 카메라 서비스를 재시작한다. Pi에서 별도 커밋하지 않는다.
- Pi 코드 반영과 Render 배포는 별개다. `main` push는 백엔드 Render 자동 배포도 유발한다.
- 백엔드: https://homecare-9kcu.onrender.com
- 프론트: https://homecare-9sr8.vercel.app/
- 외부 서비스 접근·push·운영 변경은 프로젝트 규칙에 따라 먼저 확인한다. 위 주소는 프로젝트 문서 기준이며 이번 작업에서 접속하지 않았다.
- 운영 DB 전체 스키마 실행, 인증 우회, 비밀값 출력은 하지 않는다.
