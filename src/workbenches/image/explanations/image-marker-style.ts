export const IMAGE_MARKER_COLORS = [
  'white',
  'black',
  'red',
  'yellow',
  'blue',
] as const;

export type ImageMarkerColor = (typeof IMAGE_MARKER_COLORS)[number];

export interface ImageMarkerVisualStyle {
  readonly stroke: string;
  readonly fill: string;
  readonly badgeFill: string;
  readonly badgeStroke: string;
  readonly badgeText: string;
}

export const IMAGE_MARKER_COLOR_LABELS: Readonly<
  Record<ImageMarkerColor, string>
> = Object.freeze({
  white: '白色',
  black: '黑色',
  red: '红色',
  yellow: '黄色',
  blue: '蓝色',
});

export const IMAGE_MARKER_COLOR_VALUES: Readonly<
  Record<ImageMarkerColor, string>
> = Object.freeze({
  white: '#f8fafc',
  black: '#111827',
  red: '#ef4444',
  yellow: '#eab308',
  blue: '#3b82f6',
});

export const IMAGE_MARKER_VISUAL_STYLES: Readonly<
  Record<ImageMarkerColor, ImageMarkerVisualStyle>
> = Object.freeze({
  white: {
    stroke: '#f8fafc',
    fill: 'rgba(248,250,252,0.10)',
    badgeFill: '#f8fafc',
    badgeStroke: '#64748b',
    badgeText: '#0f172a',
  },
  black: {
    stroke: '#111827',
    fill: 'rgba(17,24,39,0.10)',
    badgeFill: '#111827',
    badgeStroke: '#f8fafc',
    badgeText: '#f8fafc',
  },
  red: {
    stroke: '#ef4444',
    fill: 'rgba(239,68,68,0.10)',
    badgeFill: '#dc2626',
    badgeStroke: '#fecaca',
    badgeText: '#fff1f2',
  },
  yellow: {
    stroke: '#eab308',
    fill: 'rgba(234,179,8,0.11)',
    badgeFill: '#ca8a04',
    badgeStroke: '#fef08a',
    badgeText: '#fffbeb',
  },
  blue: {
    stroke: '#3b82f6',
    fill: 'rgba(59,130,246,0.10)',
    badgeFill: '#2563eb',
    badgeStroke: '#bfdbfe',
    badgeText: '#eff6ff',
  },
});

export function isImageMarkerColor(value: unknown): value is ImageMarkerColor {
  return IMAGE_MARKER_COLORS.some((color) => color === value);
}
