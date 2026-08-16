from __future__ import annotations

import argparse
import json
import os
import threading
import time
from pathlib import Path

import ctranslate2
import psutil
import sentencepiece as spm


def timestamp_to_ms(value: str) -> int:
    hours, minutes, remainder = value.replace('.', ',').split(':')
    seconds, milliseconds = remainder.split(',')
    return (
        int(hours) * 3_600_000
        + int(minutes) * 60_000
        + int(seconds) * 1_000
        + int(milliseconds)
    )


def parse_srt(source: str) -> list[dict]:
    normalized = source.lstrip('\ufeff').replace('\r\n', '\n').strip()
    cues: list[dict] = []
    for index, block in enumerate(part for part in normalized.split('\n\n') if part.strip()):
        lines = block.splitlines()
        timing_index = next((i for i, line in enumerate(lines) if ' --> ' in line), None)
        if timing_index is None:
            raise ValueError(f'SRT block {index + 1} has no timing line')
        start, end = lines[timing_index].split(' --> ', maxsplit=1)
        cues.append(
            {
                'id': f'cue-{index + 1:06d}',
                'startMs': timestamp_to_ms(start.strip()),
                'endMs': timestamp_to_ms(end.strip().split()[0]),
                'text': ' '.join(lines[timing_index + 1 :]).strip(),
            }
        )
    return cues


