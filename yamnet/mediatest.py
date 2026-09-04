import os
import numpy as np
import soundfile as sf
import tensorflow_hub as hub
from scipy.signal import resample_poly


MEDIA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "media")


def load_class_names(model):
    class_map_path = model.class_map_path().numpy()

    class_names = []

    with open(class_map_path, "r") as f:
        for line in f:
            line = line.strip()

            if line:
                class_names.append(line)

    return class_names


def convert_to_16khz_mono(audio, sample_rate):

    # Stereo -> Mono
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)

    audio = audio.astype(np.float32)

    # Resample to 16 kHz
    if sample_rate != 16000:

        print(
            "Resampling:",
            sample_rate,
            "Hz -> 16000 Hz"
        )

        audio = resample_poly(
            audio,
            16000,
            sample_rate
        )

    return audio


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

        # Convert audio to 16 kHz mono
        audio = convert_to_16khz_mono(
            audio,
            sample_rate
        )

        print("Converted sample rate: 16000 Hz")
        print(
            "Converted audio length:",
            round(len(audio) / 16000, 2),
            "seconds"
        )

        # YAMNet inference
        scores, embeddings, spectrogram = model(audio)

        scores = scores.numpy()

        # Average scores from all frames
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

    model = hub.load(
        "https://tfhub.dev/google/yamnet/1"
    )

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
