import os
import sys
import numpy as np
import soundfile as sf

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(SCRIPT_DIR), "core"))

from yamnet_core import load_yamnet, load_class_names, preprocess, infer  # noqa: E402


MEDIA_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "media")


def classify_audio(model, class_names, file_path):

    print()
    print("=" * 60)
    print("File:", os.path.basename(file_path))

    try:

        audio, sample_rate = sf.read(file_path)

        print("Original sample rate:", sample_rate)
        print(
            "Original audio length:",
            round(len(audio) / sample_rate, 2),
            "seconds"
        )

        if sample_rate != 16000:
            print("Resampling:", sample_rate, "Hz -> 16000 Hz")

        # Convert audio to 16 kHz mono
        audio = preprocess(audio, sample_rate)

        print("Converted sample rate: 16000 Hz")
        print(
            "Converted audio length:",
            round(len(audio) / 16000, 2),
            "seconds"
        )

        # YAMNet inference (프레임별 원본 출력)
        scores, embeddings, spectrogram = infer(model, audio)

        # Average scores from all frames (CLI 요약 출력용 — 프레임별 원본은
        # event_rules.py 쪽에서 필요할 때 infer()를 직접 호출해서 사용한다)
        mean_scores = np.mean(scores, axis=0)

        # Get Top 5 results
        top_indices = np.argsort(mean_scores)[::-1][:5]

        print()
        print("YAMNet result:")

        for rank, index in enumerate(top_indices, start=1):

            label = class_names[index]
            score = mean_scores[index]

            print(
                f"{rank}. {label}: {score:.4f}"
            )

    except Exception as e:

        print("Error:", e)


def main():

    print("Loading YAMNet...")

    model = load_yamnet()

    print("YAMNet loaded.")

    class_names = load_class_names(model)

    # Supported audio extensions
    audio_extensions = (
        ".wav",
        ".mp3",
        ".flac",
        ".ogg",
        ".m4a"
    )

    # Find all audio files
    files = []

    for filename in sorted(os.listdir(MEDIA_DIR)):

        file_path = os.path.join(
            MEDIA_DIR,
            filename
        )

        if os.path.isfile(file_path):

            if filename.lower().endswith(
                audio_extensions
            ):
                files.append(file_path)

    if not files:

        print(
            "No audio files found in:",
            MEDIA_DIR
        )

        return

    print()
    print("Found", len(files), "audio files.")

    # Classify every audio file
    for file_path in files:

        classify_audio(
            model,
            class_names,
            file_path
        )

    print()
    print("=" * 60)
    print("All files classified.")


if __name__ == "__main__":
    main()
