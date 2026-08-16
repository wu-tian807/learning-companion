const TIMING_LINE = /^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/u;

function timestampToMs(parts, offset) {
  return (
    Number(parts[offset]) * 3_600_000 +
    Number(parts[offset + 1]) * 60_000 +
    Number(parts[offset + 2]) * 1_000 +
    Number(parts[offset + 3])
  );
}

function decodeEntities(text) {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/&#(\d+);/gu, (_, codePoint) => String.fromCodePoint(Number(codePoint)));
}

export function cleanReferenceText(text) {
  return decodeEntities(text)
    .replace(/<[^>]*>/gu, '')
    .replace(/^\s*[A-Z][A-Z .'-]{1,48}:\s*/u, '')
    .replace(/\[(?:music|applause|laughter|inaudible)[^\]]*\]/giu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function parseVtt(source) {
  const cues = [];
  const blocks = source.replaceAll('\r\n', '\n').split(/\n{2,}/u);
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => TIMING_LINE.test(line));
    if (timingIndex < 0) continue;
    const match = TIMING_LINE.exec(lines[timingIndex]);
    const text = cleanReferenceText(lines.slice(timingIndex + 1).join(' '));
    if (!match || !text) continue;
    cues.push({
      startMs: timestampToMs(match, 1),
      endMs: timestampToMs(match, 5),
      text,
    });
  }
  return cues;
}

export function referenceTextBefore(cues, durationMs) {
  return cues
    .filter((cue) => cue.endMs <= durationMs)
    .map((cue) => cue.text)
    .join(' ');
}

function mergedIntervals(cues, durationMs) {
  const intervals = cues
    .map((cue) => ({
      startMs: Math.max(0, Math.min(durationMs, cue.startMs)),
      endMs: Math.max(0, Math.min(durationMs, cue.endMs)),
    }))
    .filter((cue) => cue.endMs > cue.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (!previous || interval.startMs > previous.endMs) {
      merged.push({ ...interval });
      continue;
    }
    previous.endMs = Math.max(previous.endMs, interval.endMs);
  }
  return merged;
}

function intervalDuration(intervals) {
  return intervals.reduce((sum, interval) => sum + interval.endMs - interval.startMs, 0);
}

function intersectedDuration(left, right) {
  let leftIndex = 0;
  let rightIndex = 0;
  let total = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftInterval = left[leftIndex];
    const rightInterval = right[rightIndex];
    total += Math.max(
      0,
      Math.min(leftInterval.endMs, rightInterval.endMs) -
        Math.max(leftInterval.startMs, rightInterval.startMs),
    );
    if (leftInterval.endMs <= rightInterval.endMs) leftIndex += 1;
    else rightIndex += 1;
  }
  return total;
}

export function subtitleTimingAgreement(referenceCues, generatedCues, durationMs) {
  const reference = mergedIntervals(referenceCues, durationMs);
  const generated = mergedIntervals(generatedCues, durationMs);
  const referenceDurationMs = intervalDuration(reference);
  const generatedDurationMs = intervalDuration(generated);
  const intersectionDurationMs = intersectedDuration(reference, generated);
  const unionDurationMs =
    referenceDurationMs + generatedDurationMs - intersectionDurationMs;
  return {
    referenceDurationMs,
    generatedDurationMs,
    intersectionDurationMs,
    speechPrecision:
      generatedDurationMs === 0 ? null : intersectionDurationMs / generatedDurationMs,
    speechRecall:
      referenceDurationMs === 0 ? null : intersectionDurationMs / referenceDurationMs,
    speechIntersectionOverUnion:
      unionDurationMs === 0 ? null : intersectionDurationMs / unionDurationMs,
  };
}

export function subtitleStructure(cues, durationMs) {
  let overlapCount = 0;
  let longDurationCount = 0;
  let longTextCount = 0;
  let emptyCount = 0;
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (index > 0 && cue.startMs < cues[index - 1].endMs) overlapCount += 1;
    if (cue.endMs - cue.startMs > 7_000) longDurationCount += 1;
    if (Array.from(cue.text).length > 84) longTextCount += 1;
    if (cue.text.trim().length === 0) emptyCount += 1;
  }
  const coveredMs = intervalDuration(mergedIntervals(cues, durationMs));
  const cueDurations = cues.map((cue) => Math.max(0, cue.endMs - cue.startMs));
  const cueCharacters = cues.map((cue) => Array.from(cue.text).length);
  return {
    cueCount: cues.length,
    overlapCount,
    longDurationCount,
    longTextCount,
    emptyCount,
    averageCharactersPerCue: cues.length === 0 ? 0 : cueCharacters.reduce((sum, value) => sum + value, 0) / cues.length,
    maximumCharactersPerCue: cues.length === 0 ? 0 : Math.max(...cueCharacters),
    averageDurationMs: cues.length === 0 ? 0 : cueDurations.reduce((sum, value) => sum + value, 0) / cues.length,
    maximumDurationMs: cues.length === 0 ? 0 : Math.max(...cueDurations),
    speechCoverageRate: durationMs === 0 ? 0 : coveredMs / durationMs,
  };
}
