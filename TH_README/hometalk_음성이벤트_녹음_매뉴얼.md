# 음성 이벤트 데이터셋 녹음 매뉴얼

작성: 2026-10-15. 도구: `yamnet/record_dataset.py`.

## 1. 수집 방식

마이크는 실제 설치 위치에 고정하고 **소리가 나는 위치**를 좌측 → 우측 → 가운데로 옮겨 같은 이벤트를 각각 녹음한다. 좌우는 마이크에서 방을 바라보는 방향으로 정하고 바닥에 표시한다. 마이크 자체를 옮기는 실험이라면 `--note`에 그 사실을 적는다.

이벤트 한 종류당 최소 3개 파일이다. 기본은 준비 10초 + 녹음 15초. 한 파일에는 한 종류의 소리를 담는다. 여러 이벤트를 긴 파일 하나에 섞으면 나중에 구간별 정답을 별도로 작성해야 한다.

WAV는 압축하지 않은 오디오 파일이다. 기본 설정은 16kHz(초당 16,000개 샘플), 모노(1채널), PCM 16비트이며 YAMNet 입력에 맞춘 형식이다. 감지 여부와 관계없이 원음을 저장하며 모델 실행이나 서버 전송은 하지 않는다.

## 2. 준비 및 장치 확인

Pi의 기존 오디오 파이프라인용 가상환경을 활성화한다. 기존 의존성 `sounddevice`를 사용하며 새 패키지는 추가하지 않았다. 아래는 저장소가 `/homecare`이고 가상환경이 루트 `.venv`에 있을 때의 예시다. 가상환경 위치가 다르면 기존 실행 환경을 사용한다.

```bash
cd /homecare
source .venv/bin/activate
python3 yamnet/record_dataset.py --list-devices
```

목록에서 입력 채널이 있는 마이크의 번호를 찾는다. 아래 `--device 2`는 예시이므로 실제 번호로 바꾼다. 재부팅 후에는 번호가 바뀔 수 있다.

- 마이크를 사용 중인 스트리밍 프로그램/서비스를 중지하고 녹음한다. 실제 서비스 이름은 **확인 필요**이며 임의의 서비스 이름으로 중지 명령을 실행하지 않는다. 종료 후 기존 서비스를 다시 시작한다.
- 마이크 높이·방향·입력 게인·음원과의 거리를 세 위치에서 동일하게 유지하고 기록한다. 실험 중 자동 음량 조절 설정도 바꾸지 않는다.
- 녹음 동의를 받은 공간에서 진행한다. 알림음·키보드·진행자의 말이 섞이지 않도록 한다.
- 먼저 TEST를 녹음하고 Pi에서 재생해 마이크 선택과 소리 크기를 확인한다.

```bash
python3 yamnet/record_dataset.py TEST center --device 2 --seconds 5
```

출력된 WAV 경로를 사용해 `aplay "출력된 WAV 경로"`로 재생한다(설치되어 있는 경우). 무음·다른 마이크·심한 찢어짐이 있으면 설정을 수정한 뒤 재시험한다. TEST는 평가에서 제외한다.

## 3. 좌측 → 우측 → 가운데 녹음

예시는 비명/외침 이벤트다. 준비 카운트가 끝나고 `[REC]`가 표시되면 시작한다. 녹음에 신호음이 섞이지 않도록 프로그램은 비프음을 내지 않는다.

```bash
python3 yamnet/record_dataset.py scream_shout left --device 2 --note "distance=2m; source=human; room=living; gain=fixed"
python3 yamnet/record_dataset.py scream_shout right --device 2 --note "distance=2m; source=human; room=living; gain=fixed"
python3 yamnet/record_dataset.py scream_shout center --device 2 --note "distance=2m; source=human; room=living; gain=fixed"
```

각 명령은 앞 녹음을 끝내고 해당 위치로 이동한 뒤 실행한다. 15초 구성은 다음과 같이 맞춘다.

| 녹음 경과 | 행동 |
|---|---|
| 0~3초 | 조용히 대기 |
| 3~10초 | 해당 이벤트 소리 발생. 짧은 소리라면 간격을 두고 2~3회 |
| 10~15초 | 조용히 대기, 잔향 포함 |

실제 발생 시점은 사람이 WAV를 듣고 확인해야 한다. JSON의 `label`은 사용자가 입력한 **계획된 정답**이며 모델 판정이나 실제 발생 확인 결과가 아니다.

