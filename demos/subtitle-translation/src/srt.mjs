const TIMING_PATTERN =
  /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[,.](\d{3})(?:\s+.*)?$/u;

function timestampToMs(hours, minutes, seconds, milliseconds) {
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(milliseconds)
  );
}

function parseTiming(line) {
  const match = TIMING_PATTERN.exec(line.trim());
  if (!match) throw new Error(`Invalid SRT timing line: ${line}`);
  return {
    startMs: timestampToMs(match[1], match[2], match[3], match[4]),
    endMs: timestampToMs(match[5], match[6], match[7], match[8]),
  };
}

export function parseSrt(source) {
  const blocks = source
    .replace(/^\uFEFF/u, '')
    .replaceAll('\r\n', '\n')
    .trim()
    .split(/\n{2,}/u)
    .filter((block) => block.trim().length > 0);
  let previousStart = -1;
  return blocks.map((block, index) => {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => TIMING_PATTERN.test(line.trim()));
    if (timingIndex < 0) throw new Error(`SRT block ${index + 1} has no timing line.`);
    const timing = parseTiming(lines[timingIndex]);
    if (timing.endMs < timing.startMs) throw new Error(`SRT block ${index + 1} ends before it starts.`);
    if (timing.startMs < previousStart) throw new Error('SRT cues must be ordered by start time.');
    previousStart = timing.startMs;
    return {
      id: `cue-${String(index + 1).padStart(6, '0')}`,
      startMs: timing.startMs,
      endMs: timing.endMs,
      text: lines
        .slice(timingIndex + 1)
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim(),
    };
  });
}

function formatTimestamp(milliseconds) {
  const safe = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function toSrt(cues, textForCue = (cue) => cue.text) {
  return `${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatTimestamp(cue.startMs)} --> ${formatTimestamp(cue.endMs)}\n${textForCue(cue)}`,
    )
    .join('\n\n')}\n`;
}
