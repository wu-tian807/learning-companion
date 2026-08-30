import {
  EPUB_MARKER_COLORS,
  EPUB_MARKER_COLOR_LABELS,
  EPUB_MARKER_COLOR_VALUES,
  type EpubMarkerColor,
} from './epub-marker-style';

export function EpubMarkerColorPicker({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: EpubMarkerColor;
  readonly onChange: (color: EpubMarkerColor) => void;
  readonly disabled?: boolean;
}) {
  return (
    <fieldset aria-label="波浪线颜色" className="flex items-center gap-1.5">
      <legend className="sr-only">波浪线颜色</legend>
      {EPUB_MARKER_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${EPUB_MARKER_COLOR_LABELS[color]}波浪线`}
          aria-pressed={value === color}
          disabled={disabled}
          onClick={() => onChange(color)}
          className={`size-5 rounded-full border shadow-sm transition-transform disabled:opacity-40 ${
            value === color
              ? 'scale-110 border-slate-200 ring-1 ring-slate-300/50'
              : 'border-white/20 hover:scale-105'
          }`}
          style={{ backgroundColor: EPUB_MARKER_COLOR_VALUES[color] }}
          title={EPUB_MARKER_COLOR_LABELS[color]}
        />
      ))}
    </fieldset>
  );
}
