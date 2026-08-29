function requireFinite(name, value) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Predicts where forward playback meets a continuously generated suffix.
 *
 * Playback moves right at `playbackRate` media seconds per wall second while
 * suffix generation moves left at `1 / rtf`. The prediction is advisory; the
 * player must switch from original audio only when actual suffix coverage has
 * reached the playhead.
 */
export function predictSuffixRendezvous({
  durationSeconds,
  playbackSeconds,
  generatedSuffixStartSeconds = durationSeconds,
  playbackRate = 1,
  rtf,
  startupSeconds = 0,
}) {
  for (const [name, value] of Object.entries({
    durationSeconds,
    playbackSeconds,
    generatedSuffixStartSeconds,
    playbackRate,
    rtf,
    startupSeconds,
  })) {
    requireFinite(name, value);
  }

  if (durationSeconds <= 0)
    throw new RangeError("durationSeconds must be positive");
  if (playbackRate <= 0) throw new RangeError("playbackRate must be positive");
  if (rtf <= 0) throw new RangeError("rtf must be positive");
  if (startupSeconds < 0)
    throw new RangeError("startupSeconds cannot be negative");

  const playback = clamp(playbackSeconds, 0, durationSeconds);
  const suffixStart = clamp(
    generatedSuffixStartSeconds,
    playback,
    durationSeconds,
  );
  const generationRate = 1 / rtf;
  const gap = suffixStart - playback;

  if (gap === 0) {
    return {
      reachableBeforeEnd: suffixStart < durationSeconds,
      wallSecondsUntilSwitch: 0,
      switchAtSeconds: playback,
      continuousSuffixSeconds: durationSeconds - playback,
      generationRate,
    };
  }

  const playbackTimeRemaining = (durationSeconds - playback) / playbackRate;
  if (startupSeconds >= playbackTimeRemaining) {
    return {
      reachableBeforeEnd: false,
      wallSecondsUntilSwitch: playbackTimeRemaining,
      switchAtSeconds: durationSeconds,
      continuousSuffixSeconds: 0,
      generationRate,
    };
  }

  // During startup playback advances but no suffix audio becomes available.
  const gapAfterStartup = gap - playbackRate * startupSeconds;
  if (gapAfterStartup <= 0) {
    return {
      reachableBeforeEnd: false,
      wallSecondsUntilSwitch: playbackTimeRemaining,
      switchAtSeconds: durationSeconds,
      continuousSuffixSeconds: 0,
      generationRate,
    };
  }

  const generationSeconds = gapAfterStartup / (playbackRate + generationRate);
  const wallSecondsUntilSwitch = startupSeconds + generationSeconds;
  const switchAtSeconds = clamp(
    playback + playbackRate * wallSecondsUntilSwitch,
    playback,
    durationSeconds,
  );
  const reachableBeforeEnd = wallSecondsUntilSwitch < playbackTimeRemaining;

  return {
    reachableBeforeEnd,
    wallSecondsUntilSwitch: reachableBeforeEnd
      ? wallSecondsUntilSwitch
      : playbackTimeRemaining,
    switchAtSeconds: reachableBeforeEnd ? switchAtSeconds : durationSeconds,
    continuousSuffixSeconds: reachableBeforeEnd
      ? durationSeconds - switchAtSeconds
      : 0,
    generationRate,
  };
}

export function advanceSuffixStart({
  durationSeconds,
  generatedSuffixStartSeconds,
  wallSeconds,
  rtf,
}) {
  for (const [name, value] of Object.entries({
    durationSeconds,
    generatedSuffixStartSeconds,
    wallSeconds,
    rtf,
  })) {
    requireFinite(name, value);
  }
  if (durationSeconds <= 0)
    throw new RangeError("durationSeconds must be positive");
  if (wallSeconds < 0) throw new RangeError("wallSeconds cannot be negative");
  if (rtf <= 0) throw new RangeError("rtf must be positive");

  return clamp(
    generatedSuffixStartSeconds - wallSeconds / rtf,
    0,
    durationSeconds,
  );
}

export function hasGeneratedCoverage({
  playbackSeconds,
  generatedSuffixStartSeconds,
  durationSeconds,
}) {
  return (
    generatedSuffixStartSeconds < durationSeconds &&
    playbackSeconds >= generatedSuffixStartSeconds
  );
}

export function advanceChunkSchedule({
  generatedSuffixStartSeconds,
  wallSeconds,
  schedule,
  scheduleIndex = 0,
  segmentWallRemaining,
}) {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    throw new TypeError("schedule must contain at least one measured segment");
  }
  if (!Number.isFinite(wallSeconds) || wallSeconds < 0) {
    throw new RangeError("wallSeconds must be a non-negative finite number");
  }
  if (
    !Number.isInteger(scheduleIndex) ||
    scheduleIndex < 0 ||
    scheduleIndex >= schedule.length
  ) {
    throw new RangeError("scheduleIndex is outside the measured schedule");
  }

  let suffixStart = generatedSuffixStartSeconds;
  let remainingWall =
    segmentWallRemaining ?? schedule[scheduleIndex].generationSeconds;
  let remainingInput = wallSeconds;
  let nextIndex = scheduleIndex;

  while (remainingInput > 0 && suffixStart > 0) {
    const consumed = Math.min(remainingInput, remainingWall);
    remainingInput -= consumed;
    remainingWall -= consumed;
    if (remainingWall <= 1e-9) {
      suffixStart = Math.max(
        0,
        suffixStart - schedule[nextIndex].outputSeconds,
      );
      nextIndex = (nextIndex + 1) % schedule.length;
      remainingWall = schedule[nextIndex].generationSeconds;
    }
  }

  return {
    generatedSuffixStartSeconds: suffixStart,
    scheduleIndex: nextIndex,
    segmentWallRemaining: remainingWall,
  };
}
