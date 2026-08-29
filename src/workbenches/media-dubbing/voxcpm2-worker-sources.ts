export const SOURCE_SEPARATION_WORKER_SOURCE = String.raw`from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import sherpa_onnx
import soundfile as sf

parser = argparse.ArgumentParser()
parser.add_argument("--input", type=Path, required=True)
parser.add_argument("--model", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

samples, sample_rate = sf.read(args.input, dtype="float32", always_2d=True)
samples = np.ascontiguousarray(np.transpose(samples))
config = sherpa_onnx.OfflineSourceSeparationConfig(
    model=sherpa_onnx.OfflineSourceSeparationModelConfig(
        uvr=sherpa_onnx.OfflineSourceSeparationUvrModelConfig(
            model=str(args.model)
        ),
        num_threads=2,
        debug=False,
        provider="cuda",
    )
)
if not config.validate():
    raise ValueError("invalid source-separation configuration")

started = time.perf_counter()
result = sherpa_onnx.OfflineSourceSeparation(config).process(
    sample_rate=sample_rate,
    samples=samples,
)
if len(result.stems) != 2:
    raise RuntimeError(f"expected two stems, received {len(result.stems)}")

sf.write(
    args.output / "background.wav",
    np.transpose(result.stems[0].data),
    result.sample_rate,
    subtype="PCM_16",
)
sf.write(
    args.output / "vocals.wav",
    np.transpose(result.stems[1].data),
    result.sample_rate,
    subtype="PCM_16",
)
print(json.dumps({
    "elapsedSeconds": time.perf_counter() - started,
    "sampleRate": result.sample_rate,
}), flush=True)
`;

export const WRITABLE_AUDIO_NORMALIZER_SOURCE = String.raw`def ensure_writable_audio(path: Path) -> None:
    try:
        with sf.SoundFile(path, mode="r+"):
            return
    except sf.LibsndfileError:
        pass

    normalized_path = path.with_name(f".{path.stem}.writable{path.suffix}")
    normalized_path.unlink(missing_ok=True)
    try:
        with (
            sf.SoundFile(path, mode="r") as source,
            sf.SoundFile(
                normalized_path,
                mode="w",
                samplerate=source.samplerate,
                channels=source.channels,
                format=source.format,
                subtype=source.subtype,
            ) as normalized,
        ):
            block_size = max(source.samplerate, 1)
            while True:
                block = source.read(
                    block_size,
                    dtype="float32",
                    always_2d=True,
                )
                if block.size == 0:
                    break
                normalized.write(block)
        normalized_path.replace(path)
    finally:
        normalized_path.unlink(missing_ok=True)

    with sf.SoundFile(path, mode="r+"):
        pass
`;

