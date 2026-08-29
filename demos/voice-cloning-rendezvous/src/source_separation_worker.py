#!/usr/bin/env python3

import argparse
import json
import time
from pathlib import Path

import numpy as np
import sherpa_onnx
import soundfile as sf


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Separate a video soundtrack into vocal and background stems."
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--provider", choices=("cpu", "cuda"), required=True)
    parser.add_argument("--threads", type=int, default=2)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    samples, sample_rate = sf.read(
        args.input, dtype="float32", always_2d=True
    )
    samples = np.ascontiguousarray(np.transpose(samples))
    config = sherpa_onnx.OfflineSourceSeparationConfig(
        model=sherpa_onnx.OfflineSourceSeparationModelConfig(
            uvr=sherpa_onnx.OfflineSourceSeparationUvrModelConfig(
                model=str(args.model)
            ),
            num_threads=args.threads,
            debug=False,
            provider=args.provider,
        )
    )
    if not config.validate():
        raise ValueError("Invalid sherpa-onnx source-separation configuration")

    separator = sherpa_onnx.OfflineSourceSeparation(config)
    started = time.perf_counter()
    result = separator.process(sample_rate=sample_rate, samples=samples)
    elapsed_seconds = time.perf_counter() - started
    if len(result.stems) != 2:
        raise RuntimeError(f"Expected two stems, received {len(result.stems)}")

    # UVR-MDX instrumental models return accompaniment first and vocals second.
    background = np.transpose(result.stems[0].data)
    vocals = np.transpose(result.stems[1].data)
    vocals_path = args.output / "vocals.wav"
    background_path = args.output / "background.wav"
    sf.write(vocals_path, vocals, result.sample_rate, subtype="PCM_16")
    sf.write(background_path, background, result.sample_rate, subtype="PCM_16")

    duration_seconds = samples.shape[1] / sample_rate
    report = {
        "model": args.model.name,
        "provider": args.provider,
        "sampleRate": result.sample_rate,
        "durationSeconds": duration_seconds,
        "elapsedSeconds": elapsed_seconds,
        "rtf": elapsed_seconds / duration_seconds,
    }
    (args.output / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
