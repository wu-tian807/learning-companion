from __future__ import annotations

import argparse
import gc
import json
import platform
import shutil
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
import soundfile as sf
import torch


PROMPT_TEXT = "This is an example audio transcript for training."

SHORT_CASES = {
    "zh-one-shot": [
        "这是一段声音克隆效果验证。我们希望它保持说话人的音色，同时把中文说得清楚、自然。",
    ],
    "en-one-shot": [
        "This is a one-shot voice cloning test for Learning Companion. The voice should remain clear, natural, and close to the reference speaker.",
    ],
}

LONG_SEGMENT_ROUND = [
    "当视频开始播放时，系统不应该要求用户等待整段配音生成完成。",
    "The original audio remains available while the translated voice is generated in the background.",
    "生成器会从视频末尾向前处理，让已经完成的配音始终形成一个连续后缀。",
    "A white range inside the progress bar shows the audio that is truly ready to play.",
    "模型的实时系数只用来预测相遇位置，不能冒充真实的生成进度。",
    "Playback switches only after the current position enters the verified generated range.",
    "这样做的目标不是让每一秒都立刻有克隆声音，而是提供一段稳定连续的观看体验。",
    "If the user seeks to another position, the scheduler recalculates the estimate without discarding completed audio.",
    "同一个参考人声会被重复用于多个字幕片段，因此长程测试需要观察音色是否逐渐漂移。",
    "We also listen for unstable loudness, abrupt seams, skipped words, and invented speech between chunks.",
    "中文测试重点关注专有名词、数字、英文缩写和句尾语气是否自然。",
    "The English test focuses on pronunciation, pacing, cross-lingual accent, and speaker identity.",
    "在最终产品中，每个字幕片段都还需要按照原始时间轴做时长适配和混音。",
    "This benchmark intentionally measures raw synthesis before any time stretching or background mixing.",
    "如果生成速度足够快，白色后缀会在播放结束前追上用户当前的位置。",
    "When generation is slower, the interface should explain the wait instead of switching between voices repeatedly.",
]
LONG_ROUNDS = 4
LONG_SEGMENTS = LONG_SEGMENT_ROUND * LONG_ROUNDS


def synchronize() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def mono_float32(waveform: np.ndarray) -> np.ndarray:
    value = np.asarray(waveform, dtype=np.float32).squeeze()
    if value.ndim != 1 or value.size == 0:
        raise RuntimeError(f"expected non-empty mono waveform, received shape {value.shape}")
    if not np.isfinite(value).all():
        raise RuntimeError("model returned NaN or infinite audio samples")
    return value


def waveform_diagnostics(waveform: np.ndarray) -> dict[str, float]:
    absolute = np.abs(waveform)
    return {
        "peak": float(absolute.max()),
        "rms": float(np.sqrt(np.mean(np.square(waveform, dtype=np.float64)))),
        "nearSilenceRatio": float(np.mean(absolute < 1e-4)),
        "clippingRatio": float(np.mean(absolute >= 0.999)),
        "dcOffset": float(np.mean(waveform, dtype=np.float64)),
    }


def tree_size(paths: list[Path]) -> int:
    return sum(
        file.stat().st_size
        for path in paths
        for file in path.rglob("*")
        if file.is_file()
    )


class VoiceModel(Protocol):
    sample_rate: int

    def set_reference(self, path: Path, prompt_text: str = PROMPT_TEXT) -> None: ...

    def generate(self, text: str, seed: int) -> tuple[np.ndarray, float | None]: ...


@dataclass(frozen=True)
class ModelMetadata:
    id: str
    label: str
    runtime: str
    reference_mode: str
    license_note: str


class VoxCpmAdapter:
    def __init__(self, model_path: Path, version: str, optimize: bool) -> None:
        from voxcpm import VoxCPM

        self.version = version
        self.reference = ""
        self.prompt_text = PROMPT_TEXT
        self.optimize = optimize
        self.model = VoxCPM.from_pretrained(
            hf_model_id=str(model_path.resolve()),
            load_denoiser=False,
            optimize=optimize,
            device="cuda",
        )
        self.sample_rate = int(self.model.tts_model.sample_rate)

    def set_reference(self, path: Path, prompt_text: str = PROMPT_TEXT) -> None:
        self.reference = str(path.resolve())
        self.prompt_text = prompt_text.strip() or PROMPT_TEXT

    def generate(self, text: str, seed: int) -> tuple[np.ndarray, float | None]:
        np.random.seed(seed)
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
        kwargs: dict[str, object] = {
            "text": text,
            "cfg_value": 2.0,
            "inference_timesteps": 10,
            "retry_badcase": False,
        }
        if self.version == "voxcpm15":
            kwargs.update(
                prompt_wav_path=self.reference,
                prompt_text=self.prompt_text,
            )
        else:
            kwargs.update(reference_wav_path=self.reference)

        started = time.perf_counter()
        first_chunk_seconds: float | None = None
        chunks: list[np.ndarray] = []
        for chunk in self.model.generate_streaming(**kwargs):
            synchronize()
            if first_chunk_seconds is None:
                first_chunk_seconds = time.perf_counter() - started
            chunks.append(mono_float32(chunk))
        if not chunks:
            raise RuntimeError(f"{self.version} returned no audio chunks")
        return np.concatenate(chunks), first_chunk_seconds


