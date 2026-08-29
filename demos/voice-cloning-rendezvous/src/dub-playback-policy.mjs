export function resolveDubPlayback({
  cues,
  audioFiles,
  positionMs,
  generatedRegionStartMs,
  backgroundAvailable,
}) {
  if (
    !backgroundAvailable ||
    !Number.isFinite(generatedRegionStartMs) ||
    positionMs < generatedRegionStartMs
  ) {
    return { mode: "original" };
  }

  const currentCue = cues.find(
    ({ startMs, endMs }) => positionMs >= startMs && positionMs < endMs,
  );
  if (currentCue) {
    const file = audioFiles?.[currentCue.id];
    return file
      ? { mode: "dub", cue: currentCue, file }
      : { mode: "background" };
  }
  return { mode: "background" };
}
