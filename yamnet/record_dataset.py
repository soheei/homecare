"""Record labeled microphone WAVs locally, without inference or uploading."""

import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import sys
import time
import uuid
import wave


DEFAULT_OUTPUT = Path(__file__).resolve().parent / "dataset"


def positive_int(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("label", nargs="?", help="Event label, e.g. scream_shout or background")
    p.add_argument("position", nargs="?", choices=("left", "right", "center"))
    p.add_argument("--seconds", type=positive_int, default=8)
    p.add_argument("--countdown", type=int, default=10)
    p.add_argument("--samplerate", type=positive_int, default=16000)
    p.add_argument("--device", help="Input device index or name")
    p.add_argument("--list-devices", action="store_true")
    p.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    p.add_argument("--note", default="", help="Distance, source, room, gain, etc.")
    return p


def record(args, sd):
    device = int(args.device) if args.device and args.device.isdecimal() else args.device
    sd.check_input_settings(device=device, channels=1, dtype="int16", samplerate=args.samplerate)
    device_info = sd.query_devices(device, "input")
    folder = args.output_dir.resolve() / args.label / args.position
    folder.mkdir(parents=True, exist_ok=True)
    stem = f"{args.label}_{args.position}_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}"
    path = folder / (stem + ".wav")
    metadata = {
        "label": args.label, "position": args.position, "note": args.note,
        "wav": path.name, "sample_rate": args.samplerate, "channels": 1,
        "sample_width_bytes": 2, "requested_seconds": args.seconds,
        "device": device_info["name"], "status": "incomplete",
        "overflow_blocks": 0, "frames": 0,
    }
    for remaining in range(args.countdown, 0, -1):
        print(f"[READY] {remaining}s", flush=True)
        time.sleep(1)
    try:
        with path.open("xb") as raw, wave.open(raw, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(args.samplerate)
            with sd.RawInputStream(device=device, channels=1, dtype="int16",
                                   samplerate=args.samplerate) as stream:
                metadata["started_at"] = datetime.now().astimezone().isoformat()
                print("[REC] Start (no beep).", flush=True)
                target = args.seconds * args.samplerate
                while metadata["frames"] < target:
                    count = min(4096, target - metadata["frames"])
                    data, overflow = stream.read(count)
                    pcm = bytes(data)
                    if sys.byteorder != "little":
                        from array import array
                        samples = array("h", pcm)
                        samples.byteswap()
                        pcm = samples.tobytes()
                    wav.writeframesraw(pcm)
                    metadata["frames"] += len(pcm) // 2
                    metadata["overflow_blocks"] += int(overflow)
                metadata["status"] = "overflow" if metadata["overflow_blocks"] else "complete"
    except KeyboardInterrupt:
        metadata["status"] = "interrupted"
    except Exception as exc:
        metadata["status"] = "error"
        metadata["error"] = str(exc)
        raise
    finally:
        metadata["ended_at"] = datetime.now().astimezone().isoformat()
        metadata["actual_seconds"] = metadata["frames"] / args.samplerate
        path.with_suffix(".json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[{metadata['status']}] {path} ({metadata['actual_seconds']:.2f}s)", flush=True)
    return 0 if metadata["status"] == "complete" else 1


def main(argv=None):
    p = parser()
    args = p.parse_args(argv)
    if not args.list_devices:
        if not args.label or not args.position:
            p.error("label and position are required")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", args.label):
            p.error("label must be 1-64 ASCII letters, digits, underscores or hyphens")
        if args.countdown < 0:
            p.error("countdown must be >= 0")
    try:
        import sounddevice as sd
        if args.list_devices:
            print(sd.query_devices())
            return 0
        return record(args, sd)
    except KeyboardInterrupt:
        print("Cancelled before recording.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"Recording failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