def format_timestamp(milliseconds: int) -> str:
    safe = max(0, round(milliseconds))
    hours, remainder = divmod(safe, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f'{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}'


def to_srt(cues: list[dict], text_key: str, bilingual: bool = False) -> str:
    blocks = []
    for index, cue in enumerate(cues, start=1):
        text = cue[text_key]
        if bilingual:
            text = f"{cue['text']}\n{cue['translatedText']}"
        blocks.append(
            f"{index}\n{format_timestamp(cue['startMs'])} --> {format_timestamp(cue['endMs'])}\n{text}"
        )
    return '\n\n'.join(blocks) + '\n'


def percentile(values: list[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(probability * len(ordered) + 0.999999) - 1))
    return ordered[index]


def summarize(values: list[float]) -> dict:
    if not values:
        return {'count': 0, 'minMs': None, 'p50Ms': None, 'p95Ms': None, 'maxMs': None}
    return {
        'count': len(values),
        'minMs': min(values),
        'p50Ms': percentile(values, 0.5),
        'p95Ms': percentile(values, 0.95),
        'maxMs': max(values),
    }


def detokenize(pieces: list[str]) -> str:
    return ''.join(pieces).replace('▁', ' ').strip()


class MemorySampler:
    def __init__(self) -> None:
        self.process = psutil.Process(os.getpid())
        self.baseline = self.process.memory_info().rss
        self.peak = self.baseline
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self.stop_event.wait(0.01):
            self.peak = max(self.peak, self.process.memory_info().rss)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.thread.join()
        self.peak = max(self.peak, self.process.memory_info().rss)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--from', dest='source_language', required=True)
    parser.add_argument('--to', dest='target_language', required=True)
    parser.add_argument('--models-root', required=True)
    parser.add_argument('--batch-size', type=int, default=8)
    parser.add_argument('--inter-threads', type=int, default=4)
    parser.add_argument('--intra-threads', type=int, default=5)
    args = parser.parse_args()

    pair_directory = Path(args.models_root) / f'translate-{args.source_language}_{args.target_language}-1_9'
    output_directory = Path(args.output)
    output_directory.mkdir(parents=True, exist_ok=True)
    cues = parse_srt(Path(args.input).read_text(encoding='utf-8'))
    if not cues or not any(cue['text'] for cue in cues):
        raise ValueError('Source subtitle has no translatable text')

    sampler = MemorySampler()
    sampler.start()
    cold_started = time.perf_counter()
    translator = ctranslate2.Translator(
        str(pair_directory / 'model'),
        device='cpu',
        compute_type='int8',
        inter_threads=args.inter_threads,
        intra_threads=args.intra_threads,
    )
    model_load_ms = (time.perf_counter() - cold_started) * 1_000
    tokenizer = spm.SentencePieceProcessor(model_file=str(pair_directory / 'sentencepiece.model'))

    def translate_text(text: str) -> str:
        source_tokens = tokenizer.encode(text, out_type=str)
        result = translator.translate_batch([source_tokens], beam_size=1, return_scores=False)[0]
        return detokenize(result.hypotheses[0])

    translate_text(next(cue['text'] for cue in cues if cue['text']))
    cold_first_cue_ms = (time.perf_counter() - cold_started) * 1_000

    warm_latencies = []
    for cue in [item for item in cues if item['text']][:20]:
        started = time.perf_counter()
        translate_text(cue['text'])
        warm_latencies.append((time.perf_counter() - started) * 1_000)

    events = []
    translated_cues = []
    bulk_started = time.perf_counter()
    for batch_start in range(0, len(cues), args.batch_size):
        batch = cues[batch_start : batch_start + args.batch_size]
        texts = [cue['text'] for cue in batch]
        encoded = [tokenizer.encode(text, out_type=str) for text in texts]
        queued_at = time.perf_counter()
        results = translator.translate_batch(
            encoded,
            beam_size=1,
            return_scores=False,
            max_batch_size=args.batch_size,
            batch_type='examples',
        )
        completed_at = time.perf_counter()
        for offset, (cue, result) in enumerate(zip(batch, results, strict=True)):
            translated_text = detokenize(result.hypotheses[0])
            translated_cues.append({**cue, 'translatedText': translated_text})
            events.append(
                {
                    'type': 'translation.cue.final',
                    'cueId': cue['id'],
                    'sourceIndex': batch_start + offset,
                    'queuedMs': (queued_at - bulk_started) * 1_000,
                    'completedMs': (completed_at - bulk_started) * 1_000,
                    'latencyMs': (completed_at - queued_at) * 1_000,
                }
            )
    bulk_translation_ms = (time.perf_counter() - bulk_started) * 1_000
    sampler.stop()

    media_duration_ms = max(cue['endMs'] for cue in cues)
    source_characters = sum(len(cue['text']) for cue in cues)
    metrics = {
        'inputCueCount': len(cues),
        'cueCount': len(cues),
        'sourceCharacters': source_characters,
        'mediaDurationMs': media_duration_ms,
        'modelLoadMs': model_load_ms,
        'coldFirstCueMs': cold_first_cue_ms,
        'warmIsolatedLatency': summarize(warm_latencies),
        'firstBulkCueMs': events[0]['completedMs'] if events else None,
        'bulkTranslationMs': bulk_translation_ms,
        'cuesPerSecond': len(cues) / (bulk_translation_ms / 1_000),
        'charactersPerSecond': source_characters / (bulk_translation_ms / 1_000),
        'mediaToTranslationRatio': media_duration_ms / bulk_translation_ms,
        'rssBeforeBytes': sampler.baseline,
        'peakRssBytes': sampler.peak,
        'peakRssDeltaBytes': sampler.peak - sampler.baseline,
    }
    benchmark = {
        'schemaVersion': 1,
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'engine': 'ctranslate2-argos-opus-mt-int8',
        'modelPair': f'{args.source_language}-{args.target_language}',
        'configuration': {
            'batchSize': args.batch_size,
            'interThreads': args.inter_threads,
            'intraThreads': args.intra_threads,
        },
        'metrics': metrics,
    }
    translation = {
        'schemaVersion': 1,
        'artifactType': 'media.translation.v1-candidate',
        'sourceLanguage': args.source_language,
        'targetLanguage': args.target_language,
        'cues': [
            {
                'id': cue['id'],
                'startMs': cue['startMs'],
                'endMs': cue['endMs'],
                'sourceText': cue['text'],
                'translatedText': cue['translatedText'],
            }
            for cue in translated_cues
        ],
    }

    (output_directory / 'source.srt').write_text(to_srt(translated_cues, 'text'), encoding='utf-8')
    (output_directory / 'translated.srt').write_text(
        to_srt(translated_cues, 'translatedText'), encoding='utf-8'
    )
    (output_directory / 'bilingual.srt').write_text(
        to_srt(translated_cues, 'translatedText', bilingual=True), encoding='utf-8'
    )
    (output_directory / 'translation.json').write_text(
        json.dumps(translation, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )
    (output_directory / 'benchmark.json').write_text(
        json.dumps(benchmark, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )
    (output_directory / 'events.ndjson').write_text(
        '\n'.join(json.dumps(event, ensure_ascii=False) for event in events) + '\n', encoding='utf-8'
    )
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
