function requireFinite(name, value) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function cueDurationSeconds(cue) {
  if (
    !cue ||
    !Number.isSafeInteger(cue.startMs) ||
    !Number.isSafeInteger(cue.endMs) ||
    cue.startMs < 0 ||
    cue.endMs <= cue.startMs
  ) {
    throw new TypeError("cue must contain a valid millisecond range");
  }
  return (cue.endMs - cue.startMs) / 1_000;
}

/**
 * The far-right probe is real output, not a disposable warm-up. Prefer a cue
 * long enough to produce a stable RTF while keeping the probe wait bounded.
 */
export function selectRightEdgeProbeCue(cues) {
  if (!Array.isArray(cues) || cues.length === 0) {
    throw new TypeError("cues must contain at least one subtitle cue");
  }

  const candidates = cues
    .map((cue, index) => ({
      cue,
      index,
      duration: cueDurationSeconds(cue),
      characters: [...String(cue.text ?? "").trim()].length,
    }))
    .filter(({ characters }) => characters > 0);
  if (candidates.length === 0) {
    throw new TypeError("cues must contain spoken text");
  }

  const preferred = candidates.filter(
    ({ duration, characters }) =>
      duration >= 2.5 && duration <= 8 && characters >= 12,
  );
  const pool = preferred.length > 0 ? preferred : candidates;

  return pool.reduce((best, candidate) => {
    // Staying close to the end matters more than a small duration difference.
    const edgePenalty = (cues.length - 1 - candidate.index) * 4;
    const durationPenalty = Math.abs(candidate.duration - 4.5);
    const score = edgePenalty + durationPenalty;
    return !best || score < best.score ? { ...candidate, score } : best;
  }, undefined).cue;
}

export function createReverseSuffixOrder(cues, probeCueId) {
  if (!Array.isArray(cues) || cues.length === 0) {
    throw new TypeError("cues must contain at least one subtitle cue");
  }
  const probe = cues.find(({ id }) => id === probeCueId);
  if (!probe) throw new RangeError("probe cue is outside the subtitle track");
  return [probe, ...[...cues].reverse().filter(({ id }) => id !== probeCueId)];
}

export function timelineRtf(generationSeconds, cue) {
  requireFinite("generationSeconds", generationSeconds);
  if (generationSeconds < 0) {
    throw new RangeError("generationSeconds cannot be negative");
  }
  return generationSeconds / cueDurationSeconds(cue);
}

export function rollingTimelineRtf(samples, maximumSamples = 7) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new TypeError("samples must contain at least one RTF measurement");
  }
  const values = samples
    .slice(-maximumSamples)
    .map((sample) => {
      requireFinite("rtf sample", sample);
      if (sample <= 0) throw new RangeError("RTF samples must be positive");
      return sample;
    })
    .sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

/**
 * All candidates keep the same truthful reverse-suffix policy. Measured RTF
 * changes the predicted rendezvous point and the UI description, never the
 * meaning of the white generated range.
 */
export function describeAdaptiveSuffixStrategy(rtf) {
  requireFinite("rtf", rtf);
  if (rtf <= 0) throw new RangeError("rtf must be positive");
  if (rtf <= 0.55) {
    return {
      id: "fast-suffix",
      label: "快速后缀相遇",
      explanation: "生成明显快于播放，预计能较早形成一段连续配音。",
    };
  }
  if (rtf <= 1) {
    return {
      id: "balanced-suffix",
      label: "平衡后缀相遇",
      explanation: "生成接近实时，保持原声直到连续后缀真正追上。",
    };
  }
  return {
    id: "patient-suffix",
    label: "稳态后缀相遇",
    explanation: "生成慢于播放，优先保证后半段是一整段连续配音。",
  };
}

export function predictAdaptiveRendezvous({
  durationMs,
  playbackMs = 0,
  generatedSuffixStartMs = durationMs,
  playbackRate = 1,
  rtf,
  startupSeconds = 0,
}) {
  for (const [name, value] of Object.entries({
    durationMs,
    playbackMs,
    generatedSuffixStartMs,
    playbackRate,
    rtf,
    startupSeconds,
  })) {
    requireFinite(name, value);
  }
  if (durationMs <= 0) throw new RangeError("durationMs must be positive");
  if (playbackRate <= 0) {
    throw new RangeError("playbackRate must be positive");
  }
  if (rtf <= 0) throw new RangeError("rtf must be positive");
  if (startupSeconds < 0) {
    throw new RangeError("startupSeconds cannot be negative");
  }

  const durationSeconds = durationMs / 1_000;
  const playbackSeconds = clamp(playbackMs / 1_000, 0, durationSeconds);
  const suffixSeconds = clamp(
    generatedSuffixStartMs / 1_000,
    playbackSeconds,
    durationSeconds,
  );
  const playbackRemaining = (durationSeconds - playbackSeconds) / playbackRate;
  if (startupSeconds >= playbackRemaining) {
    return {
      reachableBeforeEnd: false,
      wallSecondsUntilSwitch: playbackRemaining,
      switchAtMs: durationMs,
      continuousSuffixMs: 0,
    };
  }

  const generationRate = 1 / rtf;
  const gapAfterStartup =
    suffixSeconds - playbackSeconds - playbackRate * startupSeconds;
  if (gapAfterStartup <= 0) {
    return {
      reachableBeforeEnd: suffixSeconds < durationSeconds,
      wallSecondsUntilSwitch: 0,
      switchAtMs: Math.round(playbackSeconds * 1_000),
      continuousSuffixMs: Math.round(
        (durationSeconds - playbackSeconds) * 1_000,
      ),
    };
  }

  const generationSeconds = gapAfterStartup / (playbackRate + generationRate);
  const wallSecondsUntilSwitch = startupSeconds + generationSeconds;
  const reachableBeforeEnd = wallSecondsUntilSwitch < playbackRemaining;
  const switchSeconds = reachableBeforeEnd
    ? playbackSeconds + playbackRate * wallSecondsUntilSwitch
    : durationSeconds;

  return {
    reachableBeforeEnd,
    wallSecondsUntilSwitch: reachableBeforeEnd
      ? wallSecondsUntilSwitch
      : playbackRemaining,
    switchAtMs: Math.round(switchSeconds * 1_000),
    continuousSuffixMs: reachableBeforeEnd
      ? Math.round((durationSeconds - switchSeconds) * 1_000)
      : 0,
  };
}

export function contiguousSuffixStartMs(cues, completedCueIds, durationMs) {
  if (!(completedCueIds instanceof Set)) {
    throw new TypeError("completedCueIds must be a Set");
  }
  let suffixStart = durationMs;
  for (const cue of [...cues].reverse()) {
    if (!completedCueIds.has(cue.id)) break;
    suffixStart = cue.startMs;
  }
  return suffixStart;
}