class F5Adapter:
    def __init__(self, model_root: Path, vocoder_root: Path) -> None:
        from f5_tts.api import F5TTS

        self.reference = ""
        self.prompt_text = PROMPT_TEXT
        self.model = F5TTS(
            model="F5TTS_v1_Base",
            ckpt_file=str(model_root / "F5TTS_v1_Base" / "model_1250000.safetensors"),
            vocab_file=str(model_root / "F5TTS_v1_Base" / "vocab.txt"),
            vocoder_local_path=str(vocoder_root),
            device="cuda",
        )
        self.sample_rate = int(self.model.target_sample_rate)

    def set_reference(self, path: Path, prompt_text: str = PROMPT_TEXT) -> None:
        self.reference = str(path.resolve())
        self.prompt_text = prompt_text.strip() or PROMPT_TEXT

    def generate(self, text: str, seed: int) -> tuple[np.ndarray, float | None]:
        waveform, sample_rate, _ = self.model.infer(
            ref_file=self.reference,
            ref_text=self.prompt_text,
            gen_text=text,
            show_info=lambda _message: None,
            progress=None,
            nfe_step=32,
            seed=seed,
        )
        if int(sample_rate) != self.sample_rate:
            raise RuntimeError(f"F5-TTS sample-rate changed: {sample_rate}")
        return mono_float32(waveform), None


MODEL_METADATA = {
    "voxcpm15": ModelMetadata(
        id="voxcpm15",
        label="VoxCPM1.5",
        runtime="OpenBMB official Python",
        reference_mode="one-shot audio + exact transcript",
        license_note="Apache-2.0 model weights and code",
    ),
    "voxcpm2": ModelMetadata(
        id="voxcpm2",
        label="VoxCPM2",
        runtime="OpenBMB official Python",
        reference_mode="reference audio only",
        license_note="Apache-2.0 model weights and code",
    ),
    "f5tts": ModelMetadata(
        id="f5tts",
        label="F5-TTS v1 Base",
        runtime="SWivid official Python",
        reference_mode="one-shot audio + exact transcript",
        license_note="MIT code; pretrained model is CC-BY-NC-4.0",
    ),
}


def load_model(
    args: argparse.Namespace,
    prompt_text: str = PROMPT_TEXT,
) -> VoiceModel:
    if args.model_id == "voxcpm15":
        model: VoiceModel = VoxCpmAdapter(args.models / "VoxCPM1.5", "voxcpm15", args.optimize)
    elif args.model_id == "voxcpm2":
        model = VoxCpmAdapter(args.models / "VoxCPM2", "voxcpm2", args.optimize)
    else:
        model = F5Adapter(args.models / "F5-TTS", args.models / "vocos-mel-24khz")
    model.set_reference(args.reference, prompt_text)
    return model


