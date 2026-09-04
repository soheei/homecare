"""
yamnet_core.py — YAMNet 로드/전처리/추론 재사용 함수 (Plan.md 1단계)

mediatest.py(CLI), evaluate.py/stream_pipeline.py(예정)가 공통으로 쓰는 최소
단위 함수만 담는다. 파일 순회, 로그 출력 같은 스크립트별 관심사는 각자 남겨둔다.

infer()는 프레임 평균을 내지 않고 원본 프레임별 출력을 그대로 반환한다 —
event_rules.py의 규칙 함수들이 프레임 단위 scores 행렬(shape: [num_frames, 521])을
필요로 하기 때문 (mean-pooling은 CLI 출력을 위해 mediatest.py 쪽에서 따로 한다).
"""

import numpy as np
from scipy.signal import resample_poly

TARGET_SAMPLE_RATE = 16000


def load_yamnet():
    import tensorflow_hub as hub

    return hub.load("https://tfhub.dev/google/yamnet/1")


def load_class_names(model):
    class_map_path = model.class_map_path().numpy()

    class_names = []

    with open(class_map_path, "r") as f:
        for line in f:
            line = line.strip()

            if line:
                class_names.append(line)

    return class_names


def preprocess(audio, sample_rate):
    """임의의 sample_rate/채널 오디오를 YAMNet 입력 형식(16kHz mono float32)으로 변환."""

    # Stereo -> Mono
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)

    audio = audio.astype(np.float32)

    # Resample to 16 kHz
    if sample_rate != TARGET_SAMPLE_RATE:
        audio = resample_poly(audio, TARGET_SAMPLE_RATE, sample_rate)

    return audio


def infer(model, audio):
    """전처리된(16kHz mono) audio를 YAMNet에 통과시켜 프레임별 원본 출력을 반환.

    Returns:
        scores: (num_frames, 521) — 프레임별 클래스 점수
        embeddings: (num_frames, 1024)
        spectrogram: (num_frames, 64)
    """
    scores, embeddings, spectrogram = model(audio)

    return scores.numpy(), embeddings.numpy(), spectrogram.numpy()
