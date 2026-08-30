import { EpubCFI } from 'epubjs';

export interface EpubExplanationLaneInput {
  readonly id: string;
  readonly cfiRange: string;
}

interface CfiInterval {
  readonly start: EpubCFI;
  readonly end: EpubCFI;
}

function intervalFromRange(cfiRange: string): CfiInterval | undefined {
  try {
    const start = new EpubCFI(cfiRange);
    const end = new EpubCFI(cfiRange);
    if (!start.range || !end.range) return undefined;
    start.collapse(true);
    end.collapse(false);
    return { start, end };
  } catch {
    return undefined;
  }
}

function intervalsOverlap(left: CfiInterval, right: CfiInterval): boolean {
  const comparator = new EpubCFI();
  return (
    comparator.compare(left.start, right.end) < 0 &&
    comparator.compare(right.start, left.end) < 0
  );
}

export function assignEpubExplanationLanes(
  explanations: readonly EpubExplanationLaneInput[],
): Readonly<Record<string, number>> {
  const laneIntervals: CfiInterval[][] = [];
  const lanes: Record<string, number> = {};

  for (const explanation of explanations) {
    const interval = intervalFromRange(explanation.cfiRange);
    if (!interval) {
      const lane = laneIntervals.length;
      laneIntervals.push([]);
      lanes[explanation.id] = lane;
      continue;
    }
    let lane = laneIntervals.findIndex((intervals) =>
      intervals.every((candidate) => !intervalsOverlap(candidate, interval)),
    );
    if (lane < 0) {
      lane = laneIntervals.length;
      laneIntervals.push([]);
    }
    laneIntervals[lane]!.push(interval);
    lanes[explanation.id] = lane;
  }

  return Object.freeze(lanes);
}

export function epubExplanationUnderlineStyles(
  lane: number,
  status: 'pending' | 'failed' | 'completed',
): Readonly<Record<string, string>> {
  const color =
    status === 'failed'
      ? '#fb7185'
      : status === 'pending'
        ? '#94a3b8'
        : '#93c5fd';
  const dashPatterns = ['', '5 2', '2 2', '7 2 2 2'];
  return Object.freeze({
    stroke: color,
    'stroke-width': '2',
    'stroke-opacity': '0.88',
    transform: `translate(0 ${-Math.min(lane, 5) * 2})`,
    ...(dashPatterns[lane % dashPatterns.length]
      ? { 'stroke-dasharray': dashPatterns[lane % dashPatterns.length]! }
      : {}),
  });
}
