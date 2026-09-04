# mediatest.py 설명서

`mediatest.py`는 구글의 사전학습 오디오 분류 모델인 **YAMNet**을 사용해서,
`media/` 폴더에 있는 오디오 파일들이 각각 어떤 소리(유리 깨지는 소리, 아기 울음소리, 문 두드리는 소리 등)인지
자동으로 분류하고 결과를 출력하는 스크립트입니다.

## 1. 전체 동작 흐름

1. TensorFlow Hub에서 YAMNet 모델을 다운로드/로드한다.
2. YAMNet이 인식할 수 있는 소리 클래스 이름 목록(521개)을 불러온다.
3. `media/` 폴더에서 지원하는 확장자의 오디오 파일을 모두 찾는다.
4. 각 파일을 하나씩 읽어서
   - 모노(mono) + 16kHz 형식으로 변환한 뒤
   - YAMNet 모델에 입력해서 추론(inference)을 수행하고
   - 가장 확률이 높은 상위 5개 클래스를 출력한다.

실행하면 아래처럼 파일마다 결과가 출력됩니다.

```
Loading YAMNet...
YAMNet loaded.

Found 12 audio files.

============================================================
File: glass-break-1.mp3
Original sample rate: 44100
Original audio length: 1.23 seconds
Converted sample rate: 16000 Hz
Converted audio length: 1.23 seconds

YAMNet result:
1. Glass: 0.8123
2. Breaking: 0.4021
3. ...
```

## 2. 코드 구조 (함수별 설명)

### `MEDIA_DIR`
분류할 오디오 파일들이 들어있는 폴더 경로. 스크립트 위치 기준 상대경로(`media/`)로 계산됩니다.
이 폴더 안의 파일들이 분석 대상이 됩니다.

### `load_class_names(model)`
YAMNet 모델 안에는 "0번은 Speech, 1번은 Music, ..." 처럼 인덱스와 소리 이름을 매핑한
CSV 파일(`class_map_path`)이 내장되어 있습니다. 이 함수는 그 파일을 열어서
클래스 이름들을 리스트로 반환합니다. (나중에 모델이 뱉는 숫자 인덱스를 사람이 읽을 수 있는
이름으로 바꾸는 데 사용됩니다.)

### `convert_to_16khz_mono(audio, sample_rate)`
YAMNet은 **16kHz, 모노(1채널)** 오디오만 입력으로 받을 수 있습니다. 실제 오디오 파일은
샘플레이트나 채널 수가 제각각이므로 이를 표준 형식으로 변환하는 전처리 함수입니다.

- 스테레오(2채널 이상)면 채널을 평균 내서 모노로 합침 (`np.mean(axis=1)`)
- 샘플레이트가 16000Hz가 아니면 `scipy.signal.resample_poly`로 리샘플링

### `classify_audio(model, class_names, file_path)`
파일 하나를 실제로 분류하는 핵심 함수입니다.

1. `soundfile`로 오디오 파일을 읽음 (`audio`, `sample_rate`)
2. `convert_to_16khz_mono`로 전처리
3. `scores, embeddings, spectrogram = model(audio)` 로 YAMNet 추론 실행
   - `scores`: 오디오를 짧은 프레임 단위로 쪼갠 뒤, 프레임마다 521개 클래스에 대한 확률 점수
   - `embeddings`, `spectrogram`은 이 스크립트에서는 사용하지 않음 (버려짐)
4. 모든 프레임의 점수를 평균내서(`np.mean(scores, axis=0)`) 파일 전체에 대한 대표 점수 계산
5. 점수가 높은 순으로 정렬해 **상위 5개 클래스와 점수를 출력**
6. 파일 읽기 실패 등 예외가 발생하면 에러 메시지만 출력하고 다음 파일로 진행 (`try/except`)

### `main()`
전체 실행 흐름을 담당합니다.

1. YAMNet 모델 로드 (`hub.load("https://tfhub.dev/google/yamnet/1")`)
   - 최초 실행 시 인터넷에서 모델을 다운로드하므로 네트워크 연결이 필요합니다.
2. 클래스 이름 로드
3. `MEDIA_DIR` 안에서 지원 확장자(`.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`)를 가진 파일만 추려서 리스트업
4. 파일이 하나도 없으면 안내 메시지 출력 후 종료
5. 찾은 파일들을 하나씩 `classify_audio`로 분류

## 3. 사용된 주요 라이브러리

| 라이브러리 | 역할 |
|---|---|
| `numpy` | 배열 연산 (평균, 정렬 등) |
| `soundfile` | 오디오 파일(wav/flac/ogg 등) 읽기 |
| `tensorflow_hub` | 사전학습된 YAMNet 모델 다운로드/로드 |
| `scipy.signal.resample_poly` | 샘플레이트 변환(리샘플링) |

## 4. 실행 방법

```bash
python mediatest.py
```

필요한 패키지가 없다면 먼저 설치합니다.

```bash
pip install numpy soundfile tensorflow tensorflow_hub scipy
```

> 참고: `.mp3`, `.m4a` 파일은 시스템에 `libsndfile`이 해당 포맷을 지원하지 않으면
> `soundfile`이 읽지 못할 수 있습니다. 이 경우 `classify_audio`의 예외 처리 구문에
> 에러 메시지가 출력됩니다.

## 5. YAMNet이란?

[YAMNet](https://tfhub.dev/google/yamnet/1)은 AudioSet 데이터셋(유튜브 오디오 클립)으로 학습된
구글의 오디오 이벤트 분류 모델로, 사람 말소리·음악·동물 소리·기계 소리 등 총 521개 클래스를 구분할 수 있습니다.
이 스크립트는 그 중에서도 유리 깨짐, 아기 울음, 화재경보, 문 두드림 같은
**보안/이상 소음 감지**용 샘플 오디오들을 테스트하는 용도로 보입니다 (`media/` 폴더 파일명 기준).
