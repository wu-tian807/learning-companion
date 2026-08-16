const TIMESTAMP_LINE = /^\s*\[(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\]\s*(.*?)\s*$/u;

function timestampPartsToMs(hours, minutes, seconds, milliseconds) {
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(milliseconds)
  );
}
export function parseWhisperCueLine(line) {
  const match = TIMESTAMP_LINE.exec(line);
  if (!match) return undefined;
  return {
    startMs: timestampPartsToMs(match[1], match[2], match[3], match[4]),
    endMs: timestampPartsToMs(match[5], match[6], match[7], match[8]),
    text: match[9].trim(),
  };
}

export function canonicalCuesFromWhisper(raw) {
  if (!raw || !Array.isArray(raw.transcription)) {
    throw new Error('Whisper JSON does not contain a transcription array.');
  }
  return raw.transcription.map((segment, index) => ({
    id: `cue-${String(index + 1).padStart(6, '0')}`,
    startMs: Number(segment?.offsets?.from),
    endMs: Number(segment?.offsets?.to),
    text: String(segment?.text ?? '').trim(),
    state: 'final',
  }));
}

export function validateTranscript(transcript) {
  if (transcript?.schemaVersion !== 1 || transcript?.artifactType !== 'media.transcript.v1') {
    throw new Error('Transcript must use media.transcript.v1 schema version 1.');
  }
  if (!Array.isArray(transcript.cues)) throw new Error('Transcript cues must be an array.');

  const ids = new Set();
  let previousStart = -1;
  for (const cue of transcript.cues) {
    if (typeof cue.id !== 'string' || cue.id.length === 0 || ids.has(cue.id)) {
      throw new Error('Every cue must have a unique non-empty id.');
    }
    ids.add(cue.id);
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs) || cue.startMs < 0 || cue.endMs < cue.startMs) {
      throw new Error(`Cue ${cue.id} has invalid timestamps.`);
    }
    if (cue.startMs < previousStart) throw new Error('Cues must be ordered by start time.');
    if (typeof cue.text !== 'string') throw new Error(`Cue ${cue.id} text must be a string.`);
    previousStart = cue.startMs;
  }
  return transcript;
}

function formatTime(milliseconds, decimalSeparator) {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${decimalSeparator}${String(millis).padStart(3, '0')}`;
}

export function toSrt(cues) {
  return `${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatTime(cue.startMs, ',')} --> ${formatTime(cue.endMs, ',')}\n${cue.text}`,
    )
    .join('\n\n')}\n`;
}

export function toVtt(cues) {
  const body = cues
    .map((cue) => `${formatTime(cue.startMs, '.')} --> ${formatTime(cue.endMs, '.')}\n${cue.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function chineseUnits(text) {
  return Array.from(text.toLocaleLowerCase()).filter((character) => /[\p{L}\p{N}]/u.test(character));
}

function englishUnits(text) {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?/gu) ?? [];
}

export function measureAccuracy(reference, hypothesis, language) {
  const isChinese = language.toLocaleLowerCase().startsWith('zh');
  const referenceUnits = isChinese ? chineseUnits(reference) : englishUnits(reference);
  const hypothesisUnits = isChinese ? chineseUnits(hypothesis) : englishUnits(hypothesis);
  const distance = editDistance(referenceUnits, hypothesisUnits);
  return {
    metric: isChinese ? 'cer' : 'wer',
    distance,
    referenceUnits: referenceUnits.length,
    hypothesisUnits: hypothesisUnits.length,
    rate: referenceUnits.length === 0 ? null : distance / referenceUnits.length,
  };
}
