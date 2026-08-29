from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import soundfile as sf


EXPECTED_MODELS = {"voxcpm15", "voxcpm2", "f5tts"}
SHORT_CASES = {"zh-one-shot": 1, "en-one-shot": 1}
LONG_CASE = {"long-run-bilingual": 64}


def require(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def inspect_audio(path: Path, expected_seconds: float, failures: list[str], warnings: list[str]) -> dict[str, float | int]:
    if not path.is_file():
        failures.append(f"missing audio: {path}")
        return {}

    try:
        audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    except Exception as error:  # noqa: BLE001 - validator must preserve all failures
        failures.append(f"unreadable audio {path}: {error}")
        return {}

    require(audio.shape[0] > 0, f"empty audio: {path}", failures)
    require(audio.shape[1] == 1, f"audio is not mono: {path}", failures)
    require(sample_rate > 0, f"invalid sample rate: {path}", failures)
    require(np.isfinite(audio).all(), f"non-finite samples: {path}", failures)
    duration = audio.shape[0] / sample_rate
    require(abs(duration - expected_seconds) < 0.08, f"duration mismatch: {path}", failures)

    absolute = np.abs(audio)
    peak = float(absolute.max()) if absolute.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)))) if absolute.size else 0.0
    silence = float(np.mean(absolute < 1e-4)) if absolute.size else 1.0
    clipping = float(np.mean(absolute >= 0.999)) if absolute.size else 0.0
    require(peak > 1e-3 and rms > 1e-4, f"effectively silent audio: {path}", failures)
    require(silence < 0.99, f"more than 99% near-silence: {path}", failures)
    require(clipping < 0.20, f"more than 20% clipped samples: {path}", failures)
    if clipping >= 0.01:
        warnings.append(f"clipping above 1%: {path} ({clipping:.3%})")
    if silence >= 0.60:
        warnings.append(f"near-silence above 60%: {path} ({silence:.3%})")

    return {
        "sampleRate": sample_rate,
        "frames": audio.shape[0],
        "durationSeconds": duration,
        "peak": peak,
        "rms": rms,
        "nearSilenceRatio": silence,
        "clippingRatio": clipping,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate all local voice benchmark artifacts")
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--skip-long", action="store_true")
    args = parser.parse_args()
    expected_cases = SHORT_CASES if args.skip_long else SHORT_CASES | LONG_CASE

    failures: list[str] = []
    warnings: list[str] = []
    artifacts: dict[str, object] = {}
    aggregate_path = args.results / "aggregate.json"
    require(aggregate_path.is_file(), f"missing aggregate report: {aggregate_path}", failures)
    if failures:
        raise RuntimeError("\n".join(failures))

    aggregate = json.loads(aggregate_path.read_text(encoding="utf-8"))
    reports = aggregate.get("models", [])
    model_ids = {report.get("model", {}).get("id") for report in reports}
    require(model_ids == EXPECTED_MODELS, f"expected models {sorted(EXPECTED_MODELS)}, received {sorted(model_ids)}", failures)
    reference = args.results / aggregate.get("referenceFile", "")
    reference_info = sf.info(reference) if reference.is_file() else None
    require(reference_info is not None and reference_info.duration > 0, f"invalid reference audio: {reference}", failures)

    for report in reports:
        model_id = report["model"]["id"]
        model_root = args.results / model_id
        require(math.isfinite(report["modelLoadSeconds"]) and report["modelLoadSeconds"] > 0, f"invalid load time: {model_id}", failures)
        require(report["modelAssetBytes"] > 0, f"invalid model size: {model_id}", failures)
        require(report["peakCudaMemoryBytes"] > 0, f"invalid peak VRAM: {model_id}", failures)
        cases = {case["id"]: case for case in report.get("cases", [])}
        require(set(cases) == set(expected_cases), f"unexpected cases: {model_id}", failures)
        model_artifacts: dict[str, object] = {}
        for case_id, expected_segments in expected_cases.items():
            case = cases.get(case_id)
            if not case:
                continue
            require(case["segmentCount"] == expected_segments, f"segment count mismatch: {model_id}/{case_id}", failures)
            require(math.isfinite(case["medianRtf"]) and case["medianRtf"] > 0, f"invalid RTF: {model_id}/{case_id}", failures)
            model_artifacts[case_id] = inspect_audio(
                model_root / case["joinedFile"],
                float(case["joinedSeconds"]),
                failures,
                warnings,
            )
        artifacts[model_id] = model_artifacts

    validation = {
        "schemaVersion": 1,
        "passed": not failures,
        "failures": failures,
        "warnings": warnings,
        "artifacts": artifacts,
    }
    validation_path = args.results / "validation.json"
    validation_path.write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
    print(validation_path)
    if failures:
        raise RuntimeError("\n".join(failures))


if __name__ == "__main__":
    main()
