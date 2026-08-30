import {
  EPUB_MARKER_COLOR_VALUES,
  type EpubMarkerColor,
} from './epub-marker-style';

export function epubAnnotationWaveStyles(
  lane: number,
  color: EpubMarkerColor,
  source: 'line' | 'rect' = 'line',
): Readonly<Record<string, string>> {
  return Object.freeze({
    'data-epub-annotation-wave': 'true',
    'data-epub-wave-color': EPUB_MARKER_COLOR_VALUES[color],
    'data-epub-wave-source': source,
    transform: `translate(0 ${Math.max(0, lane) * 3})`,
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
  const amplitude = 1.5;
  let current = start;
  let direction = -1;
  const commands = [`M ${start} ${y}`];

  while (current < end) {
    const next = Math.min(current + halfWave, end);
    const controlX = current + (next - current) / 2;
    commands.push(
      `Q ${controlX} ${y + amplitude * direction} ${next} ${y}`,
    );
    current = next;
    direction *= -1;
  }
  return commands.join(' ');
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
    path.setAttribute('d', wavePathData(x1, x2, y));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.6');
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
    const color = group?.getAttribute('data-epub-wave-color') ?? '#eab308';
    const path = rect.ownerDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );
    path.setAttribute('d', wavePathData(x, x + width, y + height - 1));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.6');
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
