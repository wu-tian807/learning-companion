import type { ImageRegionTarget } from '../shared';
import type { ImageExplanationView } from './shared';

export function isImageExplanationForRevision(
  explanation: ImageExplanationView,
  sourceRevision: string,
): boolean {
  return (
    explanation.sourceRevision === undefined ||
    explanation.sourceRevision === sourceRevision
  );
}

export function findImageExplanationAtTarget(
  explanations: readonly ImageExplanationView[],
  target: ImageRegionTarget,
  sourceRevision: string,
): ImageExplanationView | undefined {
  return explanations.find((candidate) => {
    if (!isImageExplanationForRevision(candidate, sourceRevision)) {
      return false;
    }
    const left = candidate.target.anchorPayload;
    const right = target.anchorPayload;
    return (
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height &&
      left.sourceWidth === right.sourceWidth &&
      left.sourceHeight === right.sourceHeight
    );
  });
}
