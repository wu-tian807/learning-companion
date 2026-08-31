import {
  EPUB_MARKER_COLOR_VALUES,
  type EpubMarkerColor,
} from './epub-marker-style';

const WAVE_AMPLITUDE_PX = 1.5;
const WAVE_STROKE_WIDTH_PX = 1.6;
const WAVE_MIN_VERTICAL_GAP_PX = 1;
const WAVE_LANE_STEP_PX = Math.ceil(
  WAVE_AMPLITUDE_PX * 2 +
    WAVE_STROKE_WIDTH_PX +
    WAVE_MIN_VERTICAL_GAP_PX,
);

export function epubAnnotationWaveStyles(
  lane: number,
  color: EpubMarkerColor,
  source: 'line' | 'rect' = 'line',
): Readonly<Record<string, string>> {
  return Object.freeze({
    'data-epub-annotation-wave': 'true',
    'data-epub-wave-color': EPUB_MARKER_COLOR_VALUES[color],
    'data-epub-wave-source': source,
    'data-epub-wave-lane': String(Math.max(0, lane)),
    stroke: 'none',
    'stroke-opacity': '0.95',
    'mix-blend-mode': 'normal',
    'pointer-events': 'auto',
  });
}

function finiteNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function wavePathData(x1: number, x2: number, y: number): string {
  const start = Math.min(x1, x2);
  const end = Math.max(x1, x2);
  const halfWave = 3;
  let current = start;
  let direction = -1;
  const commands = [`M ${start} ${y}`];

  while (current < end) {
    const next = Math.min(current + halfWave, end);
    const controlX = current + (next - current) / 2;
    commands.push(
      `Q ${controlX} ${y + WAVE_AMPLITUDE_PX * direction} ${next} ${y}`,
    );
    current = next;
    direction *= -1;
  }
  return commands.join(' ');
}

function waveLaneOffset(group: Element | null): number {
  // marks-pane recomputes child geometry after font/layout changes. Applying
  // the lane to the final path keeps that reflow from cancelling a group
  // transform and merging separate annotations back onto one baseline.
  const lane = finiteNumber(group?.getAttribute('data-epub-wave-lane') ?? null);
  return Math.max(0, lane ?? 0) * WAVE_LANE_STEP_PX;
}

export function applyEpubAnnotationWaves(root: ParentNode): void {
  for (const line of root.querySelectorAll<SVGLineElement>(
    '[data-epub-annotation-wave="true"][data-epub-wave-source="line"] line',
  )) {
    const x1 = finiteNumber(line.getAttribute('x1'));
    const x2 = finiteNumber(line.getAttribute('x2'));
    const y = finiteNumber(line.getAttribute('y1'));
    if (x1 === undefined || x2 === undefined || y === undefined) continue;

    const group = line.closest<SVGGElement>(
      '[data-epub-annotation-wave="true"]',
    );
    for (const rect of group?.querySelectorAll('rect') ?? []) {
      rect.remove();
    }
    const color = group?.getAttribute('data-epub-wave-color') ?? '#3b82f6';
    const path = line.ownerDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    path.setAttribute('d', wavePathData(x1, x2, y + waveLaneOffset(group)));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(WAVE_STROKE_WIDTH_PX));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    line.replaceWith(path);
  }

  for (const rect of root.querySelectorAll<SVGRectElement>(
    '[data-epub-annotation-wave="true"][data-epub-wave-source="rect"] rect',
  )) {
    const x = finiteNumber(rect.getAttribute('x'));
    const y = finiteNumber(rect.getAttribute('y'));
    const width = finiteNumber(rect.getAttribute('width'));
    const height = finiteNumber(rect.getAttribute('height'));
    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined
    ) {
      continue;
    }

    const group = rect.closest<SVGGElement>(
      '[data-epub-annotation-wave="true"]',
    );
    for (const line of group?.querySelectorAll('line') ?? []) {
      line.remove();
    }
    const color = group?.getAttribute('data-epub-wave-color') ?? '#eab308';
    const path = rect.ownerDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    path.setAttribute(
      'd',
      wavePathData(
        x,
        x + width,
        y + height - 1 + waveLaneOffset(group),
      ),
    );
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(WAVE_STROKE_WIDTH_PX));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    rect.replaceWith(path);
  }
}

export function observeEpubAnnotationWaves(host: HTMLElement): () => void {
  let disposed = false;
  const apply = () => {
    if (!disposed) applyEpubAnnotationWaves(host);
  };
  const observer = new MutationObserver(apply);
  observer.observe(host, { childList: true, subtree: true });
  apply();
  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
  };
}