def write_case(
    model: VoiceModel,
    case_id: str,
    texts: list[str],
    output_root: Path,
    base_seed: int,
) -> dict[str, object]:
    case_root = output_root / case_id
    case_root.mkdir(parents=True, exist_ok=True)
    segment_reports: list[dict[str, object]] = []
    joined: list[np.ndarray] = []
    gap = np.zeros(round(model.sample_rate * 0.12), dtype=np.float32)

    for index, text in enumerate(texts):
        synchronize()
        started = time.perf_counter()
        waveform, first_chunk_seconds = model.generate(text, base_seed + index)
        synchronize()
        generation_seconds = time.perf_counter() - started
        output_seconds = waveform.size / model.sample_rate
        file_name = f"segment-{index + 1:02d}.wav"
        sf.write(case_root / file_name, waveform, model.sample_rate)
        segment_reports.append(
            {
                "index": index + 1,
                "text": text,
                "file": f"{case_id}/{file_name}",
                "generationSeconds": generation_seconds,
                "firstChunkSeconds": first_chunk_seconds,
                "outputSeconds": output_seconds,
                "rtf": generation_seconds / output_seconds,
                "waveform": waveform_diagnostics(waveform),
            }
        )
        if joined:
            joined.append(gap)
        joined.append(waveform)
        print(
            f"{case_id} {index + 1}/{len(texts)}: "
            f"{generation_seconds:.2f}s / {output_seconds:.2f}s, "
            f"RTF {generation_seconds / output_seconds:.3f}",
            flush=True,
        )

    joined_waveform = np.concatenate(joined)
    joined_file = f"{case_id}/joined.wav"
    sf.write(output_root / joined_file, joined_waveform, model.sample_rate)
    rtfs = [float(item["rtf"]) for item in segment_reports]
    return {
        "id": case_id,
        "segmentCount": len(segment_reports),
        "joinedFile": joined_file,
        "joinedSeconds": joined_waveform.size / model.sample_rate,
        "generationSeconds": sum(float(item["generationSeconds"]) for item in segment_reports),
        "medianRtf": statistics.median(rtfs),
        "p90Rtf": sorted(rtfs)[min(len(rtfs) - 1, round((len(rtfs) - 1) * 0.9))],
        "waveform": waveform_diagnostics(joined_waveform),
        "segments": segment_reports,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one voice-cloning model through the shared benchmark")
    parser.add_argument("--model-id", choices=sorted(MODEL_METADATA), required=True)
    parser.add_argument("--models", required=True, type=Path)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--optimize", action="store_true")
    parser.add_argument("--skip-long", action="store_true")
    args = parser.parse_args()

    if not torch.cuda.is_available():
        parser.error("CUDA is required for the multi-model comparison")
    if not args.reference.is_file():
        parser.error(f"reference audio does not exist: {args.reference}")

    output_root = args.output / args.model_id
    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    torch.set_float32_matmul_precision("high")
    torch.cuda.reset_peak_memory_stats()

    load_started = time.perf_counter()
    model = load_model(args)
    synchronize()
    load_seconds = time.perf_counter() - load_started

    warmup_started = time.perf_counter()
    warmup, _ = model.generate("声音克隆模型预热。", 7)
    synchronize()
    warmup_seconds = time.perf_counter() - warmup_started
    del warmup

    cases: list[dict[str, object]] = []
    for offset, (case_id, texts) in enumerate(SHORT_CASES.items()):
        cases.append(write_case(model, case_id, texts, output_root, 42 + offset * 100))
    if not args.skip_long:
        cases.append(write_case(model, "long-run-bilingual", LONG_SEGMENTS, output_root, 4242))

    metadata = MODEL_METADATA[args.model_id]
    model_paths = {
        "voxcpm15": [args.models / "VoxCPM1.5"],
        "voxcpm2": [args.models / "VoxCPM2"],
        "f5tts": [args.models / "F5-TTS", args.models / "vocos-mel-24khz"],
    }[args.model_id]
    all_segments = [segment for case in cases for segment in case["segments"]]
    warm_rtfs = [float(segment["rtf"]) for segment in all_segments]
    first_chunks = [
        float(segment["firstChunkSeconds"])
        for segment in all_segments
        if segment["firstChunkSeconds"] is not None
    ]
    report = {
        "schemaVersion": 1,
        "model": metadata.__dict__,
        "runtime": {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "cudaRuntime": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0),
            "platform": platform.platform(),
            "optimize": args.optimize,
        },
        "input": {
            "referenceFile": "../reference.wav",
            "referenceSeconds": sf.info(args.reference).duration,
            "promptText": PROMPT_TEXT if args.model_id != "voxcpm2" else None,
        },
        "modelLoadSeconds": load_seconds,
        "modelAssetBytes": tree_size(model_paths),
        "warmupSeconds": warmup_seconds,
        "peakCudaMemoryBytes": torch.cuda.max_memory_allocated(),
        "schedulerEstimate": {
            "rtf": statistics.median(warm_rtfs),
            "p90Rtf": sorted(warm_rtfs)[min(len(warm_rtfs) - 1, round((len(warm_rtfs) - 1) * 0.9))],
            "medianFirstChunkSeconds": statistics.median(first_chunks) if first_chunks else None,
        },
        "cases": cases,
    }
    (output_root / "benchmark.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    shutil.copy2(args.reference, args.output / "reference.wav")
    print(f"report: {output_root / 'benchmark.json'}", flush=True)

    del model
    gc.collect()
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