export const VOXCPM2_DUBBING_WORKER_SOURCE = String.raw`from __future__ import annotations

import argparse
import json
import time
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from voxcpm import VoxCPM


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


def mono_float32(value: object) -> np.ndarray:
    if isinstance(value, torch.Tensor):
        value = value.detach().float().cpu().numpy()
    array = np.asarray(value, dtype=np.float32).squeeze()
    if array.ndim != 1:
        raise ValueError(f"expected mono waveform, received {array.shape}")
    return array


def write_progress(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def fit_to_timeline(
    ffmpeg: Path,
    source: Path,
    target: Path,
    raw_seconds: float,
    target_seconds: float,
    sample_rate: int,
) -> None:
    tempo = raw_seconds / target_seconds
    filter_graph = (
        f"{atempo_chain(tempo)},"
        f"apad=pad_dur={target_seconds:.6f},"
        f"atrim=0:{target_seconds:.6f}"
    )
    process = subprocess.run(
        [
            str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-af", filter_graph,
            "-ar", str(sample_rate), "-ac", "1",
            "-c:a", "pcm_s16le", str(target),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        raise RuntimeError(f"FFmpeg duration fit failed: {process.stderr[-4000:]}")


def valid_audio(path: Path, sample_rate: int, channels: int, frames: int) -> bool:
    try:
        with sf.SoundFile(path, mode="r") as audio:
            return (
                audio.samplerate == sample_rate
                and audio.channels == channels
                and audio.frames == frames
            )
    except Exception:
        return False


def create_voice_timeline(
    path: Path,
    sample_rate: int,
    total_frames: int,
) -> None:
    zero_block = np.zeros(sample_rate, dtype=np.float32)
    with sf.SoundFile(
        path,
        mode="w",
        samplerate=sample_rate,
        channels=1,
        subtype="PCM_16",
    ) as timeline:
        remaining = total_frames
        while remaining > 0:
            count = min(remaining, zero_block.size)
            timeline.write(zero_block[:count])
            remaining -= count


${WRITABLE_AUDIO_NORMALIZER_SOURCE}


def rebuild_mixed_timeline(
    background_path: Path,
    voice_path: Path,
    mixed_path: Path,
) -> None:
    with (
        sf.SoundFile(background_path, mode="r") as background,
        sf.SoundFile(voice_path, mode="r") as voice,
        sf.SoundFile(
            mixed_path,
            mode="w",
            samplerate=background.samplerate,
            channels=background.channels,
            subtype="PCM_16",
        ) as mixed,
    ):
        if voice.samplerate != background.samplerate or voice.frames != background.frames:
            raise ValueError("voice and background timelines do not align")
        block_size = max(background.samplerate, 1)
        remaining = background.frames
        while remaining > 0:
            count = min(remaining, block_size)
            background_block = background.read(
                count,
                dtype="float32",
                always_2d=True,
            )
            voice_block = voice.read(count, dtype="float32", always_2d=True)
            if background.channels > 1:
                voice_block = np.repeat(voice_block, background.channels, axis=1)
            mixed.write(np.clip(background_block * 0.9 + voice_block, -0.95, 0.95))
            remaining -= count


def run_job(model: VoxCPM, request: dict[str, object]) -> None:
    reference_path = Path(str(request["referencePath"]))
    phrases_path = Path(str(request["phrasesPath"]))
    output_path = Path(str(request["outputDirectory"]))
    progress_path = Path(str(request["progressPath"]))
    background_path = Path(str(request["backgroundPath"]))
    mixed_path = Path(str(request["previewPath"]))
    ffmpeg_path = Path(str(request["ffmpegPath"]))
    duration_ms = int(request["durationMs"])

    payload = json.loads(phrases_path.read_text(encoding="utf-8"))
    phrases = payload.get("phrases")
    if not isinstance(phrases, list) or not phrases:
        raise ValueError("phrases must be a non-empty array")
    if duration_ms <= 0:
        raise ValueError("duration must be positive")

    output_path.mkdir(parents=True, exist_ok=True)
    with sf.SoundFile(background_path, mode="r") as background:
        sample_rate = background.samplerate
        background_channels = background.channels
        total_frames = background.frames
    if sample_rate <= 0 or background_channels <= 0 or total_frames <= 0:
        raise ValueError("background timeline is invalid")

    model_sample_rate = int(model.tts_model.sample_rate)
    timeline_path = output_path / "voice.wav"
    reverse_phrases = list(reversed(phrases))
    completed = 0
    if progress_path.exists() and timeline_path.exists():
        try:
            progress = json.loads(progress_path.read_text(encoding="utf-8"))
            completed = int(progress.get("completedPhrases", -1))
            total = int(progress.get("totalPhrases", -1))
            if completed < 0 or completed > len(phrases) or total != len(phrases):
                raise ValueError("invalid completed phrase count")
            expected_start = (
                duration_ms
                if completed == 0
                else int(reverse_phrases[completed - 1].get("startMs", -1))
            )
            if int(progress.get("readySuffixStartMs", -1)) != expected_start:
                raise ValueError("invalid ready suffix")
            if int(progress.get("completedDurationMs", -1)) != duration_ms - expected_start:
                raise ValueError("invalid completed duration")
            if not valid_audio(timeline_path, sample_rate, 1, total_frames):
                raise ValueError("voice timeline shape changed")
        except Exception:
            completed = 0
            progress_path.unlink(missing_ok=True)
            timeline_path.unlink(missing_ok=True)
            mixed_path.unlink(missing_ok=True)

    if completed == 0:
        create_voice_timeline(timeline_path, sample_rate, total_frames)
    if not valid_audio(mixed_path, sample_rate, background_channels, total_frames):
        rebuild_mixed_timeline(background_path, timeline_path, mixed_path)
    ensure_writable_audio(timeline_path)
    ensure_writable_audio(mixed_path)
    if completed > 0:
        ready_start = int(reverse_phrases[completed - 1]["startMs"])
        write_progress(progress_path, {
            "completedPhrases": completed,
            "totalPhrases": len(phrases),
            "readySuffixStartMs": ready_start,
            "completedDurationMs": duration_ms - ready_start,
            "previewReady": True,
        })

    with (
        sf.SoundFile(timeline_path, mode="r+") as timeline,
        sf.SoundFile(background_path, mode="r") as background,
        sf.SoundFile(mixed_path, mode="r+") as mixed,
    ):
        for index in range(completed, len(reverse_phrases)):
            phrase = reverse_phrases[index]
            phrase_id = str(phrase.get("id", "")).strip()
            text = str(phrase.get("spokenText") or phrase.get("text", "")).strip()
            start_ms = int(phrase.get("startMs", -1))
            end_ms = int(phrase.get("endMs", -1))
            if not phrase_id or not text or start_ms < 0 or end_ms <= start_ms:
                raise ValueError(f"invalid phrase at reverse index {index}")

            np.random.seed(10000 + index)
            torch.manual_seed(10000 + index)
            torch.cuda.manual_seed_all(10000 + index)
            chunks = [
                mono_float32(chunk)
                for chunk in model.generate_streaming(
                    text=text,
                    reference_wav_path=str(reference_path.resolve()),
                    cfg_value=2.0,
                    inference_timesteps=10,
                    retry_badcase=False,
                )
            ]
            if not chunks:
                raise RuntimeError(f"VoxCPM2 returned no audio for {phrase_id}")
            waveform = np.concatenate(chunks)
            raw_path = output_path / f".{phrase_id}.raw.wav"
            fitted_path = output_path / f".{phrase_id}.fitted.wav"
            sf.write(raw_path, waveform, model_sample_rate)
            try:
                fit_to_timeline(
                    ffmpeg_path,
                    raw_path,
                    fitted_path,
                    waveform.size / model_sample_rate,
                    (end_ms - start_ms) / 1000,
                    sample_rate,
                )
                fitted, fitted_rate = sf.read(fitted_path, dtype="float32")
                if fitted_rate != sample_rate:
                    raise RuntimeError("fitted audio sample rate changed")
                voice = mono_float32(fitted)
                start_frame = round(start_ms * sample_rate / 1000)
                target_frames = min(
                    round((end_ms - start_ms) * sample_rate / 1000),
                    total_frames - start_frame,
                )
                if target_frames <= 0:
                    raise ValueError(f"phrase exceeds timeline: {phrase_id}")
                if voice.size < target_frames:
                    voice = np.pad(voice, (0, target_frames - voice.size))
                else:
                    voice = voice[:target_frames]

                timeline.seek(start_frame)
                timeline.write(voice)
                background.seek(start_frame)
                background_segment = background.read(
                    target_frames,
                    dtype="float32",
                    always_2d=True,
                )
                voice_segment = voice[:, np.newaxis]
                if background_channels > 1:
                    voice_segment = np.repeat(
                        voice_segment,
                        background_channels,
                        axis=1,
                    )
                mixed.seek(start_frame)
                mixed.write(
                    np.clip(
                        background_segment * 0.9 + voice_segment,
                        -0.95,
                        0.95,
                    )
                )
                timeline.flush()
                mixed.flush()
            finally:
                raw_path.unlink(missing_ok=True)
                fitted_path.unlink(missing_ok=True)

            completed = index + 1
            write_progress(progress_path, {
                "completedPhrases": completed,
                "totalPhrases": len(phrases),
                "readySuffixStartMs": start_ms,
                "completedDurationMs": duration_ms - start_ms,
                "previewReady": True,
            })

    write_progress(progress_path, {
        "completedPhrases": len(phrases),
        "totalPhrases": len(phrases),
        "readySuffixStartMs": 0,
        "completedDurationMs": duration_ms,
        "previewReady": True,
        "complete": True,
    })


parser = argparse.ArgumentParser()
parser.add_argument("--model", type=Path, required=True)
parser.add_argument("--request", type=Path, required=True)
parser.add_argument("--ready", type=Path, required=True)
args = parser.parse_args()

torch.set_float32_matmul_precision("high")
model = VoxCPM.from_pretrained(
    hf_model_id=str(args.model.resolve()),
    load_denoiser=False,
    optimize=False,
    device="cuda",
)
write_progress(args.ready, {"ready": True})
while not args.request.exists():
    time.sleep(0.05)
request = json.loads(args.request.read_text(encoding="utf-8"))
if not isinstance(request, dict):
    raise ValueError("request must be an object")
run_job(model, request)
`;
