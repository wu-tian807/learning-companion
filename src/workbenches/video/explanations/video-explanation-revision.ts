import type { VideoExplanationView } from './shared';

export function isVideoExplanationForRevision(
  explanation: VideoExplanationView,
  sourceRevision: string,
): boolean {
  return explanation.sourceRevision === sourceRevision;
}

export function videoExplanationVisibleAtTime(
  explanation: VideoExplanationView,
  currentTimeSeconds: number,
  toleranceSeconds = 0.25,
): boolean {
  return (
    Number.isFinite(currentTimeSeconds) &&
    Math.abs(
      explanation.target.targetPayload.timeSeconds - currentTimeSeconds,
    ) <= toleranceSeconds
  );
}
