from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import soundfile as sf
import torch

from benchmark_voice_model import load_model, synchronize


def emit(event: dict[str, object]) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def atempo_chain(ratio: float) -> str:
    if ratio <= 0:
        raise ValueError("tempo ratio must be positive")
    filters: list[str] = []
    remaining = ratio
    while remaining > 2:
        filters.append("atempo=2")
        remaining /= 2
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    filters.append(f"atempo={remaining:.9f}")
    return ",".join(filters)


def fit_to_timeline(
    ffmpeg: Path,
    source: Path,
    target: Path,
    raw_seconds: float,
    target_seconds: float,
) -> None:
    tempo = raw_seconds / target_seconds
    filter_graph = (
        f"{atempo_chain(tempo)},"
        f"apad=pad_dur={target_seconds:.6f},"
        f"atrim=0:{target_seconds:.6f}"
    )
    process = subprocess.run(
        [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-af",
            filter_graph,
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(target),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError(f"FFmpeg duration fit failed: {process.stderr[-4000:]}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate one adaptive reverse-suffix voice track",
    )
    parser.add_argument(
        "--model-id",
        choices=["voxcpm15", "voxcpm2", "f5tts"],
        required=True,
    )
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--reference-text", type=Path, required=True)
    parser.add_argument("--cues", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    args = parser.parse_args()

    if not torch.cuda.is_available():
        parser.error("CUDA is required for this three-model experiment")
    for path in [args.reference, args.reference_text, args.cues, args.ffmpeg]:
        if not path.exists():
            parser.error(f"required input does not exist: {path}")

    payload = json.loads(args.cues.read_text(encoding="utf-8"))
    cues = payload.get("cues")
    if not isinstance(cues, list) or not cues:
        parser.error("cues JSON must contain a non-empty cues array")
    prompt_text = args.reference_text.read_text(encoding="utf-8").strip()
    if not prompt_text:
        parser.error("reference transcript cannot be empty")

    args.output.mkdir(parents=True, exist_ok=True)
    torch.set_float32_matmul_precision("high")
    torch.cuda.reset_peak_memory_stats()
    model_args = SimpleNamespace(
        model_id=args.model_id,
        models=args.models,
        reference=args.reference,
        optimize=False,
    )

    load_started = time.perf_counter()
    model = load_model(model_args, prompt_text)
    synchronize()
    emit(
        {
            "type": "model-loaded",
            "loadSeconds": time.perf_counter() - load_started,
            "peakCudaMemoryBytes": torch.cuda.max_memory_allocated(),
        }
    )

    for index, cue in enumerate(cues):
        cue_id = str(cue.get("id", "")).strip()
        text = str(cue.get("spokenText") or cue.get("text", "")).strip()
        start_ms = int(cue.get("startMs", -1))
        end_ms = int(cue.get("endMs", -1))
        if not cue_id or not text or start_ms < 0 or end_ms <= start_ms:
            raise ValueError(f"invalid target cue at index {index}")

        synchronize()
        started = time.perf_counter()
        waveform, first_chunk_seconds = model.generate(text, 10_000 + index)
        synchronize()
        generation_seconds = time.perf_counter() - started
        raw_output_seconds = waveform.size / model.sample_rate
        if raw_output_seconds <= 0:
            raise RuntimeError(f"{args.model_id} generated empty audio for {cue_id}")

        raw_path = args.output / f".{cue_id}.raw.wav"
        output_name = f"{cue_id}.wav"
        output_path = args.output / output_name
        sf.write(raw_path, waveform, model.sample_rate)
        timeline_seconds = (end_ms - start_ms) / 1000
        try:
            fit_to_timeline(
                args.ffmpeg,
                raw_path,
                output_path,
                raw_output_seconds,
                timeline_seconds,
            )
        finally:
            raw_path.unlink(missing_ok=True)

        emit(
            {
                "type": "cue-complete",
                "cueId": cue_id,
                "file": output_name,
                "generationSeconds": generation_seconds,
                "rawOutputSeconds": raw_output_seconds,
                "timelineSeconds": timeline_seconds,
                "timelineRtf": generation_seconds / timeline_seconds,
                "rawRtf": generation_seconds / raw_output_seconds,
                "firstChunkSeconds": first_chunk_seconds,
                "peakCudaMemoryBytes": torch.cuda.max_memory_allocated(),
            }
        )


if __name__ == "__main__":
    main()
