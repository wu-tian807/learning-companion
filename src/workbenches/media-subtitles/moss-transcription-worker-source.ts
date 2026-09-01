export const MOSS_TRANSCRIPTION_WORKER_SOURCE = String.raw`from __future__ import annotations

import argparse
from array import array
from collections import Counter, defaultdict
from difflib import SequenceMatcher
import json
import os
import re
import sys

import transcribe_cpp


SAMPLE_RATE = 16000
TURN = re.compile(
    r"\[(?P<start>\d+(?:\.\d+)?)\]\[S(?P<speaker>\d+)\]"
    r"(?P<text>.*?)\[(?P<end>\d+(?:\.\d+)?)\]",
    re.DOTALL,
)
RANGE_TURN = re.compile(
    r"\[(?P<start>\d+(?:\.\d+)?)-(?P<end>\d+(?:\.\d+)?)\]"
    r"(?:\[(?:\d+(?:\.\d+)?)\])?\[S(?P<speaker>\d+)\]\s*"
    r"(?P<text>.*?)"
    r"(?=\[\d+(?:\.\d+)?-\d+(?:\.\d+)?\](?:\[\d+(?:\.\d+)?\])?\[S\d+\]|\Z)",
    re.DOTALL,
)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--backend", choices=("cuda", "metal"), required=True)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--window-seconds", type=int, default=180)
    parser.add_argument("--overlap-seconds", type=int, default=20)
    return parser.parse_args()


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def parse_segments(result) -> list[dict]:
    parsed = []
    matches = list(RANGE_TURN.finditer(result.raw_text))
    if not matches:
        matches = list(TURN.finditer(result.raw_text))
    for match in matches:
        text = clean_text(match.group("text"))
        start = float(match.group("start"))
        end = float(match.group("end"))
        if text and end > start:
            parsed.append({
                "localSpeaker": int(match.group("speaker")),
                "start": start,
                "end": end,
                "text": text,
            })
    structural_count = sum(
        1
        for segment in result.segments
        if clean_text(segment.text) and segment.t1_ms > segment.t0_ms
    )
    if parsed and len(parsed) < structural_count:
        raise RuntimeError(
            f"MOSS marker parser retained {len(parsed)}/{structural_count} segments"
        )
    if parsed:
        return parsed

    for segment in result.segments:
        text = clean_text(segment.text)
        if text and segment.t1_ms > segment.t0_ms:
            parsed.append({
                "localSpeaker": max(0, int(segment.speaker_id)),
                "start": segment.t0_ms / 1000,
                "end": segment.t1_ms / 1000,
                "text": text,
            })
    return parsed


def overlap(left: dict, right: dict) -> float:
    return max(0.0, min(left["end"], right["end"]) - max(left["start"], right["start"]))


def link_speakers(current: list[dict], previous: list[dict], next_id: int) -> tuple[dict, int]:
    local_ids = sorted({segment["localSpeaker"] for segment in current})
    scores = defaultdict(float)
    for candidate in current:
        for prior in previous:
            shared = overlap(candidate, prior)
            if shared <= 0:
                continue
            similarity = SequenceMatcher(None, candidate["text"], prior["text"]).ratio()
            scores[(candidate["localSpeaker"], prior["speakerId"])] += shared * (0.5 + 0.5 * similarity)

    mapping = {}
    used_global = set()
    for (local_id, global_id), score in sorted(scores.items(), key=lambda item: (-item[1], item[0][0], item[0][1])):
        if score <= 0 or local_id in mapping or global_id in used_global:
            continue
        mapping[local_id] = global_id
        used_global.add(global_id)
    for local_id in local_ids:
        if local_id not in mapping:
            mapping[local_id] = f"speaker-{next_id:04d}"
            next_id += 1
    return mapping, next_id


def read_window(path: str, start_sample: int, sample_count: int) -> array:
    values = array("f")
    with open(path, "rb") as handle:
        handle.seek(start_sample * values.itemsize)
        values.fromfile(handle, sample_count)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def main() -> None:
    args = arguments()
    if args.overlap_seconds <= 0 or args.window_seconds <= args.overlap_seconds * 2:
        raise ValueError("invalid MOSS window configuration")
    total_samples = os.path.getsize(args.input) // 4
    if total_samples <= 0:
        raise ValueError("empty PCM input")
    window_samples = args.window_seconds * SAMPLE_RATE
    overlap_samples = args.overlap_seconds * SAMPLE_RATE
    step_samples = window_samples - overlap_samples
    devices = transcribe_cpp.backends()
    device = next((candidate for candidate in devices if candidate.kind == args.backend), None)
    if device is None:
        raise RuntimeError(f"MOSS backend {args.backend!r} is unavailable: {devices!r}")

    kept = []
    languages = Counter()
    previous = []
    next_speaker_id = 1
    with transcribe_cpp.Model(args.model, device=device) as model:
        with model.session(n_threads=max(1, args.threads)) as session:
            window_index = 0
            start_sample = 0
            while start_sample < total_samples:
                count = min(window_samples, total_samples - start_sample)
                pcm = read_window(args.input, start_sample, count)
                result = session.run(pcm, timestamps="segment", diarize="default")
                if result.language:
                    languages[result.language] += 1
                offset_seconds = start_sample / SAMPLE_RATE
                current = []
                for segment in parse_segments(result):
                    current.append({
                        **segment,
                        "start": offset_seconds + segment["start"],
                        "end": offset_seconds + segment["end"],
                    })
                mapping, next_speaker_id = link_speakers(current, previous, next_speaker_id)
                mapped = [{
                    **segment,
                    "speakerId": mapping[segment["localSpeaker"]],
                } for segment in current]

                is_last = start_sample + count >= total_samples
                left_cut = offset_seconds if window_index == 0 else offset_seconds + args.overlap_seconds / 2
                window_end = offset_seconds + count / SAMPLE_RATE
                right_cut = window_end if is_last else window_end - args.overlap_seconds / 2
                for segment in mapped:
                    midpoint = (segment["start"] + segment["end"]) / 2
                    if midpoint >= left_cut and (is_last or midpoint < right_cut):
                        kept.append(segment)
                previous = mapped
                if is_last:
                    break
                start_sample += step_samples
                window_index += 1

    kept.sort(key=lambda segment: (segment["start"], segment["end"], segment["speakerId"], segment["text"]))
    if not kept:
        raise RuntimeError("MOSS did not produce subtitle segments")
    cues = []
    speaker_segments = []
    for index, segment in enumerate(kept, start=1):
        cue_id = f"cue-{index:06d}"
        start_ms = max(0, round(segment["start"] * 1000))
        end_ms = max(start_ms + 1, round(segment["end"] * 1000))
        cues.append({
            "id": cue_id,
            "startMs": start_ms,
            "endMs": end_ms,
            "text": segment["text"],
            "sourceCueIds": [cue_id],
            "speakerId": segment["speakerId"],
        })
        speaker_segments.append({
            "speakerId": segment["speakerId"],
            "startMs": start_ms,
            "endMs": end_ms,
        })
    payload = {
        "language": languages.most_common(1)[0][0] if languages else "unknown",
        "cues": cues,
        "speakerSegments": speaker_segments,
        "windowSeconds": args.window_seconds,
        "overlapSeconds": args.overlap_seconds,
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
`;