다른 종류도 `scream_shout` 부분을 원하는 라벨로 바꿔 세 명령을 반복한다. 라벨은 영문·숫자·밑줄·하이픈으로 최대 64자다. 예: `glass_impact`, `fire_alarm_siren`, `background`. 실제 평가 카테고리와의 매핑은 `yamnet/core/category_map.py`를 기준으로 별도 확인한다.

유리 파손이나 위험 상황을 실제로 만들지 말고 준비된 재생 음원을 이용한다. 재생한 경우 `source=speaker; source_id=clip01; volume=고정값`처럼 원본과 음량을 기록한다. 재생 음원과 실제 소리는 구분해서 평가한다. 비명을 무리하게 반복하지 않는다.

이벤트가 없는 대화·TV·발소리 등 배경/혼동 소리도 별도 라벨로 세 위치에서 수집한다. 조용한 배경은 `background`로 60초씩 녹음할 수 있다.

```bash
python3 yamnet/record_dataset.py background left --device 2 --seconds 60
python3 yamnet/record_dataset.py background right --device 2 --seconds 60
python3 yamnet/record_dataset.py background center --device 2 --seconds 60
```

## 4. 저장 결과 및 옵션

```text
/homecare/yamnet/dataset/
  scream_shout/
    left/    # WAV + 같은 이름의 JSON
    right/
    center/
  background/
    left/
    right/
    center/
```

저장 위치는 실행 디렉터리가 아니라 **스크립트 옆 `dataset/`** 기준이다. 저장소가 다른 위치에 있으면 그 위치의 `yamnet/dataset/`에 저장한다. 폴더는 자동 생성하며 파일명에 라벨·위치·시각·임의 식별자를 넣어 재녹음 파일도 따로 보관한다. 데이터 원본은 Git에서 제외한다.

JSON에는 라벨, 위치, 메모, 장치 이름, 녹음 시작/종료 시각(시간대 포함), 샘플레이트, 요청/실제 길이, 상태, 오디오 누락 횟수가 담긴다. 실제 길이는 저장한 샘플 수 기준이다.

| 옵션 | 용도 |
|---|---|
| `--seconds 30` | 녹음 길이 30초 |
| `--countdown 15` | 준비 시간 15초 (0도 가능) |
| `--samplerate 48000` | 16kHz를 지원하지 않는 장치에서 48kHz 원음 저장 |
| `--output-dir /저장할/폴더` | 기본 데이터셋 폴더 대신 다른 위치에 저장 |
| `--note "..."` | 거리·장소·발생 방식·음원 ID·게인·예외 상황 기록 |

48kHz로 저장한 경우 이 도구는 변환하지 않는다. 추론할 때 기존 `yamnet/core/yamnet_core.py`의 전처리를 거쳐 16kHz로 변환한다. 특정 마이크의 지원 샘플레이트와 Pi에서의 실제 녹음은 **확인 필요**다.

## 5. 검수·중단·평가 준비

1. 매 녹음 후 `[complete]`인지 확인하고 WAV를 들어서 목표 소리가 들어갔는지 확인한다. `complete`는 저장 완료만 뜻하며 음질을 보증하지 않는다.
2. `overflow`는 입력을 제때 읽지 못해 일부 소리가 누락된 상태다. 부하를 줄이고 재녹음한다. `interrupted`는 Ctrl+C 중단, `error`는 장치/저장 오류다. 이 파일은 정상 평가 데이터에서 제외한다. 녹음 도중 중단은 가능한 분량과 JSON을 남기지만 전원 차단·디스크 고갈 시 파일 보존은 보장하지 않는다.
3. 앞뒤 여백·무음·클리핑(소리가 너무 커 찢어지는 현상)·다른 소리 혼입을 확인한다. 실패 파일은 JSON 메모나 별도 검수표에 이유를 기록하고 새 파일로 재녹음한다.
4. 위치별 개수와 라벨을 맞춘 후 WAV와 JSON을 함께 백업한다. Git push로 데이터가 백업되지는 않는다.
5. 같은 재생 원본을 세 위치에서 녹음한 파일은 학습/조정용과 최종 평가용에 나눠 넣지 않는다. 같은 음원이 양쪽에 들어가 평가 점수가 과장될 수 있으므로 원본 음원/촬영 세션 단위로 묶어서 나눈다. 위치별 1개씩은 수집 시작용이며 신뢰할 만한 성능 평가에는 여러 음원·사람·거리·날짜의 반복이 필요하다.

기존 `verification/mediatest.py`는 `yamnet/media/`를 대상으로 하므로 새 `dataset/`을 자동 평가하지 않는다. 이번 도구의 범위는 원음 수집이며 일괄 평가 연결은 별도 작업이다.
