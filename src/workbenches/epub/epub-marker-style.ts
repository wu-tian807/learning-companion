export const EPUB_MARKER_COLORS = [
  'white',
  'black',
  'red',
  'yellow',
  'blue',
] as const;

export type EpubMarkerColor = (typeof EPUB_MARKER_COLORS)[number];

export const EPUB_MARKER_COLOR_VALUES: Readonly<
  Record<EpubMarkerColor, string>
> = Object.freeze({
  white: '#f8fafc',
  black: '#111827',
  red: '#ef4444',
  yellow: '#eab308',
  blue: '#3b82f6',
});

export const EPUB_MARKER_COLOR_LABELS: Readonly<
  Record<EpubMarkerColor, string>
> = Object.freeze({
  white: '白色',
  black: '黑色',
  red: '红色',
  yellow: '黄色',
  blue: '蓝色',
});

export function isEpubMarkerColor(value: unknown): value is EpubMarkerColor {
  return EPUB_MARKER_COLORS.some((color) => color === value);
}
